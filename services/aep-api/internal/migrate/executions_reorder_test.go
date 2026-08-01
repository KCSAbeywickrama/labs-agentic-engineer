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
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/contracts/taskmeta"
	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/migrate"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
)

// CREATE must precede DROP so the admission mutex is never unenforced during
// the upgrade — same rationale as RunMilestoneRuns.
func TestExecutionsAdmissionStatements_CreateThenDrop(t *testing.T) {
	t.Parallel()
	stmts := migrate.ExecutionsAdmissionStatements()
	if len(stmts) != 2 {
		t.Fatalf("got %d statements, want 2", len(stmts))
	}
	if !strings.Contains(strings.ToUpper(stmts[0]), "CREATE") {
		t.Fatalf("first statement must CREATE the new index, got: %s", stmts[0])
	}
	if !strings.Contains(strings.ToUpper(stmts[1]), "DROP") {
		t.Fatalf("second statement must DROP the legacy index, got: %s", stmts[1])
	}
	if strings.Contains(strings.ToUpper(stmts[0]), "DROP") {
		t.Fatalf("first statement must not DROP: %s", stmts[0])
	}
}

// After upgrading a DB that only has the legacy admission index, only the
// component-keyed index remains and a second active admit for the same key
// is refused.
func TestRunExecutions_LegacyIndexUpgrade_AdmissionHeld(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	if err := db.Exec(`DROP INDEX IF EXISTS ux_executions_admission_component`).Error; err != nil {
		t.Fatalf("drop new index: %v", err)
	}
	if err := db.Exec(`
		CREATE UNIQUE INDEX ux_executions_admission
		ON executions (repo, issue_number, kind)
		WHERE status IN ('queued', 'running')`).Error; err != nil {
		t.Fatalf("create legacy index: %v", err)
	}

	if err := migrate.RunExecutions(ctx, db); err != nil {
		t.Fatalf("RunExecutions: %v", err)
	}

	var hasNew, hasLegacy bool
	if err := db.Raw(`SELECT EXISTS (
		SELECT 1 FROM pg_indexes WHERE indexname = 'ux_executions_admission_component')`).
		Scan(&hasNew).Error; err != nil {
		t.Fatalf("check new index: %v", err)
	}
	if err := db.Raw(`SELECT EXISTS (
		SELECT 1 FROM pg_indexes WHERE indexname = 'ux_executions_admission')`).
		Scan(&hasLegacy).Error; err != nil {
		t.Fatalf("check legacy index: %v", err)
	}
	if !hasNew {
		t.Fatal("want ux_executions_admission_component after upgrade")
	}
	if hasLegacy {
		t.Fatal("legacy ux_executions_admission must be dropped after upgrade")
	}

	repo := delivery.NewExecutionRepository(db, nil)
	first := &delivery.Execution{
		OrgID:       "orga",
		ProjectID:   "proj",
		Repo:        "acme/repo",
		IssueNumber: 42,
		Kind:        string(taskmeta.KindCoding),
		Component:   "web",
	}
	ok, _, err := repo.TryAdmit(ctx, first)
	if err != nil || !ok {
		t.Fatalf("TryAdmit(first) = (%v, %v), want admitted", ok, err)
	}
	second := &delivery.Execution{
		OrgID:       "orga",
		ProjectID:   "proj",
		Repo:        "acme/repo",
		IssueNumber: 42,
		Kind:        string(taskmeta.KindCoding),
		Component:   "web",
	}
	ok, _, err = repo.TryAdmit(ctx, second)
	if err != nil {
		t.Fatalf("TryAdmit(second): %v", err)
	}
	if ok {
		t.Fatal("TryAdmit(second) admitted — component admission mutex not enforced")
	}
}
