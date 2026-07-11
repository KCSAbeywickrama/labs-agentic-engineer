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

package build

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/devflow"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/feature/task"
	"github.com/wso2/aep/aep-api/internal/platform/humakit"
	"github.com/wso2/aep/aep-api/models"
)

// ----- fakes -----------------------------------------------------------------

type fakeRunner struct {
	readyErr  error
	startErr  error
	started   []devflow.DevFlowInput
	startedID string
	status    devflow.DevFlowStatus
	statusErr error
}

func (f *fakeRunner) Ready() error { return f.readyErr }
func (f *fakeRunner) StartBuild(_ context.Context, workflowID string, in devflow.DevFlowInput) (string, error) {
	if f.startErr != nil {
		return "", f.startErr
	}
	f.startedID = workflowID
	f.started = append(f.started, in)
	return "run-1", nil
}
func (f *fakeRunner) BuildStatus(context.Context, string) (devflow.DevFlowStatus, error) {
	return f.status, f.statusErr
}

type fakeStore struct {
	running  *models.DevflowRun
	row      *models.DevflowRun
	rows     []models.DevflowRun
	listErr  error
	recorded []*models.DevflowRun
}

func (f *fakeStore) RunningDevByProject(context.Context, string, string) (*models.DevflowRun, error) {
	return f.running, nil
}
func (f *fakeStore) GetByWorkflowID(context.Context, string, string) (*models.DevflowRun, error) {
	return f.row, nil
}
func (f *fakeStore) Record(_ context.Context, row *models.DevflowRun) error {
	f.recorded = append(f.recorded, row)
	return nil
}
func (f *fakeStore) ListByProject(_ context.Context, _, _, kind string) ([]models.DevflowRun, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	// Mirror the real read: the endpoint asks for dev-kind rows only.
	out := make([]models.DevflowRun, 0, len(f.rows))
	for _, r := range f.rows {
		if kind == "" || r.Kind == kind {
			out = append(out, r)
		}
	}
	return out, nil
}

type fakeRepos struct{ err error }

func (f fakeRepos) RepoFullName(context.Context, string, string) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	return "acme/shop", nil
}

type fakeTagger struct {
	res    *artifacts.SpecSaveResult
	err    error
	called int
}

func (f *fakeTagger) TagSpec(context.Context, string, string) (*artifacts.SpecSaveResult, error) {
	f.called++
	return f.res, f.err
}

type fakeTasks struct {
	views []task.TaskView
	err   error
}

func (f fakeTasks) ListByTag(_ context.Context, _, _, _, tag string) ([]task.TaskView, error) {
	if f.err != nil {
		return nil, f.err
	}
	if tag == "" {
		return f.views, nil
	}
	// Mirror the real read: the aep:spec/<tag> label scopes to one version, so
	// every returned row carries that specTag.
	out := make([]task.TaskView, 0, len(f.views))
	for _, v := range f.views {
		if v.Lineage.SpecTag == tag {
			out = append(out, v)
		}
	}
	return out, nil
}

func newSvc(runner *fakeRunner, store *fakeStore, repos fakeRepos, tagger *fakeTagger, tasks TaskReader) *Service {
	return NewService(Deps{Runner: runner, Store: store, Repos: repos, Tagger: tagger, Tasks: tasks})
}

func buildReq(project string) *buildInput {
	in := &buildInput{ProjectName: project}
	in.OrgScopedInput = humakit.OrgScopedInput{OrgHandle: "acme"}
	return in
}

func statusReq(project, tag string) *getBuildInput {
	in := &getBuildInput{ProjectName: project, Tag: tag}
	in.OrgScopedInput = humakit.OrgScopedInput{OrgHandle: "acme"}
	return in
}

func listReq(project string) *listBuildsInput {
	in := &listBuildsInput{ProjectName: project}
	in.OrgScopedInput = humakit.OrgScopedInput{OrgHandle: "acme"}
	return in
}

func statusOf(t *testing.T, err error) int {
	t.Helper()
	var se huma.StatusError
	if !errors.As(err, &se) {
		t.Fatalf("err = %v, want a huma.StatusError", err)
	}
	return se.GetStatus()
}

// ----- POST /build ------------------------------------------------------------

func TestBuild_TagsAndStartsWorkflow(t *testing.T) {
	runner := &fakeRunner{}
	store := &fakeStore{}
	tagger := &fakeTagger{res: &artifacts.SpecSaveResult{Status: "approved", Tag: "v1", Version: 1}}
	svc := newSvc(runner, store, fakeRepos{}, tagger, fakeTasks{})

	out, err := svc.build(context.Background(), buildReq("shop"))
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if out.Body.Tag != "v1" {
		t.Errorf("tag = %q, want v1", out.Body.Tag)
	}
	if runner.startedID != "devflow-acme-shop-v1" {
		t.Errorf("workflow id = %q, want devflow-acme-shop-v1", runner.startedID)
	}
	if len(runner.started) != 1 {
		t.Fatalf("started %d workflows, want 1", len(runner.started))
	}
	in := runner.started[0]
	if in.OrgID != "acme" || in.ProjectID != "shop" || in.Repo != "acme/shop" || in.Tag != "v1" {
		t.Errorf("workflow input = %+v", in)
	}
	if in.Gates.Auto != nil {
		t.Errorf("gates must be the zero config (all auto), got %+v", in.Gates)
	}
	// The run row is recorded synchronously so an immediate status GET (the
	// tasks page lands right after) never 404s on the org fence.
	if len(store.recorded) != 1 {
		t.Fatalf("recorded %d run rows, want 1", len(store.recorded))
	}
	row := store.recorded[0]
	if row.WorkflowID != "devflow-acme-shop-v1" || row.RunID != "run-1" ||
		row.Kind != models.WorkflowKindDev || row.OrgID != "acme" ||
		row.Tag != "v1" || row.Status != models.WorkflowStatusRunning {
		t.Errorf("recorded row = %+v", row)
	}
}

func TestBuild_UnchangedSpec_ReturnsExistingTagAndStillStarts(t *testing.T) {
	runner := &fakeRunner{}
	tagger := &fakeTagger{res: &artifacts.SpecSaveResult{Status: "unchanged", Tag: "v2", Version: 2}}
	svc := newSvc(runner, &fakeStore{}, fakeRepos{}, tagger, fakeTasks{})

	out, err := svc.build(context.Background(), buildReq("shop"))
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if out.Body.Tag != "v2" {
		t.Errorf("tag = %q, want the existing v2", out.Body.Tag)
	}
	if len(runner.started) != 1 {
		t.Errorf("rebuild of an unchanged spec must still start the workflow")
	}
}

func TestBuild_SpecValidationFails_422_NoWorkflow(t *testing.T) {
	runner := &fakeRunner{}
	tagger := &fakeTagger{err: &artifacts.SpecValidationError{Files: []artifacts.FileValidationError{
		{Path: "specs/requirements/requirements.md", Code: "MISSING_REQUIREMENTS", Message: "missing"},
		{Path: "specs/design/design.md", Code: "MISSING_DESIGN", Message: "missing"},
	}}}
	svc := newSvc(runner, &fakeStore{}, fakeRepos{}, tagger, fakeTasks{})

	_, err := svc.build(context.Background(), buildReq("shop"))
	if got := statusOf(t, err); got != 422 {
		t.Fatalf("status = %d, want 422", got)
	}
	if len(runner.started) != 0 {
		t.Errorf("workflow started despite a failed spec gate")
	}
}

func TestBuild_AlreadyRunning_409_TaggerUntouched(t *testing.T) {
	runner := &fakeRunner{}
	tagger := &fakeTagger{res: &artifacts.SpecSaveResult{Tag: "v1"}}
	store := &fakeStore{running: &models.DevflowRun{WorkflowID: "devflow-acme-shop-v1"}}
	svc := newSvc(runner, store, fakeRepos{}, tagger, fakeTasks{})

	_, err := svc.build(context.Background(), buildReq("shop"))
	if got := statusOf(t, err); got != 409 {
		t.Fatalf("status = %d, want 409", got)
	}
	if tagger.called != 0 {
		t.Errorf("tagger called %d times while a build is running, want 0", tagger.called)
	}
}

func TestBuild_NoRepo_404(t *testing.T) {
	svc := newSvc(&fakeRunner{}, &fakeStore{}, fakeRepos{err: gitrepo.ErrRepoNotFound},
		&fakeTagger{res: &artifacts.SpecSaveResult{Tag: "v1"}}, fakeTasks{})
	_, err := svc.build(context.Background(), buildReq("shop"))
	if got := statusOf(t, err); got != 404 {
		t.Fatalf("status = %d, want 404", got)
	}
}

func TestBuild_TemporalDown_503_NoTag(t *testing.T) {
	runner := &fakeRunner{readyErr: ErrTemporalUnavailable}
	tagger := &fakeTagger{res: &artifacts.SpecSaveResult{Tag: "v1"}}
	svc := newSvc(runner, &fakeStore{}, fakeRepos{}, tagger, fakeTasks{})

	_, err := svc.build(context.Background(), buildReq("shop"))
	if got := statusOf(t, err); got != 503 {
		t.Fatalf("status = %d, want 503", got)
	}
	if tagger.called != 0 {
		t.Errorf("a tag was cut while Temporal was unavailable — the probe must run first")
	}
}

func TestBuild_RepoNotReady_409(t *testing.T) {
	tagger := &fakeTagger{err: gitrepo.ErrRepoNotReady}
	svc := newSvc(&fakeRunner{}, &fakeStore{}, fakeRepos{}, tagger, fakeTasks{})
	_, err := svc.build(context.Background(), buildReq("shop"))
	if got := statusOf(t, err); got != 409 {
		t.Fatalf("status = %d, want 409", got)
	}
}

// ----- StartProjectBuild (non-HTTP provider-build trigger) --------------------

func TestStartProjectBuild_HappyPath_StartsWorkflow(t *testing.T) {
	runner := &fakeRunner{}
	store := &fakeStore{}
	tagger := &fakeTagger{res: &artifacts.SpecSaveResult{Status: "approved", Tag: "v1", Version: 1}}
	svc := newSvc(runner, store, fakeRepos{}, tagger, fakeTasks{})

	if err := svc.StartProjectBuild(context.Background(), "acme", "shop"); err != nil {
		t.Fatalf("StartProjectBuild: %v", err)
	}
	if runner.startedID != "devflow-acme-shop-v1" {
		t.Errorf("workflow id = %q, want devflow-acme-shop-v1", runner.startedID)
	}
	if len(runner.started) != 1 {
		t.Fatalf("started %d workflows, want 1", len(runner.started))
	}
	if len(store.recorded) != 1 {
		t.Errorf("recorded %d run rows, want 1", len(store.recorded))
	}
}

func TestStartProjectBuild_AlreadyRunning_Nil(t *testing.T) {
	runner := &fakeRunner{}
	tagger := &fakeTagger{res: &artifacts.SpecSaveResult{Tag: "v1"}}
	store := &fakeStore{running: &models.DevflowRun{WorkflowID: "devflow-acme-shop-v1"}}
	svc := newSvc(runner, store, fakeRepos{}, tagger, fakeTasks{})

	// The trigger is idempotent: a running provider build already satisfies it.
	if err := svc.StartProjectBuild(context.Background(), "acme", "shop"); err != nil {
		t.Fatalf("already-running must be treated as success, got: %v", err)
	}
	if tagger.called != 0 {
		t.Errorf("tagger called %d times while a build is running, want 0", tagger.called)
	}
	if len(runner.started) != 0 {
		t.Errorf("started a workflow despite a build already running")
	}
}

// ----- GET /build/{tag} --------------------------------------------------------

func TestGetBuild_MapsPhasesAndSourcesTasksFromLineage(t *testing.T) {
	cases := []struct {
		phase string
		want  string
	}{
		{devflow.DevPhaseValidatingSpec, "started"},
		{devflow.DevPhasePlanning, "in_progress"},
		{devflow.DevPhaseExecuting, "in_progress"},
		{devflow.DevPhaseValidating, "in_progress"},
		{devflow.DevPhaseDone, "completed"},
		{devflow.DevPhaseFailed, "failed"},
	}
	for _, tc := range cases {
		runner := &fakeRunner{status: devflow.DevFlowStatus{
			Phase: tc.phase,
			Tasks: []devflow.DevTaskRef{
				{Issue: 7, Phase: devflow.TaskPhaseCoding},
				{Issue: 8, Phase: devflow.TaskPhaseDone, Outcome: devflow.OutcomeSucceeded},
			},
		}}
		store := &fakeStore{row: &models.DevflowRun{WorkflowID: "devflow-acme-shop-v1", Status: models.WorkflowStatusRunning}}
		// The DURABLE source is the lineage-tag read: issues 7 & 8 are stamped
		// v1 (this build); issue 99 belongs to an older tag and must be excluded.
		tasks := fakeTasks{views: []task.TaskView{
			{IssueNumber: 8, Title: "Build widget", Lineage: task.Lineage{SpecTag: "v1"}, DerivedStatus: "deployed"},
			{IssueNumber: 7, Title: "Implement api", Lineage: task.Lineage{SpecTag: "v1"}, DerivedStatus: "in_progress"},
			{IssueNumber: 99, Title: "Old version task", Lineage: task.Lineage{SpecTag: "v0"}, DerivedStatus: "deployed"},
		}}
		svc := newSvc(runner, store, fakeRepos{}, &fakeTagger{}, tasks)

		out, err := svc.get(context.Background(), statusReq("shop", "v1"))
		if err != nil {
			t.Fatalf("get(%s): %v", tc.phase, err)
		}
		if out.Body.Status != tc.want {
			t.Errorf("phase %s → status %q, want %q", tc.phase, out.Body.Status, tc.want)
		}
		if out.Body.WorkflowStatus != tc.phase {
			t.Errorf("workflow_status = %q, want the raw phase %q", out.Body.WorkflowStatus, tc.phase)
		}
		if len(out.Body.Tasks) != 2 {
			t.Fatalf("tasks = %+v, want 2 (issue 99 filtered by lineage)", out.Body.Tasks)
		}
		// Sorted by issue number; each row carries issueNumber + the durable title.
		if got := out.Body.Tasks[0]; got.IssueNumber != 7 || got.Title != "Implement api" || got.Status != "in_progress" {
			t.Errorf("task 7 = %+v, want {7, Implement api, in_progress} (ref refines coding→in_progress)", got)
		}
		// Issue 8 is deployed durably AND done/succeeded in the live refs → completed.
		if got := out.Body.Tasks[1]; got.IssueNumber != 8 || got.Title != "Build widget" || got.Status != "completed" {
			t.Errorf("task 8 = %+v, want {8, Build widget, completed}", got)
		}
	}
}

// The durability payoff: even when the live query is gone (archived run), the
// build still lists its tasks from the lineage read, with each row's derived
// status — no more empty task list on a completed/archived build.
func TestGetBuild_QueryFails_StillListsDurableTasks(t *testing.T) {
	runner := &fakeRunner{statusErr: errors.New("run archived — no live query")}
	store := &fakeStore{row: &models.DevflowRun{WorkflowID: "devflow-acme-shop-v1", Status: models.WorkflowStatusCompleted}}
	tasks := fakeTasks{views: []task.TaskView{
		{IssueNumber: 5, Title: "Ship it", Lineage: task.Lineage{SpecTag: "v1"}, DerivedStatus: "deployed"},
		{IssueNumber: 6, Title: "Other build", Lineage: task.Lineage{SpecTag: "v2"}, DerivedStatus: "deployed"},
	}}
	svc := newSvc(runner, store, fakeRepos{}, &fakeTagger{}, tasks)

	out, err := svc.get(context.Background(), statusReq("shop", "v1"))
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if out.Body.Status != "completed" {
		t.Errorf("status = %q, want completed (from the archived row)", out.Body.Status)
	}
	if len(out.Body.Tasks) != 1 {
		t.Fatalf("tasks = %+v, want 1 (only v1 lineage)", out.Body.Tasks)
	}
	if got := out.Body.Tasks[0]; got.IssueNumber != 5 || got.Title != "Ship it" || got.Status != "completed" {
		t.Errorf("task = %+v, want {5, Ship it, completed} from the durable derived status", got)
	}
}

// ----- GET /builds --------------------------------------------------------------

func TestListBuilds_NewestFirstOneEntryPerTag(t *testing.T) {
	t0 := time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC)
	store := &fakeStore{rows: []models.DevflowRun{
		// Newest first, as the repository returns them. v1 appears twice (a
		// same-tag rebuild writes a second (workflowID, runID) row) — only the
		// newest run represents the tag.
		{Kind: models.WorkflowKindDev, Tag: "v2", Status: models.WorkflowStatusRunning,
			TasksTotal: 4, TasksDone: 1, TasksFailed: 1, CreatedAt: t0.Add(2 * time.Hour), UpdatedAt: t0.Add(3 * time.Hour)},
		{Kind: models.WorkflowKindDev, Tag: "v1", Status: models.WorkflowStatusCompleted,
			TasksTotal: 3, TasksDone: 3, CreatedAt: t0.Add(time.Hour), UpdatedAt: t0.Add(90 * time.Minute)},
		{Kind: models.WorkflowKindDev, Tag: "v1", Status: models.WorkflowStatusFailed,
			TasksTotal: 3, TasksDone: 1, TasksFailed: 2, CreatedAt: t0, UpdatedAt: t0.Add(time.Minute)},
	}}
	svc := newSvc(&fakeRunner{}, store, fakeRepos{}, &fakeTagger{}, fakeTasks{})

	out, err := svc.list(context.Background(), listReq("shop"))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	builds := out.Body.Builds
	if len(builds) != 2 {
		t.Fatalf("builds = %+v, want 2 (v1's older run folded into its newest)", builds)
	}
	v2 := builds[0]
	if v2.Tag != "v2" || v2.Status != "in_progress" {
		t.Errorf("builds[0] = %+v, want the running v2 first", v2)
	}
	if v2.Tasks.Total != 4 || v2.Tasks.Done != 1 || v2.Tasks.Failed != 1 || v2.Tasks.Active != 2 {
		t.Errorf("v2 tasks = %+v, want {4,1,1,2}", v2.Tasks)
	}
	if !v2.StartedAt.Equal(t0.Add(2*time.Hour)) || v2.CompletedAt != nil {
		t.Errorf("v2 times = %v/%v, want startedAt=+2h and no completedAt while running", v2.StartedAt, v2.CompletedAt)
	}
	v1 := builds[1]
	if v1.Tag != "v1" || v1.Status != "completed" {
		t.Errorf("builds[1] = %+v, want the completed v1 (newest run wins the tag)", v1)
	}
	if v1.CompletedAt == nil || !v1.CompletedAt.Equal(t0.Add(90*time.Minute)) {
		t.Errorf("v1 completedAt = %v, want the terminal row's updatedAt", v1.CompletedAt)
	}
}

func TestListBuilds_ActiveClampedAndEmptyList(t *testing.T) {
	// A lost total write (done > total) must not render a negative active.
	store := &fakeStore{rows: []models.DevflowRun{
		{Kind: models.WorkflowKindDev, Tag: "v1", Status: models.WorkflowStatusRunning, TasksDone: 2},
	}}
	svc := newSvc(&fakeRunner{}, store, fakeRepos{}, &fakeTagger{}, fakeTasks{})
	out, err := svc.list(context.Background(), listReq("shop"))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if got := out.Body.Builds[0].Tasks.Active; got != 0 {
		t.Errorf("active = %d, want 0 (clamped)", got)
	}

	// No runs → an empty (non-nil) list, so the JSON body is [] not null.
	svc = newSvc(&fakeRunner{}, &fakeStore{}, fakeRepos{}, &fakeTagger{}, fakeTasks{})
	out, err = svc.list(context.Background(), listReq("shop"))
	if err != nil {
		t.Fatalf("list (empty): %v", err)
	}
	if out.Body.Builds == nil || len(out.Body.Builds) != 0 {
		t.Errorf("builds = %#v, want an empty non-nil slice", out.Body.Builds)
	}
}

func TestListBuilds_StoreError_500(t *testing.T) {
	store := &fakeStore{listErr: errors.New("db down")}
	svc := newSvc(&fakeRunner{}, store, fakeRepos{}, &fakeTagger{}, fakeTasks{})
	_, err := svc.list(context.Background(), listReq("shop"))
	if got := statusOf(t, err); got != 500 {
		t.Fatalf("status = %d, want 500", got)
	}
}

func TestGetBuild_UnknownTag_404(t *testing.T) {
	svc := newSvc(&fakeRunner{}, &fakeStore{row: nil}, fakeRepos{}, &fakeTagger{}, fakeTasks{})
	_, err := svc.get(context.Background(), statusReq("shop", "v9"))
	if got := statusOf(t, err); got != 404 {
		t.Fatalf("status = %d, want 404 (org fence / unknown build)", got)
	}
}

func TestGetBuild_QueryFails_FallsBackToRowStatus(t *testing.T) {
	runner := &fakeRunner{statusErr: errors.New("temporal query failed")}
	store := &fakeStore{row: &models.DevflowRun{WorkflowID: "devflow-acme-shop-v1", Status: models.WorkflowStatusFailed}}
	svc := newSvc(runner, store, fakeRepos{}, &fakeTagger{}, fakeTasks{})

	out, err := svc.get(context.Background(), statusReq("shop", "v1"))
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if out.Body.Status != "failed" || out.Body.WorkflowStatus != models.WorkflowStatusFailed {
		t.Errorf("fallback body = %+v, want failed/failed", out.Body)
	}
}

func TestGetBuild_TitleFetchFailure_Degrades(t *testing.T) {
	runner := &fakeRunner{status: devflow.DevFlowStatus{
		Phase: devflow.DevPhaseExecuting,
		Tasks: []devflow.DevTaskRef{{Issue: 3, Phase: devflow.TaskPhaseBuilding}},
	}}
	store := &fakeStore{row: &models.DevflowRun{Status: models.WorkflowStatusRunning}}
	svc := newSvc(runner, store, fakeRepos{}, &fakeTagger{}, fakeTasks{err: errors.New("github down")})

	out, err := svc.get(context.Background(), statusReq("shop", "v1"))
	if err != nil {
		t.Fatalf("get must not fail on a title-read hiccup: %v", err)
	}
	if out.Body.Tasks[0].Title != "Task #3" {
		t.Errorf("title = %q, want the numbered placeholder", out.Body.Tasks[0].Title)
	}
}
