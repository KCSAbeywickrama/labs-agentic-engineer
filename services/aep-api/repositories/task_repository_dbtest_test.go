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
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// TestTaskRepository_GetByIDScoped_OrgIsolation guards against a by-UUID
// cross-org task IDOR: the operator task routes are path-scoped (orgHandle +
// taskId), so loading by UUID alone would let org A pass org B's {taskId} and
// operate on B's task. GetByIDScoped loads by (org_id, id) and returns
// (nil, nil) for both "no such task" and "task belongs to another org" — no
// existence leak. This test confirms the scoping against real Postgres (no
// mock), on a pristine per-test database (dbtest.New); it skips under -short.
func TestTaskRepository_GetByIDScoped_OrgIsolation(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)

	repo := repositories.NewTaskRepository(db)
	ctx := context.Background()

	mk := func(org, proj, component string) *models.ComponentTask {
		t.Helper()
		task := &models.ComponentTask{
			OrgID:         org,
			ProjectID:     proj,
			ComponentName: component,
			Status:        string(models.TaskStatusPending),
		}
		if err := repo.Create(ctx, task); err != nil {
			t.Fatalf("create (%s,%s,%s): %v", org, proj, component, err)
		}
		if task.ID == "" {
			t.Fatalf("create (%s,%s,%s): expected generated id", org, proj, component)
		}
		return task
	}
	// Same project slug under two different orgs is fine — tasks are isolated by org.
	taskA := mk("orga", "shared-proj", "svc-a")
	mk("orgb", "shared-proj", "svc-b")

	// Owner org resolves its own task.
	got, err := repo.GetByIDScoped(ctx, "orga", taskA.ID)
	if err != nil {
		t.Fatalf("GetByIDScoped(orga, taskA): %v", err)
	}
	if got == nil || got.ID != taskA.ID || got.OrgID != "orga" {
		t.Fatalf("expected taskA for owner org, got %+v", got)
	}

	// A different org asking for org-a's task id resolves to (nil, nil) — the
	// IDOR-closing behaviour. No existence leak: same result as a bogus id.
	cross, err := repo.GetByIDScoped(ctx, "orgb", taskA.ID)
	if err != nil {
		t.Fatalf("GetByIDScoped(orgb, taskA): %v", err)
	}
	if cross != nil {
		t.Fatalf("cross-org lookup leaked a task: %+v", cross)
	}

	// Unknown id under the owner org is also (nil, nil) — indistinguishable
	// from the cross-org case.
	missing, err := repo.GetByIDScoped(ctx, "orga", "00000000-0000-0000-0000-000000000000")
	if err != nil {
		t.Fatalf("GetByIDScoped(orga, nonexistent): %v", err)
	}
	if missing != nil {
		t.Fatalf("nonexistent id returned a task: %+v", missing)
	}
}

// mkTask persists a ComponentTask against real Postgres, defaulting the status
// to pending, and returns the generated id. Shared by the CRUD dbtest cases.
func mkTask(t *testing.T, repo repositories.TaskRepository, task *models.ComponentTask) *models.ComponentTask {
	t.Helper()
	if task.Status == "" {
		task.Status = string(models.TaskStatusPending)
	}
	if err := repo.Create(context.Background(), task); err != nil {
		t.Fatalf("create task (%s/%s/%s): %v", task.OrgID, task.ProjectID, task.ComponentName, err)
	}
	if task.ID == "" {
		t.Fatalf("create task (%s/%s/%s): expected generated id", task.OrgID, task.ProjectID, task.ComponentName)
	}
	return task
}

// TestTaskRepository_GetByID_IsOrgBlind pins that GetByID resolves by UUID
// alone (NO org filter) — it is the runner-callback authz accessor, not an
// authorization boundary. A bogus id is (nil, nil), not an error.
func TestTaskRepository_GetByID_IsOrgBlind(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := repositories.NewTaskRepository(db)
	ctx := context.Background()

	task := mkTask(t, repo, &models.ComponentTask{OrgID: "orga", ProjectID: "proj", ComponentName: "svc"})

	got, err := repo.GetByID(ctx, task.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got == nil || got.ID != task.ID || got.OrgID != "orga" {
		t.Fatalf("GetByID did not resolve the task by uuid: %+v", got)
	}

	missing, err := repo.GetByID(ctx, "00000000-0000-0000-0000-000000000000")
	if err != nil {
		t.Fatalf("GetByID(nonexistent): %v", err)
	}
	if missing != nil {
		t.Fatalf("nonexistent id returned a task: %+v", missing)
	}
}

// TestTaskRepository_GetByComponentName_OrgAndProjectScoped confirms the lookup
// is fenced by all three of (org_id, project_id, component_name): decoys that
// share the same component name under a different org or a different project
// must not resolve.
func TestTaskRepository_GetByComponentName_OrgAndProjectScoped(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := repositories.NewTaskRepository(db)
	ctx := context.Background()

	want := mkTask(t, repo, &models.ComponentTask{OrgID: "orga", ProjectID: "proj", ComponentName: "svc"})
	// Decoys sharing the component name across the org / project axes.
	mkTask(t, repo, &models.ComponentTask{OrgID: "orgb", ProjectID: "proj", ComponentName: "svc"})
	mkTask(t, repo, &models.ComponentTask{OrgID: "orga", ProjectID: "other", ComponentName: "svc"})
	mkTask(t, repo, &models.ComponentTask{OrgID: "orgb", ProjectID: "other", ComponentName: "svc"})

	got, err := repo.GetByComponentName(ctx, "orga", "proj", "svc")
	if err != nil {
		t.Fatalf("GetByComponentName: %v", err)
	}
	if got == nil || got.ID != want.ID {
		t.Fatalf("GetByComponentName returned the wrong row: %+v", got)
	}

	// Cross-org same (project, component) resolves to nil, not the decoy.
	cross, err := repo.GetByComponentName(ctx, "orgc", "proj", "svc")
	if err != nil {
		t.Fatalf("GetByComponentName(orgc): %v", err)
	}
	if cross != nil {
		t.Fatalf("unknown org leaked a task: %+v", cross)
	}
}

// TestTaskRepository_ListByProjectID_ScopedAndOrdered confirms the list is
// org+project scoped and ordered by (order ASC, component_name ASC).
func TestTaskRepository_ListByProjectID_ScopedAndOrdered(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := repositories.NewTaskRepository(db)
	ctx := context.Background()

	// Insert out of order; same order value tie-breaks on component_name.
	mkTask(t, repo, &models.ComponentTask{OrgID: "orga", ProjectID: "proj", ComponentName: "gamma", Order: 2})
	mkTask(t, repo, &models.ComponentTask{OrgID: "orga", ProjectID: "proj", ComponentName: "alpha", Order: 1})
	mkTask(t, repo, &models.ComponentTask{OrgID: "orga", ProjectID: "proj", ComponentName: "beta", Order: 1})
	// Decoys: same project slug under another org, and another project.
	mkTask(t, repo, &models.ComponentTask{OrgID: "orgb", ProjectID: "proj", ComponentName: "intruder"})
	mkTask(t, repo, &models.ComponentTask{OrgID: "orga", ProjectID: "other", ComponentName: "elsewhere"})

	got, err := repo.ListByProjectID(ctx, "orga", "proj")
	if err != nil {
		t.Fatalf("ListByProjectID: %v", err)
	}
	names := make([]string, len(got))
	for i, tk := range got {
		names[i] = tk.ComponentName
		if tk.OrgID != "orga" || tk.ProjectID != "proj" {
			t.Fatalf("list leaked an out-of-scope row: %+v", tk)
		}
	}
	want := []string{"alpha", "beta", "gamma"} // order 1(alpha,beta), then 2(gamma)
	if len(names) != len(want) {
		t.Fatalf("ListByProjectID returned %v; want %v", names, want)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("ordering drifted: got %v; want %v", names, want)
		}
	}
}

// TestTaskRepository_ListNonTerminalByOrgID confirms org scoping and that the
// terminal statuses (deployed, rejected, failed, abandoned) are excluded while
// every other status — including on_hold — is returned.
func TestTaskRepository_ListNonTerminalByOrgID(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := repositories.NewTaskRepository(db)
	ctx := context.Background()

	nonTerminal := []models.TaskStatus{
		models.TaskStatusPending,
		models.TaskStatusInProgress,
		models.TaskStatusReadyForReview,
		models.TaskStatusMerged,
		models.TaskStatusBuilding,
		models.TaskStatusOnHold, // NOT in the terminal set → returned
	}
	terminal := []models.TaskStatus{
		models.TaskStatusDeployed,
		models.TaskStatusRejected,
		models.TaskStatusFailed,
		models.TaskStatusAbandoned,
	}
	for i, s := range nonTerminal {
		mkTask(t, repo, &models.ComponentTask{OrgID: "orga", ProjectID: "proj", ComponentName: "nt-" + string(rune('a'+i)), Status: string(s)})
	}
	for i, s := range terminal {
		mkTask(t, repo, &models.ComponentTask{OrgID: "orga", ProjectID: "proj", ComponentName: "t-" + string(rune('a'+i)), Status: string(s)})
	}
	// Decoy: a non-terminal task under a different org must not appear.
	mkTask(t, repo, &models.ComponentTask{OrgID: "orgb", ProjectID: "proj", ComponentName: "other", Status: string(models.TaskStatusPending)})

	wantStatuses := map[string]bool{}
	for _, s := range nonTerminal {
		wantStatuses[string(s)] = true
	}
	got, err := repo.ListNonTerminalByOrgID(ctx, "orga")
	if err != nil {
		t.Fatalf("ListNonTerminalByOrgID: %v", err)
	}
	if len(got) != len(nonTerminal) {
		t.Fatalf("want %d non-terminal tasks; got %d (%+v)", len(nonTerminal), len(got), got)
	}
	for _, tk := range got {
		if tk.OrgID != "orga" {
			t.Fatalf("leaked another org's task: %+v", tk)
		}
		if !wantStatuses[tk.Status] {
			t.Fatalf("row with excluded status returned: %+v", tk)
		}
	}
}

// TestTaskRepository_GetBaselineBatch pins that the baseline is the most-recent
// batch (by MAX(created_at)) that still has at least one task in a live status,
// scoped to (org, project). Rejected/failed/abandoned-only batches do not
// qualify.
func TestTaskRepository_GetBaselineBatch(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := repositories.NewTaskRepository(db)
	ctx := context.Background()

	base := time.Now().Add(-24 * time.Hour)
	batch1 := "11111111-1111-1111-1111-111111111111"
	batch2 := "22222222-2222-2222-2222-222222222222"
	batch3 := "33333333-3333-3333-3333-333333333333"
	mkBatchTask := func(org, proj, batch, spec, design, status string, at time.Time) {
		t.Helper()
		b := batch
		mkTask(t, repo, &models.ComponentTask{
			OrgID: org, ProjectID: proj, ComponentName: "c-" + status,
			BatchID: &b, SourceSpecVersion: spec, SourceDesignVersion: design,
			Status: status, CreatedAt: at,
		})
	}

	// Older live batch, then a newer live batch → newer wins.
	mkBatchTask("orga", "proj", batch1, "v1", "v1", string(models.TaskStatusDeployed), base)
	mkBatchTask("orga", "proj", batch2, "v2", "v2-1", string(models.TaskStatusInProgress), base.Add(1*time.Hour))
	// Newest batch but only a rejected task → does NOT qualify as a baseline.
	mkBatchTask("orga", "proj", batch3, "v3", "v3", string(models.TaskStatusRejected), base.Add(2*time.Hour))
	// Decoy under another org+project with a live batch — must be ignored.
	mkBatchTask("orgb", "proj", "44444444-4444-4444-4444-444444444444", "vX", "vX", string(models.TaskStatusMerged), base.Add(3*time.Hour))

	gotBatch, gotSpec, gotDesign, err := repo.GetBaselineBatch(ctx, "orga", "proj")
	if err != nil {
		t.Fatalf("GetBaselineBatch: %v", err)
	}
	if gotBatch != batch2 || gotSpec != "v2" || gotDesign != "v2-1" {
		t.Fatalf("baseline = (%q,%q,%q); want the most recent LIVE batch (%q, v2, v2-1)", gotBatch, gotSpec, gotDesign, batch2)
	}

	// A project with no tasks at all → empty triple, no error.
	eb, es, ed, err := repo.GetBaselineBatch(ctx, "orga", "empty")
	if err != nil {
		t.Fatalf("GetBaselineBatch(empty): %v", err)
	}
	if eb != "" || es != "" || ed != "" {
		t.Fatalf("empty project should yield an empty baseline; got (%q,%q,%q)", eb, es, ed)
	}
}

// TestTaskRepository_Update round-trips a full-row Save.
func TestTaskRepository_Update(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := repositories.NewTaskRepository(db)
	ctx := context.Background()

	task := mkTask(t, repo, &models.ComponentTask{OrgID: "orga", ProjectID: "proj", ComponentName: "svc"})
	task.Status = string(models.TaskStatusInProgress)
	task.PullRequestNumber = 42
	task.BranchName = "feat/x"
	if err := repo.Update(ctx, task); err != nil {
		t.Fatalf("Update: %v", err)
	}

	got, err := repo.GetByID(ctx, task.ID)
	if err != nil || got == nil {
		t.Fatalf("reload: %v / %v", got, err)
	}
	if got.Status != string(models.TaskStatusInProgress) || got.PullRequestNumber != 42 || got.BranchName != "feat/x" {
		t.Fatalf("Update did not persist: %+v", got)
	}
}

// TestTaskRepository_UpdateBody confirms UpdateBody writes ONLY the body column
// — a concurrent status change on the row must survive a body-only write.
func TestTaskRepository_UpdateBody(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := repositories.NewTaskRepository(db)
	ctx := context.Background()

	task := mkTask(t, repo, &models.ComponentTask{
		OrgID: "orga", ProjectID: "proj", ComponentName: "svc",
		Body: "old body", Status: string(models.TaskStatusPending),
	})
	// Simulate a concurrent dispatch advancing status directly in the DB.
	if err := db.Exec(`UPDATE component_tasks SET status = ? WHERE id = ?`, string(models.TaskStatusInProgress), task.ID).Error; err != nil {
		t.Fatalf("concurrent status write: %v", err)
	}

	if err := repo.UpdateBody(ctx, task.ID, "new body"); err != nil {
		t.Fatalf("UpdateBody: %v", err)
	}
	got, err := repo.GetByID(ctx, task.ID)
	if err != nil || got == nil {
		t.Fatalf("reload: %v / %v", got, err)
	}
	if got.Body != "new body" {
		t.Errorf("body not updated: %q", got.Body)
	}
	if got.Status != string(models.TaskStatusInProgress) {
		t.Errorf("UpdateBody clobbered the concurrently-written status: %q (want in_progress)", got.Status)
	}
}

// TestTaskRepository_SetBodySyncPending confirms the column toggles both ways
// without touching sibling columns.
func TestTaskRepository_SetBodySyncPending(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := repositories.NewTaskRepository(db)
	ctx := context.Background()

	task := mkTask(t, repo, &models.ComponentTask{OrgID: "orga", ProjectID: "proj", ComponentName: "svc", BodySyncPending: false})
	if err := repo.SetBodySyncPending(ctx, task.ID, true); err != nil {
		t.Fatalf("SetBodySyncPending(true): %v", err)
	}
	got, _ := repo.GetByID(ctx, task.ID)
	if got == nil || !got.BodySyncPending {
		t.Fatalf("expected BodySyncPending=true; got %+v", got)
	}
	if err := repo.SetBodySyncPending(ctx, task.ID, false); err != nil {
		t.Fatalf("SetBodySyncPending(false): %v", err)
	}
	got, _ = repo.GetByID(ctx, task.ID)
	if got == nil || got.BodySyncPending {
		t.Fatalf("expected BodySyncPending=false; got %+v", got)
	}
}

// TestTaskRepository_DeleteByProjectID_OrgScoped deletes only the (org, project)
// tasks and leaves same-slug decoys in other orgs / projects intact.
func TestTaskRepository_DeleteByProjectID_OrgScoped(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := repositories.NewTaskRepository(db)
	ctx := context.Background()

	mkTask(t, repo, &models.ComponentTask{OrgID: "orga", ProjectID: "proj", ComponentName: "a"})
	mkTask(t, repo, &models.ComponentTask{OrgID: "orga", ProjectID: "proj", ComponentName: "b"})
	keepOtherOrg := mkTask(t, repo, &models.ComponentTask{OrgID: "orgb", ProjectID: "proj", ComponentName: "c"})
	keepOtherProj := mkTask(t, repo, &models.ComponentTask{OrgID: "orga", ProjectID: "other", ComponentName: "d"})

	if err := repo.DeleteByProjectID(ctx, "orga", "proj"); err != nil {
		t.Fatalf("DeleteByProjectID: %v", err)
	}
	if got, _ := repo.ListByProjectID(ctx, "orga", "proj"); len(got) != 0 {
		t.Fatalf("expected (orga,proj) emptied; got %d", len(got))
	}
	// Decoys survive.
	if got, _ := repo.GetByID(ctx, keepOtherOrg.ID); got == nil {
		t.Errorf("delete crossed into another org's project")
	}
	if got, _ := repo.GetByID(ctx, keepOtherProj.ID); got == nil {
		t.Errorf("delete crossed into another project in the same org")
	}
}

// TestTaskRepository_DeleteAll clears the table wholesale (test/dev utility).
func TestTaskRepository_DeleteAll(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := repositories.NewTaskRepository(db)
	ctx := context.Background()

	mkTask(t, repo, &models.ComponentTask{OrgID: "orga", ProjectID: "proj", ComponentName: "a"})
	mkTask(t, repo, &models.ComponentTask{OrgID: "orgb", ProjectID: "proj", ComponentName: "b"})

	if err := repo.DeleteAll(ctx); err != nil {
		t.Fatalf("DeleteAll: %v", err)
	}
	if got, _ := repo.ListByProjectID(ctx, "orga", "proj"); len(got) != 0 {
		t.Fatalf("orga not cleared: %d rows", len(got))
	}
	if got, _ := repo.ListByProjectID(ctx, "orgb", "proj"); len(got) != 0 {
		t.Fatalf("orgb not cleared: %d rows", len(got))
	}
}
