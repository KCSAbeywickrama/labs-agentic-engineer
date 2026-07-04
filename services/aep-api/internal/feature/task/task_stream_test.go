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

// UNIT tier — the two-phase tech-lead orchestration, tested per the SSE rule
// (bff-component-testing.md §7): assert stream COMPLETION + the persisted
// SIDE-EFFECTS (task rows created via the faked repo, GitHub issue calls
// captured via the faked issue service, body persisted), NOT the raw stream
// framing (that is integration-owned). The full StreamGenerateTasks entry point
// takes a real per-project advisory lock + transaction, so it is exercised
// against real Postgres in task_dbtest_test.go; here we drive the inner,
// DB-free stages that the entry point composes.
package task

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/agents"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts/artifactstest"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/models"
)

func nopFlush() {}

// --- proxyPlanStream ----------------------------------------------------------

func TestProxyPlanStream_CollectsItemsAndCompletes(t *testing.T) {
	t.Parallel()
	upstream := strings.NewReader(
		`data: {"type":"data-plan-item","data":{"tempId":"p1","componentName":"svc-a","title":"T1","rationale":"R1","dependsOn":[]}}` + "\n" +
			`data: {"type":"data-plan-item","data":{"tempId":"p2","componentName":"svc-b","title":"T2","rationale":"R2","dependsOn":["svc-a"]}}` + "\n" +
			`data: {"type":"data-plan-complete"}` + "\n",
	)
	out := &bytes.Buffer{}
	items, err := proxyPlanStream(context.Background(), upstream, newSseWriter(out, nopFlush))
	if err != nil {
		t.Fatalf("proxyPlanStream: %v", err)
	}
	if len(items) != 2 || items[0].TempID != "p1" || items[1].ComponentName != "svc-b" {
		t.Fatalf("collected items drifted: %+v", items)
	}
	// The plan-item frames are proxied to the console; data-plan-complete is NOT
	// (the BFF emits its own data-finish later).
	if !strings.Contains(out.String(), "data-plan-item") || strings.Contains(out.String(), "data-plan-complete") {
		t.Fatalf("passthrough contract broke: %s", out.String())
	}
}

func TestProxyPlanStream_ErrorFrameReturnsError(t *testing.T) {
	t.Parallel()
	upstream := strings.NewReader(`data: {"type":"error","data":{"errorText":"model exploded"}}` + "\n")
	_, err := proxyPlanStream(context.Background(), upstream, newSseWriter(&bytes.Buffer{}, nopFlush))
	if err == nil {
		t.Fatal("an upstream error frame must surface as a plan-scope error")
	}
}

func TestProxyPlanStream_ClosedWithoutCompletionOrItemsErrors(t *testing.T) {
	t.Parallel()
	// A stream that closes with neither items nor a completion marker is a
	// truncated upstream — the orchestrator must not silently proceed.
	upstream := strings.NewReader(": keep-alive\n")
	_, err := proxyPlanStream(context.Background(), upstream, newSseWriter(&bytes.Buffer{}, nopFlush))
	if err == nil {
		t.Fatal("a stream closed without completion or items must error")
	}
}

// --- persistAndIssue ----------------------------------------------------------

// streamSvc builds a taskService for the DB-free stream stages: only the repo,
// issue service and artifact store are wired; the entry-point's db/tx is out of
// scope here (see the dbtest tier).
func streamSvc(repo *fakeTaskRepo, issues gitrepo.IssueService, store *artifacts.ArtifactStore) *taskService {
	return NewTaskService(nil, repo, store, issues, nil, nil, nil)
}

func TestPersistAndIssue_CreatesRowsAndOpensIssues(t *testing.T) {
	t.Parallel()
	var created, updated int
	repo := &fakeTaskRepo{
		CreateFunc: func(_ context.Context, task *models.ComponentTask) error {
			created++
			task.ID = "task-" + task.ComponentName // stand in for the DB-generated UUID
			// The row is persisted in the WAITING lifecycle before the issue exists.
			if task.Status != string(models.TaskStatusPending) ||
				task.LifecycleStatus != string(models.TaskLifecycleGhIssueWaiting) ||
				task.ExecType != "WORKER" {
				t.Errorf("row not persisted in the expected pre-issue shape: %+v", task)
			}
			return nil
		},
		UpdateFunc: func(context.Context, *models.ComponentTask) error { updated++; return nil },
	}
	issues := &fakeIssueSvc{CreateIssueFunc: func(_ context.Context, _, _ string, req gitrepo.CreateIssueRequest) (*gitrepo.IssueResult, error) {
		if req.Title == "" {
			t.Error("issue create must carry a title")
		}
		return &gitrepo.IssueResult{Number: 7, URL: "https://gh/7"}, nil
	}}
	svc := streamSvc(repo, issues, nil)

	design := &artifacts.DesignFile{Components: []models.DesignComponent{{Name: "svc-a"}}}
	plan := []planItemFrame{{TempID: "p1", ComponentName: "svc-a", Title: "T1", Rationale: "R1"}}
	out := &bytes.Buffer{}

	rows, err := svc.persistAndIssue(context.Background(), newSseWriter(out, nopFlush), "acme", "web", "batch-1", "v1", "v1-1", plan, design, "https://github.com/o/r.git", "o-r")
	if err != nil {
		t.Fatalf("persistAndIssue: %v", err)
	}
	if created != 1 || updated != 1 {
		t.Fatalf("expected 1 create + 1 update (issue metadata), got create=%d update=%d", created, updated)
	}
	if len(rows) != 1 || !rows[0].IssueOK || rows[0].Task.IssueNumber != 7 {
		t.Fatalf("row not marked issued: %+v", rows[0])
	}
	if !strings.Contains(out.String(), "data-task-issued") {
		t.Fatalf("data-task-issued frame not emitted: %s", out.String())
	}
}

func TestPersistAndIssue_IssueFailureMarksTaskFailed(t *testing.T) {
	t.Parallel()
	var lastSaved *models.ComponentTask
	repo := &fakeTaskRepo{
		CreateFunc: func(_ context.Context, task *models.ComponentTask) error { task.ID = "t1"; return nil },
		UpdateFunc: func(_ context.Context, task *models.ComponentTask) error { lastSaved = task; return nil },
	}
	issues := &fakeIssueSvc{CreateIssueFunc: func(context.Context, string, string, gitrepo.CreateIssueRequest) (*gitrepo.IssueResult, error) {
		return nil, errors.New("github secondary rate limit")
	}}
	svc := streamSvc(repo, issues, nil)

	design := &artifacts.DesignFile{Components: []models.DesignComponent{{Name: "svc-a"}}}
	plan := []planItemFrame{{TempID: "p1", ComponentName: "svc-a", Title: "T1"}}
	out := &bytes.Buffer{}

	rows, err := svc.persistAndIssue(context.Background(), newSseWriter(out, nopFlush), "acme", "web", "b", "v1", "v1-1", plan, design, "", "")
	if err != nil {
		t.Fatalf("a per-issue failure must not fail the batch: %v", err)
	}
	if rows[0].IssueOK {
		t.Fatalf("row should be marked issue-failed: %+v", rows[0])
	}
	if lastSaved == nil || lastSaved.Status != string(models.TaskStatusFailed) ||
		lastSaved.LifecycleStatus != string(models.TaskLifecycleGhIssueFailed) {
		t.Fatalf("failed row not persisted with failure state: %+v", lastSaved)
	}
	if !strings.Contains(out.String(), "data-task-issue-failed") {
		t.Fatalf("data-task-issue-failed frame not emitted: %s", out.String())
	}
}

func TestPersistAndIssue_UnknownDependencyIsRejected(t *testing.T) {
	t.Parallel()
	// DependsOnComponents is platform-authored from the design; a reference to a
	// component absent from the design is a hard error (gating must not fail open
	// on a bad identifier), and no row is created.
	repo := &fakeTaskRepo{CreateFunc: func(context.Context, *models.ComponentTask) error {
		t.Error("no row must be created when a dependency is invalid")
		return nil
	}}
	svc := streamSvc(repo, &fakeIssueSvc{}, nil)

	design := &artifacts.DesignFile{Components: []models.DesignComponent{{Name: "svc-a", Dependencies: []models.Dependency{{Kind: models.DependencyKindComponent, Name: "ghost"}}}}}
	plan := []planItemFrame{{TempID: "p1", ComponentName: "svc-a"}}

	if _, err := svc.persistAndIssue(context.Background(), newSseWriter(&bytes.Buffer{}, nopFlush), "acme", "web", "b", "v1", "v1-1", plan, design, "", ""); err == nil {
		t.Fatal("a dependsOn referencing an unknown component must error")
	}
}

// --- proxyDetailStream --------------------------------------------------------

func TestProxyDetailStream_PersistsBody(t *testing.T) {
	t.Parallel()
	var bodyPersisted string
	repo := &fakeTaskRepo{UpdateBodyFunc: func(_ context.Context, id, body string) error {
		if id != "t1" {
			t.Errorf("UpdateBody id: got %q", id)
		}
		bodyPersisted = body
		return nil
	}}
	// IssueNumber 0 → the async issue-body edit short-circuits, so this asserts
	// the synchronous body persistence deterministically.
	svc := streamSvc(repo, &fakeIssueSvc{}, nil)
	persisted := []persistedItem{{Task: &models.ComponentTask{ID: "t1", IssueNumber: 0}}}

	upstream := strings.NewReader(
		`data: {"type":"data-task-body-delta","data":{"taskId":"t1","delta":"partial"}}` + "\n" +
			`data: {"type":"data-task-body-complete","data":{"taskId":"t1","body":"FINAL BODY"}}` + "\n",
	)
	svc.proxyDetailStream(context.Background(), upstream, newSseWriter(&bytes.Buffer{}, nopFlush), persisted, "", "")

	if bodyPersisted != "FINAL BODY" {
		t.Fatalf("body-complete must persist the body via UpdateBody, got %q", bodyPersisted)
	}
}

func TestProxyDetailStream_FiresAsyncIssueBodyEdit(t *testing.T) {
	t.Parallel()
	edited := make(chan string, 1)
	repo := &fakeTaskRepo{
		UpdateBodyFunc:         func(context.Context, string, string) error { return nil },
		SetBodySyncPendingFunc: func(context.Context, string, bool) error { return nil },
	}
	issues := &fakeIssueSvc{EditIssueBodyFunc: func(_ context.Context, _, _ string, number int, body string) error {
		if number != 5 {
			t.Errorf("edit issue number: got %d", number)
		}
		edited <- body
		return nil
	}}
	// store nil → resolveDesignComponent returns an (ignored) error, comp is nil,
	// and BuildIssueBody falls back to a generic body — the edit still fires.
	svc := streamSvc(repo, issues, nil)
	persisted := []persistedItem{{Task: &models.ComponentTask{ID: "t1", IssueNumber: 5, OrgID: "acme", ProjectID: "web"}}}

	upstream := strings.NewReader(`data: {"type":"data-task-body-complete","data":{"taskId":"t1","body":"NEW"}}` + "\n")
	svc.proxyDetailStream(context.Background(), upstream, newSseWriter(&bytes.Buffer{}, nopFlush), persisted, "https://github.com/o/r.git", "o-r")

	select {
	case <-edited:
		// success — the issue-body edit was dispatched post-persist.
	case <-time.After(3 * time.Second):
		t.Fatal("the async GitHub issue-body edit was never fired")
	}
}

// --- runReconciliationStreamed ------------------------------------------------

func TestRunReconciliationStreamed_ClosesTasksForRemovedComponents(t *testing.T) {
	t.Parallel()
	var closedIssue int
	var rejected *models.ComponentTask
	repo := &fakeTaskRepo{
		ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
			return []models.ComponentTask{
				{ID: "gone", ComponentName: "removed-svc", Status: string(models.TaskStatusPending), IssueNumber: 3},
				{ID: "kept", ComponentName: "live-svc", Status: string(models.TaskStatusPending)},
				{ID: "done", ComponentName: "old-svc", Status: string(models.TaskStatusDeployed)}, // non-pending → untouched
			}, nil
		},
		UpdateFunc: func(_ context.Context, task *models.ComponentTask) error { rejected = task; return nil },
	}
	issues := &fakeIssueSvc{CloseIssueFunc: func(context.Context, string, string, int, string) error { closedIssue++; return nil }}
	svc := streamSvc(repo, issues, nil)

	design := &artifacts.DesignFile{Components: []models.DesignComponent{{Name: "live-svc"}}}
	out := &bytes.Buffer{}
	if err := svc.runReconciliationStreamed(context.Background(), "acme", "web", design, newSseWriter(out, nopFlush)); err != nil {
		t.Fatalf("reconciliation: %v", err)
	}
	// Only the pending task whose component left the design is rejected + closed.
	if rejected == nil || rejected.ID != "gone" || rejected.Status != string(models.TaskStatusRejected) ||
		rejected.Cause == nil || *rejected.Cause != "design.removed" {
		t.Fatalf("removed-component task not rejected with design.removed cause: %+v", rejected)
	}
	if closedIssue != 1 {
		t.Fatalf("expected exactly one issue closed, got %d", closedIssue)
	}
	if !strings.Contains(out.String(), "data-task-rejected") {
		t.Fatalf("data-task-rejected frame not emitted: %s", out.String())
	}
}

// --- RegenerateTaskBody -------------------------------------------------------

func TestRegenerateTaskBody_CompletesAndPersistsBody(t *testing.T) {
	t.Parallel()
	var bodyPersisted string
	repo := &fakeTaskRepo{
		GetByIDFunc: func(context.Context, string) (*models.ComponentTask, error) {
			// IssueNumber 0 keeps the async edit inert so this stays deterministic.
			return &models.ComponentTask{ID: "t1", OrgID: "acme", ProjectID: "web", ComponentName: "svc-a"}, nil
		},
		ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) { return nil, nil },
		UpdateBodyFunc:      func(_ context.Context, _, body string) error { bodyPersisted = body; return nil },
	}
	fake := &artifactstest.FakeArtifactService{
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{"requirements.md": "# R"}, nil
		},
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{artifacts.DesignRootFile: "# Overview"}, nil
		},
	}
	store := artifacts.NewArtifactStore(fake)
	ag := &fakeAgents{StreamTechLeadDetailFunc: func(context.Context, string, agents.TechLeadDetailRequest) (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader(
			`data: {"type":"data-task-body-complete","data":{"taskId":"t1","body":"REGENERATED"}}` + "\n",
		)), nil
	}}
	svc := NewTaskService(nil, repo, store, &fakeIssueSvc{}, nil, nil, ag)

	out := &bytes.Buffer{}
	if err := svc.RegenerateTaskBody(context.Background(), "t1", out, nopFlush); err != nil {
		t.Fatalf("RegenerateTaskBody: %v", err)
	}
	if bodyPersisted != "REGENERATED" {
		t.Fatalf("regenerated body not persisted, got %q", bodyPersisted)
	}
	if !strings.Contains(out.String(), "data-finish") {
		t.Fatalf("stream must complete with data-finish: %s", out.String())
	}
}

func TestRegenerateTaskBody_UnknownTaskIsNotFound(t *testing.T) {
	t.Parallel()
	svc := NewTaskService(nil, &fakeTaskRepo{GetByIDFunc: func(context.Context, string) (*models.ComponentTask, error) {
		return nil, nil
	}}, nil, nil, nil, nil, nil)
	if err := svc.RegenerateTaskBody(context.Background(), "missing", &bytes.Buffer{}, nopFlush); !errors.Is(err, ErrTaskNotFound) {
		t.Fatalf("unknown task must be ErrTaskNotFound, got %v", err)
	}
}

// --- pure prompt-shaping helpers ---------------------------------------------

func TestFilterNonRejectedForPrompt(t *testing.T) {
	t.Parallel()
	in := []models.ComponentTask{
		{Title: "keep-pending", ComponentName: "a", Status: string(models.TaskStatusPending), IssueNumber: 4},
		{Title: "drop-rejected", ComponentName: "b", Status: string(models.TaskStatusRejected)},
		{Title: "drop-failed", ComponentName: "c", Status: string(models.TaskStatusFailed)},
		{Title: "drop-abandoned", ComponentName: "d", Status: string(models.TaskStatusAbandoned)},
	}
	out := filterNonRejectedForPrompt(in)
	if len(out) != 1 || out[0].Title != "keep-pending" {
		t.Fatalf("only non-terminal-negative tasks survive: %+v", out)
	}
	if out[0].IssueNumber == nil || *out[0].IssueNumber != 4 {
		t.Fatalf("issue number must be carried as a pointer: %+v", out[0])
	}
}

func TestSurviving_KeepsOnlyIssuedItems(t *testing.T) {
	t.Parallel()
	items := []persistedItem{
		{TempID: "p1", IssueOK: true},
		{TempID: "p2", IssueOK: false},
		{TempID: "p3", IssueOK: true},
	}
	got := surviving(items)
	if len(got) != 2 || got[0].TempID != "p1" || got[1].TempID != "p3" {
		t.Fatalf("surviving must drop issue-failed items: %+v", got)
	}
}

// TestEditIssueBodyWithRetries covers the retry loop's two exits (review gap):
// exhaustion — three consecutive EditIssueBody failures — must flag the task
// body_sync_pending=true for the reconciler; a mid-loop success must clear the
// flag (false) and stop retrying.
func TestEditIssueBodyWithRetries(t *testing.T) {
	t.Parallel()

	run := func(t *testing.T, editErrs []error) (attempts int, pending *bool) {
		t.Helper()
		var pendingSet *bool
		repo := &fakeTaskRepo{SetBodySyncPendingFunc: func(_ context.Context, _ string, p bool) error {
			pendingSet = &p
			return nil
		}}
		calls := 0
		issues := &fakeIssueSvc{EditIssueBodyFunc: func(context.Context, string, string, int, string) error {
			err := editErrs[calls]
			calls++
			return err
		}}
		store := artifacts.NewArtifactStore(&artifactstest.FakeArtifactService{
			ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
				return nil, nil // no design → resolveDesignComponent yields nil, tolerated
			},
		})
		svc := streamSvc(repo, issues, store)
		svc.editIssueBodyWithRetries(context.Background(), &models.ComponentTask{
			ID: "t1", OrgID: "acme", ProjectID: "web", ComponentName: "svc", IssueNumber: 7,
		}, "https://github.com/acme/web.git", "acme/web")
		return calls, pendingSet
	}

	boom := errors.New("gh 502")
	if calls, pending := run(t, []error{boom, boom, boom}); calls != 3 || pending == nil || *pending != true {
		t.Fatalf("exhaustion: want 3 attempts + body_sync_pending=true, got calls=%d pending=%v", calls, pending)
	}
	if calls, pending := run(t, []error{boom, nil, boom}); calls != 2 || pending == nil || *pending != false {
		t.Fatalf("mid-loop success: want 2 attempts + body_sync_pending=false, got calls=%d pending=%v", calls, pending)
	}
}
