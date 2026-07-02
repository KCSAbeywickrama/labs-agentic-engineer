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

// DBTEST tier (skips under -short; the DB lane runs it): the webhook-driven
// state PROJECTOR against a pristine per-test Postgres (dbtest.New) with the
// REAL TaskRepository + real git_repositories rows. This is the centerpiece —
// the projector's guarantees are inherently SQL-shaped and cannot be faked:
//
//   - each transition runs under a per-task pg_advisory_xact_lock, so concurrent
//     webhook handlers for the same task serialise (proven with two goroutines
//     on one DB, under -race);
//   - the transition table (contracts.ApplyTaskEvent) is enforced end-to-end, and
//     late events on terminal rows are absorbed;
//   - lookups are org+project scoped via git_repositories, so a shared project
//     slug + PR number across orgs never crosses tenants.
//
// It also drives the real webhook Handler (link → advance, merge → build
// dispatch) through the real projector, and the StreamGenerateTasks entry
// point's advisory-locked idempotency guard. The pure transition ALGEBRA is
// owned by internal/contracts/task_state_test.go — not re-proven here; this
// proves task's USE of it against a real database.
package task

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/wso2/aep/aep-api/internal/contracts"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts/artifactstest"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// seedRepo inserts a git_repositories row so LookupOrgProjectByRepoURL can
// resolve repoFullName → (orgID, projectID). Clone URLs carry the `.git` suffix.
func seedRepo(t *testing.T, db *gorm.DB, orgID, projectID, repoFullName string) {
	t.Helper()
	err := repositories.NewRepoRepository(db).Create(context.Background(), &models.GitRepository{
		OrgID: orgID, ProjectID: projectID, Status: "ready",
		RepoURL: "https://github.com/" + repoFullName + ".git",
	})
	if err != nil {
		t.Fatalf("seed repo (%s): %v", repoFullName, err)
	}
}

// seedTask inserts a ComponentTask and returns its generated id.
func seedTask(t *testing.T, db *gorm.DB, task *models.ComponentTask) string {
	t.Helper()
	if err := repositories.NewTaskRepository(db).Create(context.Background(), task); err != nil {
		t.Fatalf("seed task: %v", err)
	}
	if task.ID == "" {
		t.Fatal("seed task: expected a generated id")
	}
	return task.ID
}

func reload(t *testing.T, db *gorm.DB, id string) *models.ComponentTask {
	t.Helper()
	got, err := repositories.NewTaskRepository(db).GetByID(context.Background(), id)
	if err != nil || got == nil {
		t.Fatalf("reload %s: %v", id, err)
	}
	return got
}

// fakeBuildDispatcher captures the merge handler's build trigger.
type fakeBuildDispatcher struct {
	fn func(ctx context.Context, task *models.ComponentTask, sha string) (string, error)
}

func (f *fakeBuildDispatcher) DispatchTaskBuild(ctx context.Context, task *models.ComponentTask, sha string) (string, error) {
	return f.fn(ctx, task, sha)
}

// fakeDispatchHook captures the post-commit deploy cascade trigger.
type fakeDispatchHook struct {
	ch chan [3]string
}

func (h *fakeDispatchHook) OnTaskDeployed(_ context.Context, orgID, projectID, componentName string) {
	h.ch <- [3]string{orgID, projectID, componentName}
}

// --- projector: transitions under the advisory lock -------------------------

func TestProjector_ApplyToTaskByPR_AdvancesState(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	seedRepo(t, db, "acme", "web", "acme/web")
	id := seedTask(t, db, &models.ComponentTask{OrgID: "acme", ProjectID: "web", ComponentName: "svc", PullRequestNumber: 7, Status: string(models.TaskStatusInProgress)})

	p := NewProjector(db)
	if err := p.ApplyToTaskByPR(ctx, "acme/web", 7, contracts.TaskEventPRReady, nil); err != nil {
		t.Fatalf("apply PRReady: %v", err)
	}
	got := reload(t, db, id)
	if got.Status != string(models.TaskStatusReadyForReview) {
		t.Fatalf("in_progress + PRReady → ready_for_review, got %q", got.Status)
	}
	if got.LastEventAt == nil {
		t.Fatal("LastEventAt must be stamped on a transition")
	}
}

func TestProjector_ApplyToTaskByPR_FillFieldsRidesTheWrite(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	seedRepo(t, db, "acme", "web", "acme/web")
	id := seedTask(t, db, &models.ComponentTask{OrgID: "acme", ProjectID: "web", ComponentName: "svc", PullRequestNumber: 7, Status: string(models.TaskStatusReadyForReview)})

	p := NewProjector(db)
	err := p.ApplyToTaskByPR(ctx, "acme/web", 7, contracts.TaskEventPRMerged, func(task *models.ComponentTask) {
		task.MergeCommitSHA = "deadbeef"
	})
	if err != nil {
		t.Fatalf("apply PRMerged: %v", err)
	}
	got := reload(t, db, id)
	if got.Status != string(models.TaskStatusMerged) || got.MergeCommitSHA != "deadbeef" {
		t.Fatalf("PRMerged must advance to merged AND persist the fillFields SHA, got status=%q sha=%q", got.Status, got.MergeCommitSHA)
	}
}

func TestProjector_LateEventOnTerminalIsAbsorbed(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	seedRepo(t, db, "acme", "web", "acme/web")
	id := seedTask(t, db, &models.ComponentTask{OrgID: "acme", ProjectID: "web", ComponentName: "svc", PullRequestNumber: 7, Status: string(models.TaskStatusDeployed)})

	// A late pr.merged on a terminal (deployed) task must NOT error and must NOT
	// change the status — it is silently absorbed (idempotent late delivery).
	p := NewProjector(db)
	if err := p.ApplyToTaskByPR(ctx, "acme/web", 7, contracts.TaskEventPRMerged, nil); err != nil {
		t.Fatalf("late event on terminal must be absorbed, got %v", err)
	}
	if got := reload(t, db, id); got.Status != string(models.TaskStatusDeployed) {
		t.Fatalf("terminal status must be unchanged, got %q", got.Status)
	}
}

func TestProjector_ApplyToTaskByPR_IsOrgAndProjectScoped(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	// FIVE orgs own a project with the SAME slug and the SAME PR numbers — a
	// real collision the org-scoped lookup must resolve to exactly the repo's
	// owner. Five decoys (not one) and three independent trials because task
	// IDs are random UUIDs and an under-filtered First() picks by uuid order:
	// with one decoy a dropped org_id WHERE clause passed ~50% of runs (review
	// finding B1); 5 orgs x 3 trials shrinks the luck-pass odds to (1/5)^3.
	orgs := []string{"acme", "evil", "mallory", "trudy", "eve"}
	for _, org := range orgs {
		seedRepo(t, db, org, "web", org+"/web")
	}
	p := NewProjector(db)
	for trial, pr := range []int{9, 10, 11} {
		ids := map[string]string{}
		for _, org := range orgs {
			ids[org] = seedTask(t, db, &models.ComponentTask{OrgID: org, ProjectID: "web", ComponentName: "svc", PullRequestNumber: pr, Status: string(models.TaskStatusInProgress)})
		}
		if err := p.ApplyToTaskByPR(ctx, "acme/web", pr, contracts.TaskEventPRReady, nil); err != nil {
			t.Fatalf("trial %d: apply for acme/web: %v", trial, err)
		}
		if got := reload(t, db, ids["acme"]); got.Status != string(models.TaskStatusReadyForReview) {
			t.Fatalf("trial %d: acme's task must advance, got %q", trial, got.Status)
		}
		for _, org := range orgs[1:] {
			if got := reload(t, db, ids[org]); got.Status != string(models.TaskStatusInProgress) {
				t.Fatalf("trial %d: %s's same-slug/same-PR task must be untouched, got %q", trial, org, got.Status)
			}
		}
	}
}

func TestProjector_ConcurrentSameTaskEventsSerialize(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	seedRepo(t, db, "acme", "web", "acme/web")
	id := seedTask(t, db, &models.ComponentTask{OrgID: "acme", ProjectID: "web", ComponentName: "svc", PullRequestNumber: 7, Status: string(models.TaskStatusInProgress)})

	// Two handlers deliver the SAME event for the SAME task at once. The per-task
	// advisory lock serialises them: the first advances in_progress→ready_for_review,
	// the second re-reads UNDER the lock, sees ready_for_review, and absorbs the
	// now-illegal repeat — no error, no double advance, no lost update (-race).
	p := NewProjector(db)
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = p.ApplyToTaskByPR(ctx, "acme/web", 7, contracts.TaskEventPRReady, nil)
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("goroutine %d errored: %v", i, err)
		}
	}
	if got := reload(t, db, id); got.Status != string(models.TaskStatusReadyForReview) {
		t.Fatalf("serialised applies must land exactly ready_for_review, got %q", got.Status)
	}
}

func TestProjector_MarkBuilding(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	id := seedTask(t, db, &models.ComponentTask{OrgID: "acme", ProjectID: "web", ComponentName: "svc", Status: string(models.TaskStatusMerged)})

	if err := NewProjector(db).MarkBuilding(ctx, id, "sha-1", "run-1"); err != nil {
		t.Fatalf("MarkBuilding: %v", err)
	}
	got := reload(t, db, id)
	if got.Status != string(models.TaskStatusBuilding) || got.LastBuildSHA != "sha-1" || got.LastBuildRunName != "run-1" {
		t.Fatalf("merged → building with run metadata, got %+v", got)
	}
}

func TestProjector_ApplyBuildResult_DeployedFiresDispatchHook(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	id := seedTask(t, db, &models.ComponentTask{OrgID: "acme", ProjectID: "web", ComponentName: "svc-a", Status: string(models.TaskStatusBuilding)})

	hook := &fakeDispatchHook{ch: make(chan [3]string, 1)}
	p := NewProjector(db)
	p.SetDispatchHook(hook)
	if err := p.ApplyBuildResult(ctx, id, contracts.TaskEventBuildSucceeded, ""); err != nil {
		t.Fatalf("ApplyBuildResult succeeded: %v", err)
	}
	got := reload(t, db, id)
	if got.Status != string(models.TaskStatusDeployed) || got.Cause == nil || *got.Cause != "build.deployed" {
		t.Fatalf("building + build.succeeded → deployed with cause, got %+v", got)
	}
	// The deploy cascade fires post-commit (fire-and-forget goroutine).
	select {
	case fired := <-hook.ch:
		if fired != [3]string{"acme", "web", "svc-a"} {
			t.Fatalf("dispatch hook args: got %v", fired)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("dispatch hook was never fired on deployed")
	}
}

func TestProjector_ApplyBuildResult_FailedRecordsErrorAndCause(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	id := seedTask(t, db, &models.ComponentTask{OrgID: "acme", ProjectID: "web", ComponentName: "svc", Status: string(models.TaskStatusBuilding)})

	if err := NewProjector(db).ApplyBuildResult(ctx, id, contracts.TaskEventBuildFailed, "image push denied"); err != nil {
		t.Fatalf("ApplyBuildResult failed: %v", err)
	}
	got := reload(t, db, id)
	if got.Status != string(models.TaskStatusFailed) || got.ErrorMessage != "image push denied" ||
		got.Cause == nil || *got.Cause != "build.failed" {
		t.Fatalf("building + build.failed → failed with error + cause, got %+v", got)
	}
}

func TestProjector_LinkTaskByIssue_PersistsPRFields(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	seedRepo(t, db, "acme", "web", "acme/web")
	id := seedTask(t, db, &models.ComponentTask{OrgID: "acme", ProjectID: "web", ComponentName: "svc", IssueNumber: 3, Status: string(models.TaskStatusInProgress)})

	err := NewProjector(db).LinkTaskByIssue(ctx, "acme/web", 3, func(task *models.ComponentTask) {
		task.PullRequestNumber = 11
		task.PullRequestURL = "https://github.com/acme/web/pull/11"
		task.BranchName = "feature/x"
	})
	if err != nil {
		t.Fatalf("LinkTaskByIssue: %v", err)
	}
	got := reload(t, db, id)
	// Link persists PR fields WITHOUT advancing the lifecycle.
	if got.PullRequestNumber != 11 || got.BranchName != "feature/x" || got.Status != string(models.TaskStatusInProgress) {
		t.Fatalf("link must persist PR fields without a state transition, got %+v", got)
	}
}

func TestProjector_NoMatchingTaskIsNotFound(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	seedRepo(t, db, "acme", "web", "acme/web")
	// No task with PR #404 → the sentinel the webhook handlers swallow.
	err := NewProjector(db).ApplyToTaskByPR(ctx, "acme/web", 404, contracts.TaskEventPRReady, nil)
	if !IsTaskNotFound(err) {
		t.Fatalf("no matching PR must be IsTaskNotFound, got %v", err)
	}
}

// --- the real webhook Handler over the real projector ------------------------

func TestHandler_PullRequestOpened_LinksThenAdvances(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	seedRepo(t, db, "acme", "web", "acme/web")
	id := seedTask(t, db, &models.ComponentTask{OrgID: "acme", ProjectID: "web", ComponentName: "svc", IssueNumber: 3, Status: string(models.TaskStatusInProgress)})

	h := &Handler{db: db, projector: NewProjector(db)}
	body := `{"pull_request":{"number":7,"html_url":"https://github.com/acme/web/pull/7","body":"Fixes the greeting.\n\nCloses #3","draft":false,"head":{"ref":"feat/greeting"}},"repository":{"full_name":"acme/web"}}`
	if err := h.PullRequestOpened(ctx, "pull_request", "opened", []byte(body)); err != nil {
		t.Fatalf("PullRequestOpened: %v", err)
	}
	got := reload(t, db, id)
	// The PR is linked by Closes #3 AND, being non-draft, advances the lifecycle.
	if got.PullRequestNumber != 7 || got.BranchName != "feat/greeting" {
		t.Fatalf("PR linkage not persisted: %+v", got)
	}
	if got.Status != string(models.TaskStatusReadyForReview) {
		t.Fatalf("non-draft opened PR must advance to ready_for_review, got %q", got.Status)
	}
}

func TestHandler_PullRequestClosed_MergedDispatchesBuild(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	seedRepo(t, db, "acme", "web", "acme/web")
	id := seedTask(t, db, &models.ComponentTask{OrgID: "acme", ProjectID: "web", ComponentName: "svc", PullRequestNumber: 7, Status: string(models.TaskStatusReadyForReview)})

	var dispatchedSHA string
	var dispatchedTask string
	builds := &fakeBuildDispatcher{fn: func(_ context.Context, task *models.ComponentTask, sha string) (string, error) {
		dispatchedTask, dispatchedSHA = task.ID, sha
		return "run-x", nil
	}}
	h := &Handler{db: db, projector: NewProjector(db), wfService: builds}

	body := `{"pull_request":{"number":7,"merged":true,"merge_commit_sha":"cafebabe"},"repository":{"full_name":"acme/web"}}`
	if err := h.PullRequestClosed(ctx, "pull_request", "closed", []byte(body)); err != nil {
		t.Fatalf("PullRequestClosed: %v", err)
	}
	got := reload(t, db, id)
	if got.Status != string(models.TaskStatusMerged) || got.MergeCommitSHA != "cafebabe" {
		t.Fatalf("merged PR must advance to merged + record SHA, got status=%q sha=%q", got.Status, got.MergeCommitSHA)
	}
	// The merge handler dispatches the build for exactly this task + merge SHA.
	if dispatchedTask != id || dispatchedSHA != "cafebabe" {
		t.Fatalf("build not dispatched for the merged task: task=%q sha=%q", dispatchedTask, dispatchedSHA)
	}
}

// --- StreamGenerateTasks: the advisory-locked idempotency guard --------------

func TestStreamGenerateTasks_NoopWhenTasksMatchCurrentVersions(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	// A live task already exists for the CURRENT (spec, design) version pair, so
	// re-clicking "Generate" is a no-op: the run takes the real per-project
	// advisory lock, reads the DB, sees nothing changed, and emits data-finish
	// WITHOUT ever calling the (panic-if-touched) agents client.
	seedTask(t, db, &models.ComponentTask{
		OrgID: "acme", ProjectID: "web", ComponentName: "svc",
		Status: string(models.TaskStatusPending), SourceSpecVersion: "v1", SourceDesignVersion: "v1-1",
	})

	fake := &artifactstest.FakeArtifactService{
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{"requirements.md": "# R"}, nil
		},
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{artifacts.DesignRootFile: "# Overview"}, nil
		},
		ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
			return []artifacts.RequirementsVersionInfo{{Tag: "v1", Version: 1}}, nil
		},
		ListDesignVersionsFunc: func(context.Context, string, string) ([]artifacts.DesignVersionInfo, error) {
			return []artifacts.DesignVersionInfo{{Tag: "v1-1"}}, nil
		},
	}
	store := artifacts.NewArtifactStore(fake)
	// agents client left unset → any call panics, proving the no-op never streams.
	svc := NewTaskService(db, repositories.NewTaskRepository(db), store, nil, fake, nil, &fakeAgents{})

	var out strings.Builder
	if err := svc.StreamGenerateTasks(ctx, "acme", "web", &out, func() {}); err != nil {
		t.Fatalf("StreamGenerateTasks: %v", err)
	}
	if !strings.Contains(out.String(), "data-finish") {
		t.Fatalf("idempotent generate must emit data-finish, got: %s", out.String())
	}
}
