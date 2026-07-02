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

// COMPONENT tier (bff-component-testing.md §4): the REAL task + board services
// behind the REAL production handler chain — global middleware → faked auth at
// the jwt.WithClaims seam → orgensure → Huma parsing/validation → the tenant
// gate in ENFORCE → each handler's inline error mapping — driven in-process via
// the componenttest harness. Only out-of-process seams are mocked: the task
// repository, the coding-agent dispatch/progress ports, the GitHub board/issue
// services, and the OpenChoreo client.
//
// ORG SCOPE: the active org is derived SOLELY from the token (no {orgHandle}
// path param), so the only runtime auth assertion this tier adds is the gate's
// no-claims 401 on an org-scoped op (proven once). The by-UUID cross-org IDOR is
// proven at the store tier (GetByIDScoped, repositories/task_repository_dbtest_test.go)
// and re-exercised through the real projector in task_dbtest_test.go.
//
// GOLDEN FIELD SETS: the harvested goldens carry a Huma `$schema` link the
// current handler no longer emits, so field sets are compared with $schema
// excluded from both sides.
//
// The internal S2S surface (task_internal_huma.go, runner-skills) is NOT driven
// here: its RunnerScopedInput resolves via the process-global
// auth.SetRunnerAuthorizer the harness never sets (and must not, from parallel
// tests), so that HTTP surface is integration-owned — its service logic is unit-
// proven in task_skills_service_test.go.
//
// External test package: the harness imports api, which imports task — an
// in-package test file would be an import cycle.
package task_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/api"
	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
	"github.com/wso2/aep/aep-api/internal/contracts"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/feature/task"
	"github.com/wso2/aep/aep-api/internal/platform/componenttest"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

const taskPrefix = "/api/v1/projects/web/tasks"

// --- harness + fakes ---------------------------------------------------------

type taskFakes struct {
	repo   repositories.TaskRepository
	disp   task.TaskDispatcher
	prog   task.ProgressReader
	board  gitrepo.RepoBoardService
	issues gitrepo.IssueService
	oc     openchoreo.ComponentClient
}

// newHarness assembles the real chain around the REAL task + board services,
// with only the supplied out-of-process seams programmed.
func newHarness(t *testing.T, f taskFakes) *componenttest.Harness {
	t.Helper()
	svc := task.NewTaskService(nil, f.repo, nil, f.issues, nil, nil, nil)
	boardSvc := task.NewBoardService(f.board, f.repo)
	return componenttest.New(t, componenttest.Options{Deps: api.HumaDeps{
		TaskSvc:         svc,
		TaskDispatcher:  f.disp,
		TaskProgress:    f.prog,
		ComponentClient: f.oc,
		BoardSvc:        boardSvc,
	}})
}

func goldenPath(name string) string {
	return filepath.Join("..", "..", "..", "testdata", "harvest", "golden", name)
}

// sansSchema drops the Huma `$schema` link key so a golden's field set (which
// still carries it) compares against the current handler's (which omits it).
func sansSchema(keys []string) []string {
	out := make([]string, 0, len(keys))
	for _, k := range keys {
		if k != "$schema" {
			out = append(out, k)
		}
	}
	return out
}

func readGolden(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(goldenPath(name))
	if err != nil {
		t.Fatalf("read golden %s: %v", name, err)
	}
	return b
}

// firstElementKeys returns element[0]'s sorted keys of a JSON array of objects.
func firstElementKeys(t *testing.T, raw []byte) []string {
	t.Helper()
	var arr []map[string]any
	if err := json.Unmarshal(raw, &arr); err != nil {
		t.Fatalf("not a JSON array of objects: %v\n%s", err, string(raw))
	}
	if len(arr) == 0 {
		t.Fatalf("expected a non-empty array: %s", string(raw))
	}
	return sortedKeys(arr[0])
}

// nestedElementKeys returns element[0]'s sorted keys of the array under the
// given object field (e.g. the `tasks` array inside the generated-tasks object).
func nestedElementKeys(t *testing.T, raw []byte, field string) []string {
	t.Helper()
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		t.Fatalf("not a JSON object: %v\n%s", err, string(raw))
	}
	return firstElementKeys(t, obj[field])
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// goldenShapedTask mirrors testdata/harvest/golden/get_task.json's populated
// field set so a real handler response compares field-for-field (sans $schema).
// The omitempty fields the golden omits (dependsOnComponents, labels,
// buildAuthRetryCount, dispatchDeferredAt, bodySyncPending) are left zero.
func goldenShapedTask() *models.ComponentTask {
	now := time.Date(2026, 7, 1, 6, 31, 29, 0, time.UTC)
	dispatched := time.Date(2026, 7, 1, 6, 13, 28, 0, time.UTC)
	batch := "163fb872-3c61-4882-9ef7-9879c3dd0e0a"
	cause := "build.deployed"
	return &models.ComponentTask{
		ID:                     "26de64b5-beb8-445d-9acf-de0811552744",
		ProjectID:              "web",
		OrgID:                  "acme",
		ComponentName:          "hello-api",
		Title:                  "Implement hello-api Go service with greeting endpoint",
		Rationale:              "Provide a single Go service.",
		Body:                   "## Overview\n\nBuild hello-api.",
		BatchID:                &batch,
		SourceDesignVersion:    "v1-1",
		SourceSpecVersion:      "v1",
		Order:                  1,
		Status:                 string(models.TaskStatusDeployed),
		ExecType:               "WORKER",
		IssueURL:               "https://github.com/o/r/issues/1",
		IssueNumber:            1,
		LifecycleStatus:        string(models.TaskLifecycleGhIssueCreated),
		BranchName:             "feature/hello-api",
		PullRequestNumber:      2,
		PullRequestURL:         "https://github.com/o/r/pull/2",
		MergeCommitSHA:         "1a57ed0877582f3ddfb065cb06334632d515dbde",
		LastEventAt:            &now,
		LastBuildRunName:       "hello-world-api-hello-api-1782887236864",
		LastBuildSHA:           "1a57ed0877582f3ddfb065cb06334632d515dbde",
		LastCodingAgentRunName: "ca-26de64b5-2607010613",
		Cause:                  &cause,
		DispatchedAt:           &dispatched,
		CreatedAt:              now,
		UpdatedAt:              now,
	}
}

// --- list-tasks ---------------------------------------------------------------

func TestTaskComponent_ListTasks_MatchesGoldenElementShape(t *testing.T) {
	t.Parallel()
	var sawOrg, sawProject string
	h := newHarness(t, taskFakes{repo: &compRepo{
		ListByProjectIDFunc: func(_ context.Context, org, proj string) ([]models.ComponentTask, error) {
			sawOrg, sawProject = org, proj
			return []models.ComponentTask{*goldenShapedTask()}, nil
		},
	}})

	resp := h.AsOrg("acme").Get(taskPrefix)
	if resp.Code != 200 {
		t.Fatalf("list: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	got := firstElementKeys(t, resp.Body.Bytes())
	want := firstElementKeys(t, readGolden(t, "get_tasks.json"))
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("list element shape drifted from golden:\n got %v\nwant %v", got, want)
	}
	// The org the service saw MUST be the token org, bound by the gate from claims.
	if sawOrg != "acme" || sawProject != "web" {
		t.Fatalf("service scope: got (%q,%q), want (acme,web)", sawOrg, sawProject)
	}
}

func TestTaskComponent_ListTasks_OpaqueErrorIs500(t *testing.T) {
	t.Parallel()
	h := newHarness(t, taskFakes{repo: &compRepo{
		ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
			return nil, errors.New("pg: connection refused")
		},
	}})
	resp := h.AsOrg("acme").Get(taskPrefix)
	if resp.Code != 500 {
		t.Fatalf("opaque error: want 500, got %d body=%s", resp.Code, resp.Body.String())
	}
	if strings.Contains(resp.Body.String(), "connection refused") {
		t.Fatalf("500 body leaks internals: %s", resp.Body.String())
	}
}

// --- get-task -----------------------------------------------------------------

func TestTaskComponent_GetTask_MatchesGoldenFieldSet(t *testing.T) {
	t.Parallel()
	h := newHarness(t, taskFakes{repo: &compRepo{
		GetByIDScopedFunc: func(context.Context, string, string) (*models.ComponentTask, error) {
			return goldenShapedTask(), nil
		},
	}})
	resp := h.AsOrg("acme").Get(taskPrefix + "/26de64b5-beb8-445d-9acf-de0811552744")
	if resp.Code != 200 {
		t.Fatalf("get: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	got := sansSchema(componenttest.FieldSet(t, resp.Body.String()))
	want := sansSchema(componenttest.GoldenFieldSet(t, goldenPath("get_task.json")))
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("get-task field set drifted from golden:\n got %v\nwant %v", got, want)
	}
}

func TestTaskComponent_GetTask_NotFoundAndError(t *testing.T) {
	t.Parallel()
	// (nil,nil) → ErrTaskNotFound → 404 (same body for missing OR cross-org).
	h := newHarness(t, taskFakes{repo: &compRepo{
		GetByIDScopedFunc: func(context.Context, string, string) (*models.ComponentTask, error) { return nil, nil },
	}})
	resp := h.AsOrg("acme").Get(taskPrefix + "/nope")
	if resp.Code != 404 {
		t.Fatalf("missing task: want 404, got %d body=%s", resp.Code, resp.Body.String())
	}
	if p := componenttest.DecodeProblem(t, resp.Body.String()); p.Detail != "task not found" {
		t.Fatalf("404 detail: got %q", p.Detail)
	}

	h = newHarness(t, taskFakes{repo: &compRepo{
		GetByIDScopedFunc: func(context.Context, string, string) (*models.ComponentTask, error) {
			return nil, errors.New("boom")
		},
	}})
	if resp := h.AsOrg("acme").Get(taskPrefix + "/x"); resp.Code != 500 {
		t.Fatalf("load error: want 500, got %d body=%s", resp.Code, resp.Body.String())
	}
}

// --- get-generated-tasks ------------------------------------------------------

func TestTaskComponent_GetGeneratedTasks_MatchesGolden(t *testing.T) {
	t.Parallel()
	h := newHarness(t, taskFakes{
		repo: &compRepo{ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
			return []models.ComponentTask{*goldenShapedTask()}, nil
		}},
		// GetTasks enriches from open issues; an empty list keeps the DB shape.
		issues: &compIssues{ListIssuesFunc: func(context.Context, string, string, []string) ([]gitrepo.IssueInfo, error) {
			return nil, nil
		}},
	})
	resp := h.AsOrg("acme").Get(taskPrefix + "/generated")
	if resp.Code != 200 {
		t.Fatalf("generated: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	got := sansSchema(componenttest.FieldSet(t, resp.Body.String()))
	want := sansSchema(componenttest.GoldenFieldSet(t, goldenPath("get_tasks_generated.json")))
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("generated envelope drifted from golden:\n got %v\nwant %v", got, want)
	}
	gotEl := nestedElementKeys(t, resp.Body.Bytes(), "tasks")
	wantEl := nestedElementKeys(t, readGolden(t, "get_tasks_generated.json"), "tasks")
	if !reflect.DeepEqual(gotEl, wantEl) {
		t.Fatalf("generated tasks[0] shape drifted from golden:\n got %v\nwant %v", gotEl, wantEl)
	}
}

// --- get-task-status ----------------------------------------------------------

func TestTaskComponent_GetTaskStatus_MatchesGoldenFieldSet(t *testing.T) {
	t.Parallel()
	// A deployed (non-building) task → build steps are frozen; the OC client is
	// never called, so buildSteps is absent → the golden's {task} field set.
	h := newHarness(t, taskFakes{repo: &compRepo{
		GetByIDScopedFunc: func(context.Context, string, string) (*models.ComponentTask, error) {
			return goldenShapedTask(), nil
		},
	}})
	resp := h.AsOrg("acme").Get(taskPrefix + "/26de64b5/status")
	if resp.Code != 200 {
		t.Fatalf("status: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	got := sansSchema(componenttest.FieldSet(t, resp.Body.String()))
	want := sansSchema(componenttest.GoldenFieldSet(t, goldenPath("get_task_status.json")))
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("status field set drifted from golden:\n got %v\nwant %v", got, want)
	}
}

func TestTaskComponent_GetTaskStatus_BuildingFetchesSteps(t *testing.T) {
	t.Parallel()
	var ocOrg, ocRun string
	oc := &ocmocks.ComponentClientMock{GetWorkflowRunFunc: func(_ context.Context, org, run string) (*models.WorkflowRun, error) {
		ocOrg, ocRun = org, run
		return &models.WorkflowRun{Tasks: []models.WorkflowRunTask{{Name: "build-image", Phase: "Succeeded"}}}, nil
	}}
	h := newHarness(t, taskFakes{
		oc: oc,
		repo: &compRepo{GetByIDScopedFunc: func(context.Context, string, string) (*models.ComponentTask, error) {
			return &models.ComponentTask{
				ID: "t1", OrgID: "acme-ouid", Status: string(models.TaskStatusBuilding), LastBuildRunName: "run-1",
			}, nil
		}},
	})
	resp := h.AsOrg("acme").Get(taskPrefix + "/t1/status")
	if resp.Code != 200 {
		t.Fatalf("status building: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "buildSteps") || !strings.Contains(resp.Body.String(), "build-image") {
		t.Fatalf("building status must include the run's steps: %s", resp.Body.String())
	}
	// Build-run steps are fetched by the task's OrgID + LastBuildRunName.
	if ocOrg != "acme-ouid" || ocRun != "run-1" {
		t.Fatalf("OC GetWorkflowRun args: got (%q,%q)", ocOrg, ocRun)
	}
}

// --- board --------------------------------------------------------------------

func TestTaskComponent_Board_MatchesGoldenFieldSet(t *testing.T) {
	t.Parallel()
	h := newHarness(t, taskFakes{
		board: &compBoard{GetBoardFunc: func(context.Context, string, string) (*gitrepo.ProjectBoardResult, error) {
			return &gitrepo.ProjectBoardResult{
				URL:   "https://github.com/orgs/x/projects/1",
				Items: []gitrepo.BoardItem{{ID: "i1", URL: "https://gh/1", Status: "Done"}},
			}, nil
		}},
		repo: &compRepo{ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
			return []models.ComponentTask{{ID: "t1", IssueURL: "https://gh/1", Status: "deployed"}}, nil
		}},
	})
	resp := h.AsOrg("acme").Get("/api/v1/projects/web/board")
	if resp.Code != 200 {
		t.Fatalf("board: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	got := sansSchema(componenttest.FieldSet(t, resp.Body.String()))
	want := sansSchema(componenttest.GoldenFieldSet(t, goldenPath("get_board.json")))
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("board field set drifted from golden:\n got %v\nwant %v", got, want)
	}
	// The item routes to Done (GitHub column) and carries its backing task id.
	var board task.ProjectBoard
	if err := json.Unmarshal(resp.Body.Bytes(), &board); err != nil {
		t.Fatalf("board body: %v", err)
	}
	if len(board.Done) != 1 || board.Done[0].ComponentTaskID != "t1" {
		t.Fatalf("board Done column: %+v", board.Done)
	}
}

func TestTaskComponent_Board_OpaqueErrorIs500(t *testing.T) {
	t.Parallel()
	h := newHarness(t, taskFakes{
		board: &compBoard{GetBoardFunc: func(context.Context, string, string) (*gitrepo.ProjectBoardResult, error) {
			return nil, errors.New("graphql down")
		}},
		repo: &compRepo{},
	})
	if resp := h.AsOrg("acme").Get("/api/v1/projects/web/board"); resp.Code != 500 {
		t.Fatalf("board error: want 500, got %d body=%s", resp.Code, resp.Body.String())
	}
}

// --- dispatch -----------------------------------------------------------------

func TestTaskComponent_Dispatch_HappyUnavailableAndError(t *testing.T) {
	t.Parallel()
	// Happy — dispatcher returns results.
	h := newHarness(t, taskFakes{repo: &compRepo{}, disp: &compDispatcher{
		DispatchTasksFunc: func(context.Context, string, string) ([]contracts.DispatchResult, error) {
			return []contracts.DispatchResult{{TaskID: "t1", Status: "in_progress"}}, nil
		},
	}})
	if resp := h.AsOrg("acme").Post(taskPrefix+"/dispatch", ""); resp.Code != 200 {
		t.Fatalf("dispatch happy: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}

	// nil dispatcher → 503 (service not configured).
	h = newHarness(t, taskFakes{repo: &compRepo{}})
	if resp := h.AsOrg("acme").Post(taskPrefix+"/dispatch", ""); resp.Code != 503 {
		t.Fatalf("dispatch nil svc: want 503, got %d body=%s", resp.Code, resp.Body.String())
	}

	// dispatcher error → 500.
	h = newHarness(t, taskFakes{repo: &compRepo{}, disp: &compDispatcher{
		DispatchTasksFunc: func(context.Context, string, string) ([]contracts.DispatchResult, error) {
			return nil, errors.New("oc unavailable")
		},
	}})
	if resp := h.AsOrg("acme").Post(taskPrefix+"/dispatch", ""); resp.Code != 500 {
		t.Fatalf("dispatch error: want 500, got %d body=%s", resp.Code, resp.Body.String())
	}
}

// --- retry --------------------------------------------------------------------

func TestTaskComponent_Retry_HappyNotFoundAndUnavailable(t *testing.T) {
	t.Parallel()
	// Happy — the org pre-check passes then the dispatcher retries.
	h := newHarness(t, taskFakes{
		repo: &compRepo{GetByIDScopedFunc: func(context.Context, string, string) (*models.ComponentTask, error) {
			return &models.ComponentTask{ID: "t1", OrgID: "acme"}, nil
		}},
		disp: &compDispatcher{RetryTaskFunc: func(context.Context, string) (contracts.DispatchResult, error) {
			return contracts.DispatchResult{TaskID: "t1", Status: "in_progress"}, nil
		}},
	})
	if resp := h.AsOrg("acme").Post(taskPrefix+"/t1/retry", ""); resp.Code != 200 {
		t.Fatalf("retry happy: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}

	// The org pre-check 404s a cross-org/unknown task BEFORE any dispatch work.
	h = newHarness(t, taskFakes{
		repo: &compRepo{GetByIDScopedFunc: func(context.Context, string, string) (*models.ComponentTask, error) {
			return nil, nil
		}},
		disp: &compDispatcher{RetryTaskFunc: func(context.Context, string) (contracts.DispatchResult, error) {
			t.Error("RetryTask must not run when the org pre-check fails")
			return contracts.DispatchResult{}, nil
		}},
	})
	if resp := h.AsOrg("acme").Post(taskPrefix+"/ghost/retry", ""); resp.Code != 404 {
		t.Fatalf("retry cross-org/unknown: want 404, got %d body=%s", resp.Code, resp.Body.String())
	}

	// nil dispatcher → 503 (checked before the pre-check).
	h = newHarness(t, taskFakes{repo: &compRepo{}})
	if resp := h.AsOrg("acme").Post(taskPrefix+"/t1/retry", ""); resp.Code != 503 {
		t.Fatalf("retry nil svc: want 503, got %d body=%s", resp.Code, resp.Body.String())
	}
}

// --- progress -----------------------------------------------------------------

func okTask(context.Context, string, string) (*models.ComponentTask, error) {
	return &models.ComponentTask{ID: "t1", OrgID: "acme"}, nil
}

func TestTaskComponent_AgentProgress_MatchesGoldenAndErrorMapping(t *testing.T) {
	t.Parallel()
	// Happy — plain JSON read maps to the golden field set (sans $schema).
	h := newHarness(t, taskFakes{
		repo: &compRepo{GetByIDScopedFunc: okTask},
		prog: &compProgress{GetAgentProgressFunc: func(context.Context, string, int64, int) (*contracts.ProgressResponse, error) {
			return &contracts.ProgressResponse{SchemaVersion: 1, Lines: []contracts.ProgressEvent{{SchemaVersion: 1, Kind: "log", Summary: "hi"}}, CursorMillis: 42}, nil
		}},
	})
	resp := h.AsOrg("acme").Get(taskPrefix + "/t1/progress/agent")
	if resp.Code != 200 {
		t.Fatalf("agent progress: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	got := sansSchema(componenttest.FieldSet(t, resp.Body.String()))
	want := sansSchema(componenttest.GoldenFieldSet(t, goldenPath("get_task_progress_agent.json")))
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("agent progress field set drifted from golden:\n got %v\nwant %v", got, want)
	}

	// nil progress svc → 503.
	h = newHarness(t, taskFakes{repo: &compRepo{GetByIDScopedFunc: okTask}})
	if resp := h.AsOrg("acme").Get(taskPrefix + "/t1/progress/agent"); resp.Code != 503 {
		t.Fatalf("nil progress: want 503, got %d body=%s", resp.Code, resp.Body.String())
	}

	// Observer down (ErrProgressUnavailable) → 503 via mapProgressError.
	h = newHarness(t, taskFakes{
		repo: &compRepo{GetByIDScopedFunc: okTask},
		prog: &compProgress{GetAgentProgressFunc: func(context.Context, string, int64, int) (*contracts.ProgressResponse, error) {
			return nil, contracts.ErrProgressUnavailable
		}},
	})
	if resp := h.AsOrg("acme").Get(taskPrefix + "/t1/progress/agent"); resp.Code != 503 {
		t.Fatalf("observer down: want 503, got %d body=%s", resp.Code, resp.Body.String())
	}

	// Opaque progress error → 500 via mapProgressError.
	h = newHarness(t, taskFakes{
		repo: &compRepo{GetByIDScopedFunc: okTask},
		prog: &compProgress{GetAgentProgressFunc: func(context.Context, string, int64, int) (*contracts.ProgressResponse, error) {
			return nil, errors.New("boom")
		}},
	})
	if resp := h.AsOrg("acme").Get(taskPrefix + "/t1/progress/agent"); resp.Code != 500 {
		t.Fatalf("opaque progress error: want 500, got %d body=%s", resp.Code, resp.Body.String())
	}

	// Cross-org/unknown task → the pre-check 404s before reading progress.
	h = newHarness(t, taskFakes{
		repo: &compRepo{GetByIDScopedFunc: func(context.Context, string, string) (*models.ComponentTask, error) { return nil, nil }},
		prog: &compProgress{GetAgentProgressFunc: func(context.Context, string, int64, int) (*contracts.ProgressResponse, error) {
			t.Error("progress must not be read for a cross-org/unknown task")
			return nil, nil
		}},
	})
	if resp := h.AsOrg("acme").Get(taskPrefix + "/ghost/progress/agent"); resp.Code != 404 {
		t.Fatalf("progress pre-check: want 404, got %d body=%s", resp.Code, resp.Body.String())
	}
}

func TestTaskComponent_BuildProgress_MatchesGolden(t *testing.T) {
	t.Parallel()
	h := newHarness(t, taskFakes{
		repo: &compRepo{GetByIDScopedFunc: okTask},
		prog: &compProgress{GetBuildProgressFunc: func(context.Context, string, int64) (*contracts.ProgressResponse, error) {
			return &contracts.ProgressResponse{SchemaVersion: 1, Lines: []contracts.ProgressEvent{{SchemaVersion: 1, Kind: "build_step", Step: "build-image"}}, CursorMillis: 7, Final: true}, nil
		}},
	})
	resp := h.AsOrg("acme").Get(taskPrefix + "/t1/progress/build")
	if resp.Code != 200 {
		t.Fatalf("build progress: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	got := sansSchema(componenttest.FieldSet(t, resp.Body.String()))
	want := sansSchema(componenttest.GoldenFieldSet(t, goldenPath("get_task_progress_build.json")))
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("build progress field set drifted from golden:\n got %v\nwant %v", got, want)
	}
}

// --- auth ---------------------------------------------------------------------

func TestTaskComponent_NoClaimsDeniedByEnforceGate(t *testing.T) {
	t.Parallel()
	h := newHarness(t, taskFakes{repo: &compRepo{}})
	resp := h.NoAuth().Get(taskPrefix)
	if resp.Code != 401 {
		t.Fatalf("no-claims: want the gate's ENFORCE 401, got %d body=%s", resp.Code, resp.Body.String())
	}
	// The gate aggregates its resolver error into one RFC-9457 problem carrying
	// "authentication required" — NOT the JWT middleware's pre-gate rejection
	// (that path is integration-owned, see §3).
	p := componenttest.DecodeProblem(t, resp.Body.String())
	if p.Status != 401 || len(p.Errors) == 0 || !strings.Contains(p.Errors[0].Message, "authentication required") {
		t.Fatalf("gate 401 problem shape: got %s", resp.Body.String())
	}
}
