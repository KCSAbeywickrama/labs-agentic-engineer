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

package repositories_test

import (
	"context"
	"errors"
	"testing"

	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// TestExternalResourceRepository_Upsert_CreatesNew confirms the create branch:
// a first-time registration stores the schema verbatim and defaults
// ResourceTypeName to the resource name.
func TestExternalResourceRepository_Upsert_CreatesNew(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := repositories.NewExternalResourceRepository(db)
	ctx := context.Background()

	schema := []models.ConfigKey{{Key: "api_key", Secret: true}, {Key: "base_url", Secret: false}}
	got, err := repo.Upsert(ctx, "orga", "salesforce", "CRM", schema)
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if got == nil || got.ID == "" {
		t.Fatalf("expected a persisted row with a generated id, got %+v", got)
	}
	if got.ResourceTypeName != "salesforce" {
		t.Fatalf("ResourceTypeName = %q; want %q (defaults to name on first registration)", got.ResourceTypeName, "salesforce")
	}
	if len(got.ConfigKeys) != 2 {
		t.Fatalf("ConfigKeys = %+v; want 2 entries", got.ConfigKeys)
	}

	reloaded, err := repo.Get(ctx, "orga", "salesforce")
	if err != nil || reloaded == nil {
		t.Fatalf("Get after create: %v / %v", reloaded, err)
	}
	if reloaded.Description != "CRM" {
		t.Fatalf("Description = %q; want %q", reloaded.Description, "CRM")
	}
}

// TestExternalResourceRepository_Upsert_SchemaChangeBumpsResourceType confirms
// that changing the config key schema on an existing resource bumps the
// ResourceTypeName with a numeric suffix (immutable-ResourceType rename), and
// that a second schema change bumps again from the last suffix.
func TestExternalResourceRepository_Upsert_SchemaChangeBumpsResourceType(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := repositories.NewExternalResourceRepository(db)
	ctx := context.Background()

	initial := []models.ConfigKey{{Key: "api_key", Secret: true}}
	if _, err := repo.Upsert(ctx, "orga", "salesforce", "CRM", initial); err != nil {
		t.Fatalf("initial Upsert: %v", err)
	}

	changed := []models.ConfigKey{{Key: "api_key", Secret: true}, {Key: "region", Secret: false}}
	got, err := repo.Upsert(ctx, "orga", "salesforce", "CRM", changed)
	if err != nil {
		t.Fatalf("Upsert with changed schema: %v", err)
	}
	if got.ResourceTypeName != "salesforce-2" {
		t.Fatalf("ResourceTypeName after schema change = %q; want %q", got.ResourceTypeName, "salesforce-2")
	}
	if len(got.ConfigKeys) != 2 {
		t.Fatalf("ConfigKeys not updated: %+v", got.ConfigKeys)
	}

	changedAgain := []models.ConfigKey{{Key: "api_key", Secret: true}, {Key: "region", Secret: true}}
	got2, err := repo.Upsert(ctx, "orga", "salesforce", "CRM", changedAgain)
	if err != nil {
		t.Fatalf("Upsert with second schema change: %v", err)
	}
	if got2.ResourceTypeName != "salesforce-3" {
		t.Fatalf("ResourceTypeName after second schema change = %q; want %q", got2.ResourceTypeName, "salesforce-3")
	}
}

// TestExternalResourceRepository_Upsert_DescriptionOnlyDoesNotBump confirms
// that editing only the description (schema unchanged, or empty schema
// passed) leaves ResourceTypeName untouched.
func TestExternalResourceRepository_Upsert_DescriptionOnlyDoesNotBump(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := repositories.NewExternalResourceRepository(db)
	ctx := context.Background()

	schema := []models.ConfigKey{{Key: "api_key", Secret: true}}
	if _, err := repo.Upsert(ctx, "orga", "salesforce", "CRM v1", schema); err != nil {
		t.Fatalf("initial Upsert: %v", err)
	}

	// Same schema content (order-independent equality) → no bump.
	sameSchema := []models.ConfigKey{{Key: "api_key", Secret: true}}
	got, err := repo.Upsert(ctx, "orga", "salesforce", "CRM v2", sameSchema)
	if err != nil {
		t.Fatalf("Upsert with same schema: %v", err)
	}
	if got.ResourceTypeName != "salesforce" {
		t.Fatalf("ResourceTypeName changed on description-only edit: %q", got.ResourceTypeName)
	}
	if got.Description != "CRM v2" {
		t.Fatalf("Description not updated: %q", got.Description)
	}

	// Empty schema on update → description updates, schema/type untouched.
	got2, err := repo.Upsert(ctx, "orga", "salesforce", "CRM v3", nil)
	if err != nil {
		t.Fatalf("Upsert with nil schema: %v", err)
	}
	if got2.ResourceTypeName != "salesforce" || len(got2.ConfigKeys) != 1 {
		t.Fatalf("nil schema on update mutated stored schema/type: %+v", got2)
	}
}

// TestExternalResourceRepository_Get_NotFoundReturnsNilNil confirms the
// no-existence-leak (nil, nil) contract for an absent (org, name).
func TestExternalResourceRepository_Get_NotFoundReturnsNilNil(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := repositories.NewExternalResourceRepository(db)
	ctx := context.Background()

	got, err := repo.Get(ctx, "orga", "no-such-resource")
	if err != nil {
		t.Fatalf("Get(missing): %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil for a missing resource, got %+v", got)
	}
}

// TestExternalResourceRepository_List_OrgScopedOrderedByName confirms List is
// scoped to the org and returns rows ordered by name.
func TestExternalResourceRepository_List_OrgScopedOrderedByName(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := repositories.NewExternalResourceRepository(db)
	ctx := context.Background()

	mk := func(org, name string) {
		t.Helper()
		if _, err := repo.Upsert(ctx, org, name, "", []models.ConfigKey{{Key: "k", Secret: false}}); err != nil {
			t.Fatalf("Upsert(%s,%s): %v", org, name, err)
		}
	}
	mk("orga", "zeta")
	mk("orga", "alpha")
	mk("orgb", "intruder") // decoy under another org

	got, err := repo.List(ctx, "orga")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("List(orga) = %d rows; want 2 (decoy leaked?)", len(got))
	}
	if got[0].Name != "alpha" || got[1].Name != "zeta" {
		t.Fatalf("List not ordered by name: %+v", got)
	}
}

// TestExternalResourceRepository_Delete_RemovesRow confirms Delete removes
// exactly the (org, name) row and leaves other orgs' rows intact.
func TestExternalResourceRepository_Delete_RemovesRow(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := repositories.NewExternalResourceRepository(db)
	ctx := context.Background()

	if _, err := repo.Upsert(ctx, "orga", "salesforce", "", []models.ConfigKey{{Key: "k", Secret: false}}); err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if _, err := repo.Upsert(ctx, "orgb", "salesforce", "", []models.ConfigKey{{Key: "k", Secret: false}}); err != nil {
		t.Fatalf("Upsert(orgb): %v", err)
	}

	if err := repo.Delete(ctx, "orga", "salesforce"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	got, err := repo.Get(ctx, "orga", "salesforce")
	if err != nil || got != nil {
		t.Fatalf("expected orga/salesforce gone, got %+v / %v", got, err)
	}
	other, err := repo.Get(ctx, "orgb", "salesforce")
	if err != nil || other == nil {
		t.Fatalf("Delete crossed into another org's row: %+v / %v", other, err)
	}
}

// TestExternalResourceRepository_Delete_NotFoundSentinel confirms the
// ErrExternalResourceNotFound sentinel on a zero-row delete.
func TestExternalResourceRepository_Delete_NotFoundSentinel(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := repositories.NewExternalResourceRepository(db)
	ctx := context.Background()

	err := repo.Delete(ctx, "orga", "no-such-resource")
	if !errors.Is(err, repositories.ErrExternalResourceNotFound) {
		t.Fatalf("Delete(missing) = %v; want ErrExternalResourceNotFound", err)
	}
}

// TestExternalResourceRepository_Consumers_DedupAndScoped confirms Consumers
// only counts `component`-type tasks whose depends_on_external_resources
// contains the exact resource name (JSONB containment, not substring), dedups
// by (project, component), and is scoped to the org.
func TestExternalResourceRepository_Consumers_DedupAndScoped(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	extRepo := repositories.NewExternalResourceRepository(db)
	taskRepo := repositories.NewTaskRepository(db)
	ctx := context.Background()

	if _, err := extRepo.Upsert(ctx, "orga", "openweather", "", []models.ConfigKey{{Key: "k", Secret: false}}); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	mkTask := func(org, proj, comp, taskType string, deps models.StringSlice) {
		t.Helper()
		task := &models.ComponentTask{
			OrgID: org, ProjectID: proj, ComponentName: comp,
			Type: taskType, DependsOnExternalResources: deps,
			Status: string(models.TaskStatusPending),
		}
		if err := taskRepo.Create(ctx, task); err != nil {
			t.Fatalf("create task (%s/%s/%s): %v", org, proj, comp, err)
		}
	}

	// Consumer of "openweather".
	mkTask("orga", "proj1", "svc-a", models.TaskTypeComponent, models.StringSlice{"openweather"})
	// Duplicate row for the SAME (project, component) — must dedup to one entry.
	mkTask("orga", "proj1", "svc-a", models.TaskTypeComponent, models.StringSlice{"openweather"})
	// Near-miss name must NOT false-positive via substring match.
	mkTask("orga", "proj1", "svc-b", models.TaskTypeComponent, models.StringSlice{"openweathermap"})
	// Non-component task type must be excluded even if it references the resource.
	mkTask("orga", "proj1", "svc-c", models.TaskTypeConfigCollection, models.StringSlice{"openweather"})
	// Different org must be excluded.
	mkTask("orgb", "proj1", "svc-d", models.TaskTypeComponent, models.StringSlice{"openweather"})
	// Second distinct consumer.
	mkTask("orga", "proj2", "svc-e", models.TaskTypeComponent, models.StringSlice{"openweather"})

	got, err := extRepo.Consumers(ctx, "orga", "openweather")
	if err != nil {
		t.Fatalf("Consumers: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("Consumers = %+v; want 2 deduped entries", got)
	}
	seen := map[string]bool{}
	for _, c := range got {
		seen[c.ProjectID+"/"+c.ComponentName] = true
	}
	if !seen["proj1/svc-a"] || !seen["proj2/svc-e"] {
		t.Fatalf("Consumers missing expected entries: %+v", got)
	}

	// A resource with no consumers → empty, not nil-panicking.
	none, err := extRepo.Consumers(ctx, "orga", "unused-resource")
	if err != nil {
		t.Fatalf("Consumers(unused): %v", err)
	}
	if len(none) != 0 {
		t.Fatalf("expected no consumers, got %+v", none)
	}
}

// TestExternalResourceRepository_Consumers_NameWithDoubleQuote confirms
// Consumers handles a resource name containing a double-quote without
// erroring — the containment value must be JSON-encoded rather than built by
// string concatenation, or a name like `we"ird` produces invalid JSON for the
// `@> ?::jsonb` operand.
func TestExternalResourceRepository_Consumers_NameWithDoubleQuote(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	extRepo := repositories.NewExternalResourceRepository(db)
	taskRepo := repositories.NewTaskRepository(db)
	ctx := context.Background()

	const weird = `we"ird`

	if _, err := extRepo.Upsert(ctx, "orga", weird, "", []models.ConfigKey{{Key: "k", Secret: false}}); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	task := &models.ComponentTask{
		OrgID: "orga", ProjectID: "proj1", ComponentName: "svc-a",
		Type: models.TaskTypeComponent, DependsOnExternalResources: models.StringSlice{weird},
		Status: string(models.TaskStatusPending),
	}
	if err := taskRepo.Create(ctx, task); err != nil {
		t.Fatalf("create task: %v", err)
	}

	got, err := extRepo.Consumers(ctx, "orga", weird)
	if err != nil {
		t.Fatalf("Consumers(%q): %v", weird, err)
	}
	if len(got) != 1 || got[0].ProjectID != "proj1" || got[0].ComponentName != "svc-a" {
		t.Fatalf("Consumers(%q) = %+v; want a single proj1/svc-a entry", weird, got)
	}
}
