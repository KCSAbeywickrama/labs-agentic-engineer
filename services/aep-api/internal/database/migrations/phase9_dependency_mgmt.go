// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

package migrations

import (
	"context"
	"fmt"
	"log/slog"

	"gorm.io/gorm"
)

// RunPhase9DependencyMgmt applies the schema delta for the dependency-
// management feature (typed dependency graph: component / org-service /
// external / platform-resource):
//
//  1. CREATE TABLE external_resources — the org-level catalog of registered
//     external dependencies (models.ExternalResource): name + description +
//     config key schema + the OC ResourceType the wiring maps to. One row per
//     (org_id, name).
//  2. CREATE TABLE access_requests — the cross-project access-request
//     tracking rows (models.AccessRequest, P3.5): a consumer asking a
//     provider project to publish an org service cross-project.
//  3. component_tasks gains the typed-task-graph columns: `type`
//     (discriminates component / config-collection / resource-provisioning /
//     org-publish tasks), the three JSONB dependency lists
//     (depends_on_external_resources, depends_on_org_services,
//     depends_on_resources), and the two single-target columns
//     (external_resource_name, resource_name) set only on the task kinds that
//     own one dependency each.
//
// Raw SQL runs for all three so the column/constraint shapes above (JSONB
// defaults, uniqueness, CHECK-free simple defaults) are authoritative
// regardless of what GORM's own struct-tag inference would have produced —
// per the house migration rule (see phase3_tech_lead.go / phase6_api_platform_idp.go).
// Every step is existence-guarded, so the migration is idempotent.
func RunPhase9DependencyMgmt(ctx context.Context, db *gorm.DB) error {
	if err := runPhase9ExternalResourcesTable(ctx, db); err != nil {
		return err
	}
	if err := runPhase9AccessRequestsTable(ctx, db); err != nil {
		return err
	}
	if err := runPhase9ComponentTaskColumns(ctx, db); err != nil {
		return err
	}
	return nil
}

// runPhase9ExternalResourcesTable creates external_resources (models.ExternalResource).
func runPhase9ExternalResourcesTable(ctx context.Context, db *gorm.DB) error {
	if hasTable(db, "external_resources") {
		return nil
	}
	if err := db.WithContext(ctx).Exec(`
		CREATE TABLE external_resources (
			id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			org_id             TEXT NOT NULL,
			name               TEXT NOT NULL,
			description        TEXT,
			config_keys        JSONB,
			resource_type_name TEXT NOT NULL,
			created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
			CONSTRAINT uq_external_resource_org_name UNIQUE (org_id, name)
		)
	`).Error; err != nil {
		return fmt.Errorf("phase9_dependency_mgmt: create external_resources: %w", err)
	}
	slog.Info("phase9_dependency_mgmt migration: created table", "table", "external_resources")
	return nil
}

// runPhase9AccessRequestsTable creates access_requests (models.AccessRequest)
// plus the indexes its repository lookups (Get, ListByConsumerProject,
// FindOpenForTarget, ListByProviderTask) rely on.
func runPhase9AccessRequestsTable(ctx context.Context, db *gorm.DB) error {
	if hasTable(db, "access_requests") {
		return nil
	}
	if err := db.WithContext(ctx).Exec(`
		CREATE TABLE access_requests (
			id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			org_id                  TEXT NOT NULL,
			consumer_project_id     TEXT NOT NULL,
			consumer_component_name TEXT NOT NULL,
			org_service_name        TEXT NOT NULL,
			provider_project_id     TEXT,
			provider_component_name TEXT,
			provider_task_id        TEXT,
			provider_issue_number   INTEGER,
			provider_issue_url      TEXT,
			status                  TEXT NOT NULL DEFAULT 'requested',
			created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`).Error; err != nil {
		return fmt.Errorf("phase9_dependency_mgmt: create access_requests: %w", err)
	}
	indexes := []string{
		`CREATE INDEX idx_access_requests_org_id ON access_requests (org_id)`,
		`CREATE INDEX idx_access_requests_consumer_project_id ON access_requests (consumer_project_id)`,
		`CREATE INDEX idx_access_requests_provider_task_id ON access_requests (provider_task_id)`,
		`CREATE INDEX idx_access_requests_status ON access_requests (status)`,
	}
	for _, stmt := range indexes {
		if err := db.WithContext(ctx).Exec(stmt).Error; err != nil {
			return fmt.Errorf("phase9_dependency_mgmt: create access_requests index: %w", err)
		}
	}
	slog.Info("phase9_dependency_mgmt migration: created table", "table", "access_requests")
	return nil
}

// runPhase9ComponentTaskColumns adds the typed-task-graph columns to
// component_tasks. Guarded per-column via addColumnIfMissing (phase3_tech_lead.go)
// so a partially-applied prior run is safe to retry.
func runPhase9ComponentTaskColumns(ctx context.Context, db *gorm.DB) error {
	scoped := db.WithContext(ctx)
	adds := []struct {
		name string
		ddl  string
	}{
		{"type", `ALTER TABLE component_tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'component'`},
		{"depends_on_external_resources", `ALTER TABLE component_tasks ADD COLUMN depends_on_external_resources JSONB NOT NULL DEFAULT '[]'::jsonb`},
		{"depends_on_org_services", `ALTER TABLE component_tasks ADD COLUMN depends_on_org_services JSONB NOT NULL DEFAULT '[]'::jsonb`},
		{"depends_on_resources", `ALTER TABLE component_tasks ADD COLUMN depends_on_resources JSONB NOT NULL DEFAULT '[]'::jsonb`},
		{"external_resource_name", `ALTER TABLE component_tasks ADD COLUMN external_resource_name TEXT NOT NULL DEFAULT ''`},
		{"resource_name", `ALTER TABLE component_tasks ADD COLUMN resource_name TEXT NOT NULL DEFAULT ''`},
	}
	for _, a := range adds {
		if err := addColumnIfMissing(scoped, "component_tasks", a.name, a.ddl); err != nil {
			return fmt.Errorf("phase9_dependency_mgmt: %w", err)
		}
	}

	indexes := []string{
		`CREATE INDEX IF NOT EXISTS idx_component_tasks_type ON component_tasks (type)`,
		`CREATE INDEX IF NOT EXISTS idx_component_tasks_external_resource_name ON component_tasks (external_resource_name)`,
		`CREATE INDEX IF NOT EXISTS idx_component_tasks_resource_name ON component_tasks (resource_name)`,
	}
	for _, stmt := range indexes {
		if err := scoped.Exec(stmt).Error; err != nil {
			return fmt.Errorf("phase9_dependency_mgmt: create index: %w", err)
		}
	}
	return nil
}
