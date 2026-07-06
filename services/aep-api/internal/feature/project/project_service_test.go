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

package project

// UNIT tier (bff-component-testing.md §2): the REAL projectService with every
// port mocked — no HTTP, no DB. Proves the service's logic branches:
// sentinel translation, CreateProject's best-effort side-effect chain, the
// delete cascade, and the GetProjectStatus phase ladder. The HTTP contract
// (status codes, validation, gate) lives in project_component_test.go; the
// applyRepoToProjectStatus repo-lifecycle table lives in project_status_test.go
// (each behavior proven at exactly one tier).

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts/artifactstest"
	"github.com/wso2/aep/aep-api/models"
)

// --- port fakes --------------------------------------------------------------

// fakeRepoSvc fakes the gitrepo.RepoService sibling seam (hand fake per §6 —
// the out-of-process boundary is the GitHub API inside gitrepo, not this
// interface). Unset funcs panic, moq-style.
type fakeRepoSvc struct {
	CreateRepoFunc func(ctx context.Context, orgID, projectID, projectName string) (*models.GitRepository, error)
	GetRepoFunc    func(ctx context.Context, orgID, projectID string) (*models.GitRepository, error)
	DeleteRepoFunc func(ctx context.Context, orgID, projectID string) error
}

func (f *fakeRepoSvc) CreateRepo(ctx context.Context, orgID, projectID, projectName string) (*models.GitRepository, error) {
	if f.CreateRepoFunc == nil {
		panic("fakeRepoSvc: CreateRepo not set")
	}
	return f.CreateRepoFunc(ctx, orgID, projectID, projectName)
}
func (f *fakeRepoSvc) EnsureBareRepo(context.Context, string, string, string) (*models.GitRepository, error) {
	panic("fakeRepoSvc: EnsureBareRepo not expected in project tests")
}
func (f *fakeRepoSvc) GetRepo(ctx context.Context, orgID, projectID string) (*models.GitRepository, error) {
	if f.GetRepoFunc == nil {
		panic("fakeRepoSvc: GetRepo not set")
	}
	return f.GetRepoFunc(ctx, orgID, projectID)
}
func (f *fakeRepoSvc) SetWebhookID(context.Context, string, string, int64) error {
	panic("fakeRepoSvc: SetWebhookID not expected in project tests")
}
func (f *fakeRepoSvc) DeleteRepo(ctx context.Context, orgID, projectID string) error {
	if f.DeleteRepoFunc == nil {
		panic("fakeRepoSvc: DeleteRepo not set")
	}
	return f.DeleteRepoFunc(ctx, orgID, projectID)
}

type fakeWebhookSvc struct {
	RegisterFunc func(ctx context.Context, orgID, projectID string) (*int64, error)
	calls        int
}

func (f *fakeWebhookSvc) Register(ctx context.Context, orgID, projectID string) (*int64, error) {
	f.calls++
	if f.RegisterFunc == nil {
		return nil, nil
	}
	return f.RegisterFunc(ctx, orgID, projectID)
}

// fakeTaskRepo implements repositories.TaskRepository; only ListByProjectID is
// exercised by the project feature — everything else panics loudly.
type fakeTaskRepo struct {
	ListByProjectIDFunc   func(ctx context.Context, orgID, projectID string) ([]models.ComponentTask, error)
	DeleteByProjectIDFunc func(ctx context.Context, orgID, projectID string) error
}

func (f *fakeTaskRepo) GetByID(context.Context, string) (*models.ComponentTask, error) {
	panic("fakeTaskRepo: GetByID not expected")
}
func (f *fakeTaskRepo) GetByIDScoped(context.Context, string, string) (*models.ComponentTask, error) {
	panic("fakeTaskRepo: GetByIDScoped not expected")
}
func (f *fakeTaskRepo) GetByComponentName(context.Context, string, string, string) (*models.ComponentTask, error) {
	panic("fakeTaskRepo: GetByComponentName not expected")
}
func (f *fakeTaskRepo) ListByProjectID(ctx context.Context, orgID, projectID string) ([]models.ComponentTask, error) {
	if f.ListByProjectIDFunc == nil {
		panic("fakeTaskRepo: ListByProjectID not set")
	}
	return f.ListByProjectIDFunc(ctx, orgID, projectID)
}
func (f *fakeTaskRepo) ListNonTerminalByOrgID(context.Context, string) ([]models.ComponentTask, error) {
	panic("fakeTaskRepo: ListNonTerminalByOrgID not expected")
}
func (f *fakeTaskRepo) GetBaselineBatch(context.Context, string, string) (string, string, string, error) {
	panic("fakeTaskRepo: GetBaselineBatch not expected")
}
func (f *fakeTaskRepo) Create(context.Context, *models.ComponentTask) error {
	panic("fakeTaskRepo: Create not expected")
}
func (f *fakeTaskRepo) Update(context.Context, *models.ComponentTask) error {
	panic("fakeTaskRepo: Update not expected")
}
func (f *fakeTaskRepo) UpdateBody(context.Context, string, string) error {
	panic("fakeTaskRepo: UpdateBody not expected")
}
func (f *fakeTaskRepo) SetBodySyncPending(context.Context, string, bool) error {
	panic("fakeTaskRepo: SetBodySyncPending not expected")
}
func (f *fakeTaskRepo) DeleteByProjectID(ctx context.Context, orgID, projectID string) error {
	if f.DeleteByProjectIDFunc == nil {
		panic("fakeTaskRepo: DeleteByProjectID not expected")
	}
	return f.DeleteByProjectIDFunc(ctx, orgID, projectID)
}
func (f *fakeTaskRepo) DeleteAll(context.Context) error {
	panic("fakeTaskRepo: DeleteAll not expected")
}

type fakeSkillsProvisioner struct{ called chan string }

func (f *fakeSkillsProvisioner) EnsureProvisioned(_ context.Context, orgID string) error {
	f.called <- orgID
	return nil
}

// deprovisionCall records one Deprovision invocation's arguments.
type deprovisionCall struct {
	org, project, name string
	envs               []string
}

// fakeDeprovisioner backs both resourceDeprovisioner and
// externalResourceDeprovisioner — the two ports are structurally identical
// (Deprovision(ctx, orgHandle, projectName, name string, envs []string) error),
// mirroring the concrete *resources.OCNativeProvisioner /
// *resources.ExternalResourceProvisioner this fake stands in for. When trace
// is set, every call also appends "<label>:<name>" to it (shared across fakes)
// so tests can assert relative call order.
type fakeDeprovisioner struct {
	err   error
	trace *[]string
	label string
	calls []deprovisionCall
}

func (f *fakeDeprovisioner) Deprovision(_ context.Context, orgHandle, projectName, name string, envs []string) error {
	f.calls = append(f.calls, deprovisionCall{orgHandle, projectName, name, envs})
	if f.trace != nil {
		*f.trace = append(*f.trace, f.label+":"+name)
	}
	return f.err
}

// statusFixture builds a projectService wired for GetProjectStatus ladder
// tests: repo ready, and the artifact/tasks seams programmable per case.
type statusFixture struct {
	reqFiles       map[string]string
	reqFilesErr    error
	designFiles    map[string]string
	designFilesErr error
	reqVersions    []artifacts.RequirementsVersionInfo
	desVersions    []artifacts.DesignVersionInfo
	tasks          []models.ComponentTask
	tasksListErr   error
}

func (fx statusFixture) service() *projectService {
	fakeArtifacts := &artifactstest.FakeArtifactService{
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return fx.reqFiles, fx.reqFilesErr
		},
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return fx.designFiles, fx.designFilesErr
		},
		ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
			return fx.reqVersions, nil
		},
		ListDesignVersionsFunc: func(context.Context, string, string) ([]artifacts.DesignVersionInfo, error) {
			return fx.desVersions, nil
		},
	}
	repoSvc := &fakeRepoSvc{
		GetRepoFunc: func(context.Context, string, string) (*models.GitRepository, error) {
			return &models.GitRepository{Status: "ready", RepoURL: "https://github.com/o/r.git"}, nil
		},
	}
	taskRepo := &fakeTaskRepo{
		ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
			return fx.tasks, fx.tasksListErr
		},
	}
	// The REAL ArtifactStore decorator wraps the fake service, so the
	// ListRequirements / ReadDesign store logic runs for real.
	return NewProjectService(nil, repoSvc, nil, fakeArtifacts, artifacts.NewArtifactStore(fakeArtifacts), taskRepo)
}

// --- translateHTTPError --------------------------------------------------------

func TestTranslateHTTPError(t *testing.T) {
	t.Parallel()
	opaque := errors.New("boom")
	cases := []struct {
		name string
		in   error
		want error // sentinel expected via errors.Is; nil means passthrough of in
	}{
		{"nil is nil", nil, nil},
		{"oc not-found becomes project not-found", openchoreo.ErrNotFound, ErrProjectNotFound},
		{"wrapped oc not-found too", errors.Join(errors.New("ctx"), openchoreo.ErrNotFound), ErrProjectNotFound},
		{"oc unauthorized", openchoreo.ErrUnauthorized, ErrUnauthorized},
		{"oc forbidden", openchoreo.ErrForbidden, ErrForbidden},
		{"opaque passes through", opaque, opaque},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := translateHTTPError(tc.in)
			if tc.want == nil {
				if got != nil {
					t.Fatalf("want nil, got %v", got)
				}
				return
			}
			if !errors.Is(got, tc.want) {
				t.Fatalf("want errors.Is(%v, %v)", got, tc.want)
			}
		})
	}
}

// --- List / Get ---------------------------------------------------------------

func TestListProjects_TranslatesOCError(t *testing.T) {
	t.Parallel()
	oc := &ocmocks.ProjectClientMock{
		ListProjectsFunc: func(context.Context, string, int, string) (*models.ProjectList, error) {
			return nil, openchoreo.ErrNotFound
		},
	}
	svc := NewProjectService(oc, nil, nil, nil, nil, nil)
	if _, err := svc.ListProjects(context.Background(), "acme", 100, ""); !errors.Is(err, ErrProjectNotFound) {
		t.Fatalf("want ErrProjectNotFound, got %v", err)
	}
}

// --- CreateProject --------------------------------------------------------------

func TestCreateProject_HappyPath_ProvisionsRepoWebhookAndSkills(t *testing.T) {
	t.Parallel()
	oc := &ocmocks.ProjectClientMock{
		CreateProjectFunc: func(_ context.Context, org string, req *models.CreateProjectRequest) (*models.Project, error) {
			return &models.Project{Name: req.Name, NamespaceName: org}, nil
		},
	}
	var repoOrg, repoProject, repoName string
	repoSvc := &fakeRepoSvc{
		CreateRepoFunc: func(_ context.Context, orgID, projectID, projectName string) (*models.GitRepository, error) {
			repoOrg, repoProject, repoName = orgID, projectID, projectName
			return &models.GitRepository{Status: "ready"}, nil
		},
	}
	webhooks := &fakeWebhookSvc{}
	skills := &fakeSkillsProvisioner{called: make(chan string, 1)}

	svc := NewProjectService(oc, repoSvc, webhooks, nil, nil, nil)
	svc.SetSkillsProvisioner(skills)

	p, err := svc.CreateProject(context.Background(), "acme", &models.CreateProjectRequest{Name: "web"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if p.Name != "web" {
		t.Fatalf("project name: got %q", p.Name)
	}
	if repoOrg != "acme" || repoProject != "web" || repoName != "web" {
		t.Fatalf("CreateRepo args: got (%q,%q,%q)", repoOrg, repoProject, repoName)
	}
	if webhooks.calls != 1 {
		t.Fatalf("webhook Register calls: got %d, want 1", webhooks.calls)
	}
	// Skills provisioning is fired async (best-effort goroutine).
	select {
	case org := <-skills.called:
		if org != "acme" {
			t.Fatalf("skills provisioned for org %q, want acme", org)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("skills provisioner was never called")
	}
}

func TestCreateProject_OCErrorShortCircuits(t *testing.T) {
	t.Parallel()
	oc := &ocmocks.ProjectClientMock{
		CreateProjectFunc: func(context.Context, string, *models.CreateProjectRequest) (*models.Project, error) {
			return nil, openchoreo.ErrConflict
		},
	}
	// repoSvc/webhookSvc wired with panicking fakes: reaching them fails the test.
	svc := NewProjectService(oc, &fakeRepoSvc{}, &fakeWebhookSvc{RegisterFunc: func(context.Context, string, string) (*int64, error) {
		t.Error("webhook must not be registered when OC create fails")
		return nil, nil
	}}, nil, nil, nil)

	_, err := svc.CreateProject(context.Background(), "acme", &models.CreateProjectRequest{Name: "web"})
	if !errors.Is(err, openchoreo.ErrConflict) {
		t.Fatalf("want the OC conflict error surfaced, got %v", err)
	}
}

func TestCreateProject_RepoFailureIsBestEffort(t *testing.T) {
	t.Parallel()
	oc := &ocmocks.ProjectClientMock{
		CreateProjectFunc: func(_ context.Context, _ string, req *models.CreateProjectRequest) (*models.Project, error) {
			return &models.Project{Name: req.Name}, nil
		},
	}
	repoSvc := &fakeRepoSvc{
		CreateRepoFunc: func(context.Context, string, string, string) (*models.GitRepository, error) {
			return nil, errors.New("github down")
		},
	}
	webhooks := &fakeWebhookSvc{}
	svc := NewProjectService(oc, repoSvc, webhooks, nil, nil, nil)

	p, err := svc.CreateProject(context.Background(), "acme", &models.CreateProjectRequest{Name: "web"})
	if err != nil || p == nil {
		t.Fatalf("repo provisioning failure must not fail project creation: p=%v err=%v", p, err)
	}
	if webhooks.calls != 0 {
		t.Fatalf("webhook must not be registered when repo creation failed, got %d calls", webhooks.calls)
	}
}

func TestCreateProject_WebhookFailureIsBestEffort(t *testing.T) {
	t.Parallel()
	oc := &ocmocks.ProjectClientMock{
		CreateProjectFunc: func(_ context.Context, _ string, req *models.CreateProjectRequest) (*models.Project, error) {
			return &models.Project{Name: req.Name}, nil
		},
	}
	repoSvc := &fakeRepoSvc{
		CreateRepoFunc: func(context.Context, string, string, string) (*models.GitRepository, error) {
			return &models.GitRepository{Status: "ready"}, nil
		},
	}
	webhooks := &fakeWebhookSvc{RegisterFunc: func(context.Context, string, string) (*int64, error) {
		return nil, errors.New("hook API 500")
	}}
	svc := NewProjectService(oc, repoSvc, webhooks, nil, nil, nil)

	if _, err := svc.CreateProject(context.Background(), "acme", &models.CreateProjectRequest{Name: "web"}); err != nil {
		t.Fatalf("webhook failure must not fail project creation: %v", err)
	}
}

// --- DeleteProject --------------------------------------------------------------

func TestDeleteProject_CleansUpRepo(t *testing.T) {
	t.Parallel()
	oc := &ocmocks.ProjectClientMock{
		DeleteProjectFunc: func(context.Context, string, string) error { return nil },
	}
	deleted := false
	repoSvc := &fakeRepoSvc{DeleteRepoFunc: func(_ context.Context, orgID, projectID string) error {
		if orgID != "acme" || projectID != "web" {
			t.Errorf("DeleteRepo args: (%q,%q)", orgID, projectID)
		}
		deleted = true
		return nil
	}}
	svc := NewProjectService(oc, repoSvc, nil, nil, nil, nil)
	if err := svc.DeleteProject(context.Background(), "acme", "web"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if !deleted {
		t.Fatal("git repo cleanup was not invoked")
	}
}

// TestDeleteProject_PurgesTaskRows pins the orphaned-rows fix (coverage-sweep
// finding): DeleteProject must also purge the project's component_tasks, or
// the trait_sync watcher reconciles ghosts forever (the manual
// `DELETE FROM component_tasks` every demo teardown needed).
func TestDeleteProject_PurgesTaskRows(t *testing.T) {
	t.Parallel()
	oc := &ocmocks.ProjectClientMock{
		DeleteProjectFunc: func(context.Context, string, string) error { return nil },
	}
	purged := false
	taskRepo := &fakeTaskRepo{DeleteByProjectIDFunc: func(_ context.Context, orgID, projectID string) error {
		if orgID != "acme" || projectID != "web" {
			t.Errorf("DeleteByProjectID args: (%q,%q)", orgID, projectID)
		}
		purged = true
		return nil
	}}
	svc := NewProjectService(oc, nil, nil, nil, nil, taskRepo)
	if err := svc.DeleteProject(context.Background(), "acme", "web"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if !purged {
		t.Fatal("task-row purge was not invoked")
	}
}

// A purge failure is best-effort like the repo cleanup: logged, not fatal.
func TestDeleteProject_TaskPurgeFailureIsSwallowed(t *testing.T) {
	t.Parallel()
	oc := &ocmocks.ProjectClientMock{
		DeleteProjectFunc: func(context.Context, string, string) error { return nil },
	}
	taskRepo := &fakeTaskRepo{DeleteByProjectIDFunc: func(context.Context, string, string) error {
		return errors.New("db down")
	}}
	svc := NewProjectService(oc, nil, nil, nil, nil, taskRepo)
	if err := svc.DeleteProject(context.Background(), "acme", "web"); err != nil {
		t.Fatalf("task purge failure must be swallowed, got %v", err)
	}
}

func TestDeleteProject_OCErrorSkipsRepoCleanup(t *testing.T) {
	t.Parallel()
	oc := &ocmocks.ProjectClientMock{
		DeleteProjectFunc: func(context.Context, string, string) error { return openchoreo.ErrNotFound },
	}
	repoSvc := &fakeRepoSvc{DeleteRepoFunc: func(context.Context, string, string) error {
		t.Error("repo cleanup must not run when the OC delete failed")
		return nil
	}}
	svc := NewProjectService(oc, repoSvc, nil, nil, nil, nil)
	if err := svc.DeleteProject(context.Background(), "acme", "web"); !errors.Is(err, ErrProjectNotFound) {
		t.Fatalf("want ErrProjectNotFound, got %v", err)
	}
}

func TestDeleteProject_RepoCleanupFailureIsSwallowed(t *testing.T) {
	t.Parallel()
	oc := &ocmocks.ProjectClientMock{
		DeleteProjectFunc: func(context.Context, string, string) error { return nil },
	}
	repoSvc := &fakeRepoSvc{DeleteRepoFunc: func(context.Context, string, string) error {
		return errors.New("fs error")
	}}
	svc := NewProjectService(oc, repoSvc, nil, nil, nil, nil)
	if err := svc.DeleteProject(context.Background(), "acme", "web"); err != nil {
		t.Fatalf("repo cleanup failure must be best-effort, got %v", err)
	}
}

// --- DeleteProject: resource + external-resource teardown ---------------------
// The OC Project delete does NOT cascade to Resources/ResourceReleaseBindings —
// they carry only a logical spec.owner.projectName, not a k8s ownerReference —
// so DeleteProject must deprovision them itself, before purging the task rows
// that name them.

func TestDeleteProject_DeprovisionsPlatformResourceTasksByResourceName(t *testing.T) {
	t.Parallel()
	oc := &ocmocks.ProjectClientMock{DeleteProjectFunc: func(context.Context, string, string) error { return nil }}
	taskRepo := &fakeTaskRepo{
		ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
			return []models.ComponentTask{
				{Type: models.TaskTypeComponent, ComponentName: "api"},
				{Type: models.TaskTypeResourceProvisioning, ResourceName: "db1"},
				{Type: models.TaskTypeResourceProvisioning, ResourceName: "db2"},
				{Type: models.TaskTypeResourceProvisioning, ResourceName: ""}, // guard: blank name skipped
			}, nil
		},
		DeleteByProjectIDFunc: func(context.Context, string, string) error { return nil },
	}
	resourceProv := &fakeDeprovisioner{}
	svc := NewProjectService(oc, nil, nil, nil, nil, taskRepo)
	svc.SetResourceDeprovisioner(resourceProv)

	if err := svc.DeleteProject(context.Background(), "acme", "web"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if len(resourceProv.calls) != 2 {
		t.Fatalf("want 2 platform-resource deprovision calls, got %d (%+v)", len(resourceProv.calls), resourceProv.calls)
	}
	for i, want := range []string{"db1", "db2"} {
		c := resourceProv.calls[i]
		if c.org != "acme" || c.project != "web" || c.name != want {
			t.Errorf("call %d: got (%q,%q,%q) want (acme,web,%q)", i, c.org, c.project, c.name, want)
		}
		if len(c.envs) != 1 || c.envs[0] != "development" {
			t.Errorf("call %d envs: got %v want [development]", i, c.envs)
		}
	}
}

func TestDeleteProject_DeprovisionsDistinctExternalResourcesOnly(t *testing.T) {
	t.Parallel()
	oc := &ocmocks.ProjectClientMock{DeleteProjectFunc: func(context.Context, string, string) error { return nil }}
	taskRepo := &fakeTaskRepo{
		ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
			return []models.ComponentTask{
				{Type: models.TaskTypeConfigCollection, ExternalResourceName: "stripe"},
				{Type: models.TaskTypeConfigCollection, ExternalResourceName: "stripe"}, // 2nd consumer, same resource
				{Type: models.TaskTypeConfigCollection, ExternalResourceName: "sendgrid"},
				{Type: models.TaskTypeConfigCollection, ExternalResourceName: ""}, // guard: blank name skipped
				{Type: models.TaskTypeComponent, ComponentName: "api"},
			}, nil
		},
		DeleteByProjectIDFunc: func(context.Context, string, string) error { return nil },
	}
	extProv := &fakeDeprovisioner{}
	svc := NewProjectService(oc, nil, nil, nil, nil, taskRepo)
	svc.SetExternalResourceDeprovisioner(extProv)

	if err := svc.DeleteProject(context.Background(), "acme", "web"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if len(extProv.calls) != 2 {
		t.Fatalf("want 2 distinct external-resource deprovision calls (dedup), got %d (%+v)", len(extProv.calls), extProv.calls)
	}
	seen := map[string]bool{}
	for _, c := range extProv.calls {
		seen[c.name] = true
		if c.org != "acme" || c.project != "web" {
			t.Errorf("call args: got (%q,%q)", c.org, c.project)
		}
		if len(c.envs) != 1 || c.envs[0] != "development" {
			t.Errorf("envs: got %v want [development]", c.envs)
		}
	}
	if !seen["stripe"] || !seen["sendgrid"] {
		t.Fatalf("want stripe+sendgrid both deprovisioned exactly once, got %+v", extProv.calls)
	}
}

// TestDeleteProject_DeprovisionsBeforeTaskPurge pins the load-bearing ordering:
// both deprovision ports must run to completion BEFORE taskRepo.DeleteByProjectID,
// or the resource/name that DeleteProject needs to look up would already be gone.
func TestDeleteProject_DeprovisionsBeforeTaskPurge(t *testing.T) {
	t.Parallel()
	oc := &ocmocks.ProjectClientMock{DeleteProjectFunc: func(context.Context, string, string) error { return nil }}
	var trace []string
	taskRepo := &fakeTaskRepo{
		ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
			return []models.ComponentTask{
				{Type: models.TaskTypeResourceProvisioning, ResourceName: "db1"},
				{Type: models.TaskTypeConfigCollection, ExternalResourceName: "stripe"},
			}, nil
		},
		DeleteByProjectIDFunc: func(context.Context, string, string) error {
			trace = append(trace, "purge")
			return nil
		},
	}
	resourceProv := &fakeDeprovisioner{trace: &trace, label: "resource"}
	extProv := &fakeDeprovisioner{trace: &trace, label: "external"}
	svc := NewProjectService(oc, nil, nil, nil, nil, taskRepo)
	svc.SetResourceDeprovisioner(resourceProv)
	svc.SetExternalResourceDeprovisioner(extProv)

	if err := svc.DeleteProject(context.Background(), "acme", "web"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	want := []string{"resource:db1", "external:stripe", "purge"}
	if len(trace) != len(want) {
		t.Fatalf("trace: got %v want %v", trace, want)
	}
	for i := range want {
		if trace[i] != want[i] {
			t.Fatalf("trace[%d]: got %q want %q (full trace: %v)", i, trace[i], want[i], trace)
		}
	}
}

func TestDeleteProject_ResourceDeprovisionFailureIsBestEffort(t *testing.T) {
	t.Parallel()
	oc := &ocmocks.ProjectClientMock{DeleteProjectFunc: func(context.Context, string, string) error { return nil }}
	purged := false
	taskRepo := &fakeTaskRepo{
		ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
			return []models.ComponentTask{{Type: models.TaskTypeResourceProvisioning, ResourceName: "db1"}}, nil
		},
		DeleteByProjectIDFunc: func(context.Context, string, string) error { purged = true; return nil },
	}
	resourceProv := &fakeDeprovisioner{err: errors.New("provider down")}
	svc := NewProjectService(oc, nil, nil, nil, nil, taskRepo)
	svc.SetResourceDeprovisioner(resourceProv)

	if err := svc.DeleteProject(context.Background(), "acme", "web"); err != nil {
		t.Fatalf("resource deprovision failure must be best-effort, got %v", err)
	}
	if !purged {
		t.Fatal("task purge must still run after a stuck platform-resource deprovision")
	}
}

func TestDeleteProject_ExternalResourceDeprovisionFailureIsBestEffort(t *testing.T) {
	t.Parallel()
	oc := &ocmocks.ProjectClientMock{DeleteProjectFunc: func(context.Context, string, string) error { return nil }}
	purged := false
	taskRepo := &fakeTaskRepo{
		ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
			return []models.ComponentTask{{Type: models.TaskTypeConfigCollection, ExternalResourceName: "stripe"}}, nil
		},
		DeleteByProjectIDFunc: func(context.Context, string, string) error { purged = true; return nil },
	}
	extProv := &fakeDeprovisioner{err: errors.New("provider down")}
	svc := NewProjectService(oc, nil, nil, nil, nil, taskRepo)
	svc.SetExternalResourceDeprovisioner(extProv)

	if err := svc.DeleteProject(context.Background(), "acme", "web"); err != nil {
		t.Fatalf("external-resource deprovision failure must be best-effort, got %v", err)
	}
	if !purged {
		t.Fatal("task purge must still run after a stuck external-resource deprovision")
	}
}

// TestDeleteProject_NilDeprovisioners_NoCallsNoPanic proves the teardown block
// is skipped entirely (no task listing at all) when neither port is wired —
// ListByProjectIDFunc is intentionally left unset, which panics if invoked.
func TestDeleteProject_NilDeprovisioners_NoCallsNoPanic(t *testing.T) {
	t.Parallel()
	oc := &ocmocks.ProjectClientMock{DeleteProjectFunc: func(context.Context, string, string) error { return nil }}
	purged := false
	taskRepo := &fakeTaskRepo{
		DeleteByProjectIDFunc: func(context.Context, string, string) error { purged = true; return nil },
	}
	svc := NewProjectService(oc, nil, nil, nil, nil, taskRepo)
	if err := svc.DeleteProject(context.Background(), "acme", "web"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if !purged {
		t.Fatal("task purge must still run")
	}
}

// A task-listing failure for the teardown lookup is best-effort too — the OC
// project + repo are already gone, so a DB hiccup here must not fail delete.
func TestDeleteProject_TeardownTaskListFailureIsSwallowed(t *testing.T) {
	t.Parallel()
	oc := &ocmocks.ProjectClientMock{DeleteProjectFunc: func(context.Context, string, string) error { return nil }}
	purged := false
	taskRepo := &fakeTaskRepo{
		ListByProjectIDFunc: func(context.Context, string, string) ([]models.ComponentTask, error) {
			return nil, errors.New("db down")
		},
		DeleteByProjectIDFunc: func(context.Context, string, string) error { purged = true; return nil },
	}
	resourceProv := &fakeDeprovisioner{}
	svc := NewProjectService(oc, nil, nil, nil, nil, taskRepo)
	svc.SetResourceDeprovisioner(resourceProv)

	if err := svc.DeleteProject(context.Background(), "acme", "web"); err != nil {
		t.Fatalf("teardown task-list failure must be best-effort, got %v", err)
	}
	if !purged {
		t.Fatal("task purge must still run after a teardown task-list failure")
	}
	if len(resourceProv.calls) != 0 {
		t.Fatalf("no deprovision calls expected when task listing failed, got %+v", resourceProv.calls)
	}
}

// --- GetProjectStatus phase ladder ---------------------------------------------
// The repo-lifecycle short-circuits (no-repo / cloning / error) are proven per
// branch in project_status_test.go against applyRepoToProjectStatus; here the
// ladder is driven end-through with a ready repo.

func TestGetProjectStatus_NilOrFailingRepoMeansNoRepo(t *testing.T) {
	t.Parallel()

	// nil repoSvc → no-repo.
	svc := NewProjectService(nil, nil, nil, nil, nil, nil)
	st, err := svc.GetProjectStatus(context.Background(), "acme", "web")
	if err != nil || st.Phase != "no-repo" {
		t.Fatalf("nil repoSvc: want phase no-repo, got %q (err %v)", st.Phase, err)
	}

	// GetRepo error → no-repo (soft-fail, not an error response).
	failing := &fakeRepoSvc{GetRepoFunc: func(context.Context, string, string) (*models.GitRepository, error) {
		return nil, errors.New("db down")
	}}
	st, err = NewProjectService(nil, failing, nil, nil, nil, nil).GetProjectStatus(context.Background(), "acme", "web")
	if err != nil || st.Phase != "no-repo" {
		t.Fatalf("GetRepo error: want phase no-repo, got %q (err %v)", st.Phase, err)
	}

	// GetRepo (nil, nil) — no row, no error — is the distinct "never
	// provisioned" answer, also no-repo.
	norow := &fakeRepoSvc{GetRepoFunc: func(context.Context, string, string) (*models.GitRepository, error) {
		return nil, nil
	}}
	st, err = NewProjectService(nil, norow, nil, nil, nil, nil).GetProjectStatus(context.Background(), "acme", "web")
	if err != nil || st.Phase != "no-repo" {
		t.Fatalf("GetRepo nil row: want phase no-repo, got %q (err %v)", st.Phase, err)
	}
}

func TestGetProjectStatus_DesignReadErrorPropagates(t *testing.T) {
	t.Parallel()
	// Mirrors the requirements-read propagation case: a non-NotFound design
	// read failure is an error response, not a silent hasDesign=false.
	fx := statusFixture{
		reqFiles:       map[string]string{"req.md": "# R"},
		designFilesErr: errors.New("git wedged"),
	}
	if _, err := fx.service().GetProjectStatus(context.Background(), "acme", "web"); err == nil {
		t.Fatal("a non-NotFound design read error must propagate")
	}
}

func TestGetProjectStatus_PhaseLadder(t *testing.T) {
	t.Parallel()
	someTask := []models.ComponentTask{{ID: "t1"}}
	cases := []struct {
		name       string
		fx         statusFixture
		wantPhase  string
		wantSpec   string // SpecStatus
		wantDesign string // DesignStatus
		wantTasks  bool
	}{
		{
			name:      "no spec files → prompt",
			fx:        statusFixture{reqFiles: nil, reqVersions: nil, desVersions: nil},
			wantPhase: "prompt",
		},
		{
			name:      "spec files unversioned → draft, phase spec",
			fx:        statusFixture{reqFiles: map[string]string{"req.md": "# R"}, designFiles: nil},
			wantPhase: "spec",
			wantSpec:  "draft",
		},
		{
			name: "approved spec + design, no tasks → phase tasks",
			fx: statusFixture{
				reqFiles:    map[string]string{"req.md": "# R"},
				reqVersions: []artifacts.RequirementsVersionInfo{{Tag: "v1", Version: 1}},
				desVersions: []artifacts.DesignVersionInfo{{Tag: "v1-1"}},
				designFiles: map[string]string{artifacts.DesignRootFile: "# Design"},
			},
			wantPhase:  "tasks",
			wantSpec:   "approved",
			wantDesign: "approved",
		},
		{
			name: "tasks exist → phase components",
			fx: statusFixture{
				reqFiles:    map[string]string{"req.md": "# R"},
				reqVersions: []artifacts.RequirementsVersionInfo{{Tag: "v1", Version: 1}},
				designFiles: map[string]string{artifacts.DesignRootFile: "# Design"},
				tasks:       someTask,
			},
			wantPhase: "components",
			wantSpec:  "approved",
			wantTasks: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			st, err := tc.fx.service().GetProjectStatus(context.Background(), "acme", "web")
			if err != nil {
				t.Fatalf("status: %v", err)
			}
			if st.Phase != tc.wantPhase {
				t.Fatalf("phase: got %q want %q", st.Phase, tc.wantPhase)
			}
			if st.SpecStatus != tc.wantSpec {
				t.Fatalf("specStatus: got %q want %q", st.SpecStatus, tc.wantSpec)
			}
			if st.DesignStatus != tc.wantDesign {
				t.Fatalf("designStatus: got %q want %q", st.DesignStatus, tc.wantDesign)
			}
			if st.HasTasks != tc.wantTasks {
				t.Fatalf("hasTasks: got %v want %v", st.HasTasks, tc.wantTasks)
			}
		})
	}
}

func TestGetProjectStatus_TaskListErrorPropagates(t *testing.T) {
	t.Parallel()
	fx := statusFixture{
		reqFiles:     map[string]string{"req.md": "# R"},
		designFiles:  map[string]string{artifacts.DesignRootFile: "# Design"},
		tasksListErr: errors.New("db down"),
	}
	if _, err := fx.service().GetProjectStatus(context.Background(), "acme", "web"); err == nil {
		t.Fatal("a task-list failure must propagate, not silently report no tasks")
	}
}

func TestGetProjectStatus_RequirementsListErrorPropagates(t *testing.T) {
	t.Parallel()
	fx := statusFixture{reqFilesErr: errors.New("git wedged")}
	if _, err := fx.service().GetProjectStatus(context.Background(), "acme", "web"); err == nil {
		t.Fatal("a non-NotFound requirements listing error must propagate")
	}

	// ...but the artifact NotFound sentinel means "empty", not an error.
	fx = statusFixture{reqFilesErr: artifacts.ErrArtifactNotFound}
	st, err := fx.service().GetProjectStatus(context.Background(), "acme", "web")
	if err != nil || st.Phase != "prompt" {
		t.Fatalf("NotFound must degrade to prompt, got phase %q err %v", st.Phase, err)
	}
}
