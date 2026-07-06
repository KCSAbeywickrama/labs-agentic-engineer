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

// UNIT tier (bff-component-testing.md §2): the REAL taskService with its ports
// hand-faked — no HTTP, no DB. Proves the CRUD read branches, the ErrTaskNotFound
// translation (errors.go), the DB-vs-GitHub enrichment in GetTasks, and the
// intentional "non-streaming generation is removed" guard. The HTTP contract
// (status codes, gate, error mapping) lives in task_component_test.go; the
// projector + streaming persistence live in task_dbtest_test.go / task_stream_test.go.
package task

import (
	"context"
	"errors"
	"testing"

	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts/artifactstest"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/models"
)

// svcWith builds a taskService with only the ports a read-path test needs; the
// rest stay nil (unreached by these branches, and a stray call would panic).
func svcWith(taskRepo *fakeTaskRepo, issueSvc gitrepo.IssueService) *taskService {
	return NewTaskService(nil, taskRepo, nil, issueSvc, nil, nil, nil)
}

// --- GetTask / GetTaskScoped: nil row → ErrTaskNotFound, error wrapped --------

func TestGetTask_NilRowIsNotFound(t *testing.T) {
	t.Parallel()
	svc := svcWith(&fakeTaskRepo{GetByIDFunc: func(context.Context, string) (*models.ComponentTask, error) {
		return nil, nil
	}}, nil)
	if _, err := svc.GetTask(context.Background(), "t1"); !errors.Is(err, ErrTaskNotFound) {
		t.Fatalf("nil row must map to ErrTaskNotFound, got %v", err)
	}
}

func TestGetTask_FoundAndErrorPaths(t *testing.T) {
	t.Parallel()
	want := &models.ComponentTask{ID: "t1"}
	svc := svcWith(&fakeTaskRepo{GetByIDFunc: func(context.Context, string) (*models.ComponentTask, error) {
		return want, nil
	}}, nil)
	got, err := svc.GetTask(context.Background(), "t1")
	if err != nil || got != want {
		t.Fatalf("found: got (%v,%v)", got, err)
	}

	boom := errors.New("db down")
	svc = svcWith(&fakeTaskRepo{GetByIDFunc: func(context.Context, string) (*models.ComponentTask, error) {
		return nil, boom
	}}, nil)
	if _, err := svc.GetTask(context.Background(), "t1"); !errors.Is(err, boom) {
		t.Fatalf("repo error must propagate wrapped, got %v", err)
	}
}

func TestGetTaskScoped_NilRowIsNotFound(t *testing.T) {
	t.Parallel()
	// (nil,nil) is the store's IDOR-closing answer for "no such task OR another
	// org's task"; the service turns it into ErrTaskNotFound (→ 404 at the edge).
	svc := svcWith(&fakeTaskRepo{GetByIDScopedFunc: func(context.Context, string, string) (*models.ComponentTask, error) {
		return nil, nil
	}}, nil)
	if _, err := svc.GetTaskScoped(context.Background(), "acme", "t1"); !errors.Is(err, ErrTaskNotFound) {
		t.Fatalf("nil scoped row must map to ErrTaskNotFound, got %v", err)
	}

	got := &models.ComponentTask{ID: "t1", OrgID: "acme"}
	svc = svcWith(&fakeTaskRepo{GetByIDScopedFunc: func(_ context.Context, org, id string) (*models.ComponentTask, error) {
		if org != "acme" || id != "t1" {
			t.Fatalf("scoped lookup must forward (org,id), got (%q,%q)", org, id)
		}
		return got, nil
	}}, nil)
	if out, err := svc.GetTaskScoped(context.Background(), "acme", "t1"); err != nil || out != got {
		t.Fatalf("found scoped: got (%v,%v)", out, err)
	}
}

// --- ListTasks / GetTaskByComponent: passthrough + error ---------------------

func TestListTasks_PassthroughAndError(t *testing.T) {
	t.Parallel()
	rows := []models.ComponentTask{{ID: "a"}, {ID: "b"}}
	svc := svcWith(&fakeTaskRepo{ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
		return rows, nil
	}}, nil)
	got, err := svc.ListTasks(context.Background(), "acme", "web")
	if err != nil || len(got) != 2 {
		t.Fatalf("list: got (%v,%v)", got, err)
	}

	boom := errors.New("db down")
	svc = svcWith(&fakeTaskRepo{ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
		return nil, boom
	}}, nil)
	if _, err := svc.ListTasks(context.Background(), "acme", "web"); !errors.Is(err, boom) {
		t.Fatalf("list error must propagate, got %v", err)
	}
}

// --- GenerateTasks: intentional removal ---------------------------------------

func TestGenerateTasks_AlwaysErrorsDirectingToSSE(t *testing.T) {
	t.Parallel()
	svc := svcWith(&fakeTaskRepo{}, nil)
	if _, err := svc.GenerateTasks(context.Background(), "acme", "web"); err == nil {
		t.Fatal("non-streaming GenerateTasks must always error (callers must use the SSE endpoint)")
	}
}

// --- GetTasks: DB is the source of truth; GitHub only enriches ----------------

func TestGetTasks_NilIssueSvcErrors(t *testing.T) {
	t.Parallel()
	svc := svcWith(&fakeTaskRepo{}, nil) // issueSvc nil
	if _, err := svc.GetTasks(context.Background(), "acme", "web"); err == nil {
		t.Fatal("GetTasks with no git client configured must error")
	}
}

func TestGetTasks_EmptyDBReturnsNilNil(t *testing.T) {
	t.Parallel()
	svc := svcWith(&fakeTaskRepo{ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
		return nil, nil
	}}, &fakeIssueSvc{})
	got, err := svc.GetTasks(context.Background(), "acme", "web")
	if err != nil || got != nil {
		t.Fatalf("no tasks → (nil,nil), got (%v,%v)", got, err)
	}
}

func TestGetTasks_EnrichesFromOpenGitHubIssues(t *testing.T) {
	t.Parallel()
	repo := &fakeTaskRepo{ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
		return []models.ComponentTask{
			{ID: "t1", IssueNumber: 10, Title: "db-title", Status: "pending"},
			{ID: "t2", IssueNumber: 0, Title: "no-issue", Status: "pending"},
		}, nil
	}}
	issues := &fakeIssueSvc{ListIssuesFunc: func(context.Context, string, string, []string) ([]gitrepo.IssueInfo, error) {
		return []gitrepo.IssueInfo{
			{Number: 10, Title: "gh-title", State: "open", Labels: []string{"aep"}, URL: "https://gh/10"},
			{Number: 99, Title: "closed-elsewhere", State: "closed"}, // must be ignored (not open, no match)
		}, nil
	}}
	svc := svcWith(repo, issues)

	out, err := svc.GetTasks(context.Background(), "acme", "web")
	if err != nil || out == nil {
		t.Fatalf("get tasks: (%v,%v)", out, err)
	}
	if out.Status != "approved" || out.ProjectID != "web" {
		t.Fatalf("envelope: status=%q project=%q", out.Status, out.ProjectID)
	}
	// t1 matched an OPEN issue → title/labels/url overridden from GitHub.
	if out.Tasks[0].Title != "gh-title" || out.Tasks[0].IssueURL != "https://gh/10" || len(out.Tasks[0].Labels) != 1 {
		t.Fatalf("t1 not enriched from open issue: %+v", out.Tasks[0])
	}
	// t2 had no issue number → DB values untouched.
	if out.Tasks[1].Title != "no-issue" {
		t.Fatalf("t2 must keep DB title, got %q", out.Tasks[1].Title)
	}
}

func TestGetTasks_GitHubListFailureStillRendersFromDB(t *testing.T) {
	t.Parallel()
	repo := &fakeTaskRepo{ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
		return []models.ComponentTask{{ID: "t1", IssueNumber: 10, Title: "db-title"}}, nil
	}}
	issues := &fakeIssueSvc{ListIssuesFunc: func(context.Context, string, string, []string) ([]gitrepo.IssueInfo, error) {
		return nil, errors.New("github 500")
	}}
	svc := svcWith(repo, issues)

	out, err := svc.GetTasks(context.Background(), "acme", "web")
	if err != nil {
		t.Fatalf("a GitHub list failure must degrade to DB-only, not error: %v", err)
	}
	if out.Tasks[0].Title != "db-title" {
		t.Fatalf("DB task must survive GitHub failure, got %q", out.Tasks[0].Title)
	}
}

// --- task_design.go: resolveDesignComponent ----------------------------------

func TestResolveDesignComponent_FoundAndRemoved(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{
				artifacts.DesignRootFile:       "# Overview",
				"components/svc-a/design.json": "{\n  \"name\": \"svc-a\",\n  \"type\": \"service\",\n  \"language\": \"Go\",\n  \"description\": \"body\",\n  \"dependencies\": []\n}\n",
			}, nil
		},
	}
	store := artifacts.NewArtifactStore(fake)
	svc := NewTaskService(nil, &fakeTaskRepo{}, store, nil, nil, nil, nil)

	// Present component resolves (case-insensitive on name).
	comp, err := svc.resolveDesignComponent(context.Background(), &models.ComponentTask{ComponentName: "SVC-A", OrgID: "acme", ProjectID: "web"})
	if err != nil || comp == nil || comp.Name != "svc-a" {
		t.Fatalf("resolve present: got (%v,%v)", comp, err)
	}

	// A component no longer in the design surfaces ErrComponentRemovedAfterGeneration.
	_, err = svc.resolveDesignComponent(context.Background(), &models.ComponentTask{ComponentName: "ghost", OrgID: "acme", ProjectID: "web"})
	if !errors.Is(err, artifacts.ErrComponentRemovedAfterGeneration) {
		t.Fatalf("removed component: want ErrComponentRemovedAfterGeneration, got %v", err)
	}
}
