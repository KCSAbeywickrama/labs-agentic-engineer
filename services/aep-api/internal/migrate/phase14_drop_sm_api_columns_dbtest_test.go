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

package migrate_test

import (
	"context"
	"testing"

	"github.com/wso2/aep/aep-api/internal/migrate"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
)

// TestPhase14DropSMAPIColumns_Contract proves the CONTRACT migration
// drops leftover sm_api_* columns while secret_ref_* remain. dbtest.New
// already applied phase14; re-running the step is the idempotency check.
func TestPhase14DropSMAPIColumns_Contract(t *testing.T) {
	db := dbtest.New(t)
	ctx := context.Background()

	for _, col := range []struct {
		table, column string
	}{
		{"org_anthropic_credentials", "secret_ref_name"},
		{"org_anthropic_credentials", "secret_ref_kv_path"},
		{"org_anthropic_credentials", "secret_ref_property"},
		{"org_credentials", "secret_ref_name"},
		{"org_credentials", "secret_ref_kv_path"},
		{"org_credentials", "secret_ref_property"},
		{"org_credentials", "secret_ref_written_at"},
		{"organization_idp_profiles", "secret_ref_name"},
		{"organization_idp_profiles", "secret_ref_kv_path"},
		{"organization_idp_profiles", "secret_ref_property"},
		{"organization_idp_profiles", "secret_ref_written_at"},
	} {
		var n int
		if err := db.Raw(
			`SELECT COUNT(*) FROM information_schema.columns
			  WHERE table_schema='public' AND table_name=? AND column_name=?`,
			col.table, col.column,
		).Scan(&n).Error; err != nil {
			t.Fatalf("column probe %s.%s: %v", col.table, col.column, err)
		}
		if n != 1 {
			t.Fatalf("secret_ref_* column %s.%s must survive contract, count=%d", col.table, col.column, n)
		}
	}

	for _, col := range []struct {
		table, column string
	}{
		{"org_anthropic_credentials", "sm_api_secret_ref_name"},
		{"org_anthropic_credentials", "sm_api_kv_path"},
		{"org_anthropic_credentials", "sm_api_property"},
		{"org_credentials", "sm_api_secret_ref_name"},
		{"org_credentials", "sm_api_kv_path"},
		{"org_credentials", "sm_api_property"},
		{"org_credentials", "sm_api_written_at"},
		{"organization_idp_profiles", "sm_api_secret_ref_name"},
		{"organization_idp_profiles", "sm_api_kv_path"},
		{"organization_idp_profiles", "sm_api_property"},
		{"organization_idp_profiles", "sm_api_written_at"},
	} {
		var n int
		if err := db.Raw(
			`SELECT COUNT(*) FROM information_schema.columns
			  WHERE table_schema='public' AND table_name=? AND column_name=?`,
			col.table, col.column,
		).Scan(&n).Error; err != nil {
			t.Fatalf("dropped-column probe %s.%s: %v", col.table, col.column, err)
		}
		if n != 0 {
			t.Fatalf("sm_api_* column %s.%s must be gone after contract, count=%d", col.table, col.column, n)
		}
	}

	if err := migrate.RunPhase14DropSMAPIColumns(ctx, db); err != nil {
		t.Fatalf("idempotent re-run: %v", err)
	}
}
