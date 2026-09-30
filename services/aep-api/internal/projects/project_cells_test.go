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

package projects

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
	"github.com/wso2/aep/aep-api/internal/gen"
)

// fakeCells records the bindings CreateProject asked for. The project and
// every binding read Ready unless a readiness script says otherwise.
type fakeCells struct {
	envs      []string
	envsErr   error
	bindErr   error
	pipelines []string          // pipeline names PipelineEnvironments was called with
	bound     map[string]string // project -> environment, last write wins per env key

	mu sync.Mutex
	// project, when set, is the Project readiness sequence: one entry per read,
	// the last one repeating. Nil reads Ready.
	project []readinessRead
	// binding is the same, for every binding.
	binding      []readinessRead
	projectReads int
	bindingReads int
}

type readinessRead struct {
	r   openchoreo.Readiness
	err error
}

func next(seq []readinessRead, n int) (openchoreo.Readiness, error) {
	if len(seq) == 0 {
		return openchoreo.Readiness{Ready: true, Reason: "Ready"}, nil
	}
	if n >= len(seq) {
		n = len(seq) - 1
	}
	return seq[n].r, seq[n].err
}

func (f *fakeCells) ProjectReadiness(context.Context, string, string) (openchoreo.Readiness, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.projectReads++
	return next(f.project, f.projectReads-1)
}

func (f *fakeCells) ProjectReleaseBindingReadiness(context.Context, string, string, string) (openchoreo.Readiness, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.bindingReads++
	return next(f.binding, f.bindingReads-1)
}

func (f *fakeCells) PipelineEnvironments(_ context.Context, _, pipelineName string) ([]string, error) {
	f.pipelines = append(f.pipelines, pipelineName)
	return f.envs, f.envsErr
}

func (f *fakeCells) EnsureProjectReleaseBinding(_ context.Context, _, projectName, environment string) error {
	if f.bindErr != nil {
		return f.bindErr
	}
	if f.bound == nil {
		f.bound = map[string]string{}
	}
	f.bound[environment] = projectName
	return nil
}

func createdProjectOC(deploymentPipeline string) *mocks.ProjectClientMock {
	return &mocks.ProjectClientMock{
		CreateProjectFunc: func(_ context.Context, orgName string, req *gen.CreateProjectRequest) (*gen.Project, error) {
			return &gen.Project{
				Name:               req.Name,
				NamespaceName:      orgName,
				DeploymentPipeline: deploymentPipeline,
			}, nil
		},
		DeleteProjectFunc: func(context.Context, string, string) error { return nil },
	}
}

// A created project must get one ProjectReleaseBinding per environment its
// pipeline promotes through — that binding is what materializes the cell
// namespace on OpenChoreo 1.2.0.
func TestCreateProject_BindsEveryPipelineEnvironment(t *testing.T) {
	t.Parallel()
	oc := createdProjectOC("default")
	cells := &fakeCells{envs: []string{"default", "staging"}}
	svc := NewProjectService(oc, nil, nil, nil, nil)
	svc.SetProjectCellProvisioner(cells)

	if _, err := svc.CreateProject(context.Background(), "acme",
		&gen.CreateProjectRequest{Name: "shop"}); err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	if got := cells.bound["default"]; got != "shop" {
		t.Errorf("default binding: got %q, want %q", got, "shop")
	}
	if got := cells.bound["staging"]; got != "shop" {
		t.Errorf("staging binding: got %q, want %q", got, "shop")
	}
	// The pipeline the project actually resolved to, not a hardcoded name.
	if len(cells.pipelines) != 1 || cells.pipelines[0] != "default" {
		t.Errorf("pipeline lookups: got %v, want [default]", cells.pipelines)
	}
}

func TestCreateProject_DoesNotBindOffPipelineEnvironments(t *testing.T) {
	t.Parallel()
	oc := createdProjectOC("default")
	cells := &fakeCells{envs: []string{"development", "staging", "production"}}
	svc := NewProjectService(oc, nil, nil, nil, nil)
	svc.SetProjectCellProvisioner(cells)

	if _, err := svc.CreateProject(context.Background(), "acme",
		&gen.CreateProjectRequest{Name: "shop"}); err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	for _, env := range []string{"development", "staging", "production"} {
		if got := cells.bound[env]; got != "shop" {
			t.Errorf("%s binding: got %q, want shop", env, got)
		}
	}
	if _, ok := cells.bound["default"]; ok {
		t.Errorf("bound unexpected default cell; the write target is resolved per project, not appended here")
	}
}

// A binding failure leaves an undeployable project behind, and retrying the
// create cannot fix it (OpenChoreo answers 409). So the project is compensated
// away and the error surfaces.
func TestCreateProject_CompensatesWhenBindingFails(t *testing.T) {
	t.Parallel()
	oc := createdProjectOC("default")
	deleted := ""
	oc.DeleteProjectFunc = func(_ context.Context, _, projectName string) error {
		deleted = projectName
		return nil
	}
	cells := &fakeCells{envs: []string{"default"}, bindErr: errors.New("boom")}
	svc := NewProjectService(oc, nil, nil, nil, nil)
	svc.SetProjectCellProvisioner(cells)

	if _, err := svc.CreateProject(context.Background(), "acme",
		&gen.CreateProjectRequest{Name: "shop"}); err == nil {
		t.Fatal("CreateProject: want error, got nil")
	}
	if deleted != "shop" {
		t.Errorf("compensating delete: got %q, want %q", deleted, "shop")
	}
}

// A pipeline that resolves to no environments is a misconfiguration, not an
// empty success: accepting it would produce exactly the undeployable project
// this path exists to prevent.
func TestCreateProject_RejectsPipelineWithNoEnvironments(t *testing.T) {
	t.Parallel()
	oc := createdProjectOC("default")
	cells := &fakeCells{envs: nil}
	svc := NewProjectService(oc, nil, nil, nil, nil)
	svc.SetProjectCellProvisioner(cells)

	if _, err := svc.CreateProject(context.Background(), "acme",
		&gen.CreateProjectRequest{Name: "shop"}); err == nil {
		t.Fatal("CreateProject: want error, got nil")
	}
}

// An unresolvable pipeline name never reaches OpenChoreo — there is nothing to
// look up, and the project cannot be bound to anything.
func TestCreateProject_RejectsProjectWithNoPipeline(t *testing.T) {
	t.Parallel()
	oc := createdProjectOC("")
	cells := &fakeCells{envs: []string{"default"}}
	svc := NewProjectService(oc, nil, nil, nil, nil)
	svc.SetProjectCellProvisioner(cells)

	if _, err := svc.CreateProject(context.Background(), "acme",
		&gen.CreateProjectRequest{Name: "shop"}); err == nil {
		t.Fatal("CreateProject: want error, got nil")
	}
	if len(cells.pipelines) != 0 {
		t.Errorf("pipeline lookups: got %v, want none", cells.pipelines)
	}
}

// A project whose pipeline names no write target can never deploy, so the
// create fails with the typed cause and compensates, exactly as a cell
// binding failure does (ADR-0039). A transient resolve failure compensates
// too: the create cannot be retried against an existing OC Project.
func TestCreateProject_CompensatesWhenTheWriteTargetCannotBeResolved(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name    string
		err     error
		wantNWT bool
	}{
		{"no write target", &openchoreo.ErrNoWriteTarget{
			Org: "acme", Project: "shop", Pipeline: "default", Cause: openchoreo.ErrPipelineCyclic,
		}, true},
		{"transient", errors.New("openchoreo: 503"), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			oc := createdProjectOC("default")
			deleted := ""
			oc.DeleteProjectFunc = func(_ context.Context, _, projectName string) error {
				deleted = projectName
				return nil
			}
			svc := NewProjectService(oc, nil, nil, nil, nil)
			svc.SetProjectCellProvisioner(&fakeCells{envs: []string{"default"}})
			svc.SetWriteTargets(staticWriteTarget{err: tc.err})

			_, err := svc.CreateProject(context.Background(), "acme", &gen.CreateProjectRequest{Name: "shop"})

			if !errors.Is(err, tc.err) {
				t.Fatalf("CreateProject error = %v, want %v", err, tc.err)
			}
			var nwt *openchoreo.ErrNoWriteTarget
			if got := errors.As(err, &nwt); got != tc.wantNWT {
				t.Errorf("errors.As(*ErrNoWriteTarget) = %v, want %v", got, tc.wantNWT)
			}
			if deleted != "shop" {
				t.Errorf("compensating delete: got %q, want %q", deleted, "shop")
			}
		})
	}
}

func TestCreateProject_SucceedsWithAResolvableWriteTarget(t *testing.T) {
	t.Parallel()
	oc := createdProjectOC("default")
	oc.DeleteProjectFunc = func(context.Context, string, string) error {
		t.Error("a deployable project must not be compensated away")
		return nil
	}
	svc := NewProjectService(oc, nil, nil, nil, nil)
	svc.SetProjectCellProvisioner(&fakeCells{envs: []string{"development"}})
	svc.SetWriteTargets(staticWriteTarget{env: "development"})

	if _, err := svc.CreateProject(context.Background(), "acme", &gen.CreateProjectRequest{Name: "shop"}); err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
}

// fastCellWait keeps the readiness wait's bound and poll short in tests.
var fastCellWait = cellReadyWait{timeout: 200 * time.Millisecond, interval: 5 * time.Millisecond}

// A Project whose ProjectType does not exist never reconciles: no
// ProjectRelease, no cell namespace, nothing can deploy. The create fails
// loud with OpenChoreo's words and compensates, rather than returning a
// project that looks created.
func TestCreateProject_FailsAndCompensatesWhenTheProjectTypeIsMissing(t *testing.T) {
	t.Parallel()
	oc := createdProjectOC("default")
	deleted := ""
	oc.DeleteProjectFunc = func(_ context.Context, _, projectName string) error {
		deleted = projectName
		return nil
	}
	cells := &fakeCells{envs: []string{"development"}, project: []readinessRead{
		{r: openchoreo.Readiness{}},
		{r: openchoreo.Readiness{Reason: openchoreo.ReasonProjectTypeNotFound, Message: `ProjectType "default" not found`}},
	}}
	svc := NewProjectService(oc, nil, nil, nil, nil)
	svc.SetProjectCellProvisioner(cells)
	svc.cellWait = fastCellWait

	_, err := svc.CreateProject(context.Background(), "acme", &gen.CreateProjectRequest{Name: "shop"})

	if !errors.Is(err, ErrProjectTypeNotFound) {
		t.Fatalf("CreateProject error = %v, want ErrProjectTypeNotFound", err)
	}
	if want := `ProjectType "default" not found`; !strings.Contains(err.Error(), want) {
		t.Errorf("error %q does not carry OpenChoreo's message %q", err, want)
	}
	if deleted != "shop" {
		t.Errorf("compensating delete: got %q, want %q", deleted, "shop")
	}
}

// The create waits for the Project and every binding to report Ready, not
// just for the binding POSTs to be accepted.
func TestCreateProject_WaitsForProjectAndBindingsReady(t *testing.T) {
	t.Parallel()
	oc := createdProjectOC("default")
	notYet := readinessRead{r: openchoreo.Readiness{Reason: "NamespaceProgressing"}}
	ready := readinessRead{r: openchoreo.Readiness{Ready: true, Reason: "Ready"}}
	cells := &fakeCells{
		envs:    []string{"development", "staging"},
		project: []readinessRead{{r: openchoreo.Readiness{}}, ready},
		binding: []readinessRead{notYet, notYet, ready},
	}
	svc := NewProjectService(oc, nil, nil, nil, nil)
	svc.SetProjectCellProvisioner(cells)
	svc.cellWait = cellReadyWait{timeout: 5 * time.Second, interval: time.Millisecond}

	if _, err := svc.CreateProject(context.Background(), "acme", &gen.CreateProjectRequest{Name: "shop"}); err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	cells.mu.Lock()
	defer cells.mu.Unlock()
	if cells.projectReads < 2 {
		t.Errorf("project reads = %d, want the wait to poll past the first not-Ready read", cells.projectReads)
	}
	// Two not-ready binding reads, then both environments read Ready.
	if cells.bindingReads < 4 {
		t.Errorf("binding reads = %d, want the wait to poll until every binding is Ready", cells.bindingReads)
	}
}

// Slowness is not failure: a project still reconciling when the bound runs out
// is kept (its status reports the reason), and so is one whose readiness could
// not be read.
func TestCreateProject_KeepsAProjectThatIsNotReadyWithinTheBound(t *testing.T) {
	t.Parallel()
	for name, cells := range map[string]*fakeCells{
		"binding still progressing": {envs: []string{"development"},
			binding: []readinessRead{{r: openchoreo.Readiness{Reason: "NamespaceProgressing"}}}},
		"readiness unreadable": {envs: []string{"development"},
			project: []readinessRead{{err: errors.New("openchoreo: 503")}}},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			oc := createdProjectOC("default")
			oc.DeleteProjectFunc = func(context.Context, string, string) error {
				t.Error("a project that is only slow must not be compensated away")
				return nil
			}
			svc := NewProjectService(oc, nil, nil, nil, nil)
			svc.SetProjectCellProvisioner(cells)
			svc.cellWait = fastCellWait

			if _, err := svc.CreateProject(context.Background(), "acme", &gen.CreateProjectRequest{Name: "shop"}); err != nil {
				t.Fatalf("CreateProject: %v", err)
			}
		})
	}
}
