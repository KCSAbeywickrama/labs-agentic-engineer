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

// COMPONENT tier (bff-component-testing.md §4): the REAL project service
// behind the REAL production handler chain — global middleware → faked auth at
// the jwt.WithClaims seam → orgensure → Huma parsing/validation → the tenant
// gate in ENFORCE → mapProjectError — driven in-process via the componenttest
// harness. Only the out-of-process OpenChoreo client is mocked. Error-shape
// assertions mirror the harvested goldens (testdata/harvest/golden/): the 422
// and 404 bodies here are the same RFC-9457 problems the deployed stack
// serves.
//
// External test package: the harness imports api, which imports project — an
// in-package test file would be an import cycle.
package project_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/api"
	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/feature/project"
	"github.com/wso2/aep/aep-api/internal/platform/componenttest"
	"github.com/wso2/aep/aep-api/models"
)

// conflictRepoSvc is a minimal gitrepo.RepoService whose CreateRepo always
// reports a name conflict; every other method is unreachable from create.
type conflictRepoSvc struct{}

func (conflictRepoSvc) CreateRepo(context.Context, string, string, string, string) (*models.GitRepository, error) {
	return nil, fmt.Errorf("create github repo: %w", gitrepo.ErrRepoNameConflict)
}
func (conflictRepoSvc) ListByOrg(context.Context, string) ([]models.GitRepository, error) {
	return nil, nil
}
func (conflictRepoSvc) EnsureBareRepo(context.Context, string, string, string) (*models.GitRepository, error) {
	panic("EnsureBareRepo not expected")
}
func (conflictRepoSvc) GetRepo(context.Context, string, string) (*models.GitRepository, error) {
	panic("GetRepo not expected")
}
func (conflictRepoSvc) SetWebhookID(context.Context, string, string, int64) error {
	panic("SetWebhookID not expected")
}
func (conflictRepoSvc) DeleteRepo(context.Context, string, string) error {
	panic("DeleteRepo not expected")
}

// newProjectHarness assembles the real handler with the REAL project service;
// only the OC client is mocked. The sibling ports (repo, webhook, artifacts,
// tasks) stay nil — CreateProject/DeleteProject treat them as best-effort and
// GetProjectStatus degrades to no-repo, all unit-proven branches.
func newProjectHarness(t *testing.T) (*componenttest.Harness, *ocmocks.ProjectClientMock) {
	t.Helper()
	oc := &ocmocks.ProjectClientMock{}
	svc := project.NewProjectService(oc, nil, nil, nil, nil)
	return componenttest.New(t, componenttest.Options{Deps: api.HumaDeps{ProjectSvc: svc}}), oc
}

// problem is the RFC-9457 body shape Huma serves for every error.
type problem struct {
	Title  string `json:"title"`
	Status int    `json:"status"`
	Detail string `json:"detail"`
	Errors []struct {
		Message  string `json:"message"`
		Location string `json:"location"`
	} `json:"errors"`
}

func decodeProblem(t *testing.T, body string) problem {
	t.Helper()
	var p problem
	if err := json.Unmarshal([]byte(body), &p); err != nil {
		t.Fatalf("not an RFC-9457 problem body: %v\n%s", err, body)
	}
	return p
}

func TestProjectComponent_ListAuthedReachesRealService(t *testing.T) {
	t.Parallel()
	h, oc := newProjectHarness(t)
	oc.ListProjectsFunc = func(_ context.Context, orgName string, _ int, _ string) (*models.ProjectList, error) {
		return &models.ProjectList{Items: []models.Project{{Name: "hello-world-api", NamespaceName: orgName}}}, nil
	}

	resp := h.AsOrg("acme").Get("/api/v1/projects")
	if resp.Code != 200 {
		t.Fatalf("authed list: got %d, body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "hello-world-api") {
		t.Fatalf("list body missing item: %s", resp.Body.String())
	}
	// The org the service saw MUST be the token org — OrgHandle is bound by the
	// gate from claims, never from client input.
	calls := oc.ListProjectsCalls()
	if len(calls) != 1 || calls[0].OrgName != "acme" {
		t.Fatalf("service org: got %+v, want one call with org acme", calls)
	}
}

func TestProjectComponent_NoClaimsDeniedByEnforceGate(t *testing.T) {
	t.Parallel()
	h, _ := newProjectHarness(t)

	resp := h.NoAuth().Get("/api/v1/projects")
	if resp.Code != 401 {
		t.Fatalf("no-claims list: want the gate's ENFORCE 401, got %d body=%s", resp.Code, resp.Body.String())
	}
	// This is the GATE's 401, not the JWT middleware's {error,message} shape in
	// the err_401 golden — the harness fakes the verifier away; the middleware's
	// rejection is integration-owned. Huma aggregates resolver errors into one
	// RFC-9457 problem (detail "validation failed") carrying the gate's message
	// in errors[].
	p := decodeProblem(t, resp.Body.String())
	if p.Status != 401 || len(p.Errors) == 0 || !strings.Contains(p.Errors[0].Message, "authentication required") {
		t.Fatalf("gate 401 problem shape: got %s", resp.Body.String())
	}
}

func TestProjectComponent_CreateValidationAndHappyPath(t *testing.T) {
	t.Parallel()
	h, oc := newProjectHarness(t)
	oc.CreateProjectFunc = func(_ context.Context, orgName string, req *models.CreateProjectRequest) (*models.Project, error) {
		return &models.Project{Name: req.Name, NamespaceName: orgName}, nil
	}

	// name ABSENT → Huma schema validation 422, same shape as the harvested
	// golden err_422_create_project.json.
	resp := h.AsOrg("acme").Post("/api/v1/projects", `{}`)
	if resp.Code != 422 {
		t.Fatalf("empty body: want 422, got %d body=%s", resp.Code, resp.Body.String())
	}
	p := decodeProblem(t, resp.Body.String())
	if len(p.Errors) == 0 || !strings.Contains(p.Errors[0].Message, "expected required property name to be present") {
		t.Fatalf("422 shape drifted from golden: %s", resp.Body.String())
	}
	if len(oc.CreateProjectCalls()) != 0 {
		t.Fatal("schema-invalid request must never reach the service")
	}

	// name PRESENT but empty → the handler guard's 400.
	resp = h.AsOrg("acme").Post("/api/v1/projects", `{"name":""}`)
	if resp.Code != 400 {
		t.Fatalf("empty name: want 400, got %d body=%s", resp.Code, resp.Body.String())
	}
	if p := decodeProblem(t, resp.Body.String()); p.Detail != "name is required" {
		t.Fatalf("400 detail: got %q", p.Detail)
	}

	// Valid create → 201 with the project body; exactly one OC call, token org.
	resp = h.AsOrg("acme").Post("/api/v1/projects", `{"name":"web","displayName":"Web"}`)
	if resp.Code != 201 {
		t.Fatalf("create: want 201, got %d body=%s", resp.Code, resp.Body.String())
	}
	calls := oc.CreateProjectCalls()
	if len(calls) != 1 || calls[0].OrgName != "acme" || calls[0].Req.Name != "web" {
		t.Fatalf("OC create call: got %+v", calls)
	}

	// prompt + repoName are contract fields the console sends (issue #72 /
	// #98): huma must accept them, and they must survive into the service's
	// request. prompt is not consumed yet; repoName overrides the provisioned
	// repo's name (asserted at the service tier).
	resp = h.AsOrg("acme").Post("/api/v1/projects",
		`{"name":"gym","prompt":"a workout tracker","repoName":"gym-repo"}`)
	if resp.Code != 201 {
		t.Fatalf("create with prompt+repoName: want 201, got %d body=%s", resp.Code, resp.Body.String())
	}
	calls = oc.CreateProjectCalls()
	last := calls[len(calls)-1]
	if last.Req.Prompt != "a workout tracker" || last.Req.RepoName != "gym-repo" {
		t.Fatalf("prompt/repoName lost in transit: got %+v", last.Req)
	}

	// repoName that isn't a DNS-label slug → the handler guard's 400 (GitHub
	// would otherwise silently normalize it, diverging from the stored name).
	resp = h.AsOrg("acme").Post("/api/v1/projects", `{"name":"web2","repoName":"Bad Name!"}`)
	if resp.Code != 400 {
		t.Fatalf("bad repoName: want 400, got %d body=%s", resp.Code, resp.Body.String())
	}
	if p := decodeProblem(t, resp.Body.String()); !strings.Contains(p.Detail, "repoName") {
		t.Fatalf("400 detail should name repoName: got %q", p.Detail)
	}
}

// A user-chosen repoName that already exists on the Git host must fail the
// whole create with a 409 (and compensate the OC project away) — the no-repo
// limbo would be unrecoverable for that name.
func TestProjectComponent_CreateExplicitRepoNameConflictIs409(t *testing.T) {
	t.Parallel()
	oc := &ocmocks.ProjectClientMock{
		CreateProjectFunc: func(_ context.Context, orgName string, req *models.CreateProjectRequest) (*models.Project, error) {
			return &models.Project{Name: req.Name, NamespaceName: orgName}, nil
		},
		DeleteProjectFunc: func(context.Context, string, string) error { return nil },
	}
	svc := project.NewProjectService(oc, conflictRepoSvc{}, nil, nil, nil)
	h := componenttest.New(t, componenttest.Options{Deps: api.HumaDeps{ProjectSvc: svc}})

	resp := h.AsOrg("acme").Post("/api/v1/projects", `{"name":"gym","repoName":"taken-repo"}`)
	if resp.Code != 409 {
		t.Fatalf("taken repoName: want 409, got %d body=%s", resp.Code, resp.Body.String())
	}
	p := decodeProblem(t, resp.Body.String())
	if !strings.Contains(strings.ToLower(p.Detail), "repo") {
		t.Fatalf("409 detail should mention the repository name: got %q", p.Detail)
	}
	if n := len(oc.DeleteProjectCalls()); n != 1 {
		t.Fatalf("OC project compensation: DeleteProject called %d times, want 1", n)
	}
}

func TestProjectComponent_GetMapsNotFoundToGoldenProblem(t *testing.T) {
	t.Parallel()
	h, oc := newProjectHarness(t)
	oc.GetProjectFunc = func(context.Context, string, string) (*models.Project, error) {
		return nil, openchoreo.ErrNotFound
	}

	resp := h.AsOrg("acme").Get("/api/v1/projects/does-not-exist-xyz")
	if resp.Code != 404 {
		t.Fatalf("want 404, got %d body=%s", resp.Code, resp.Body.String())
	}
	// Same body as testdata/harvest/golden/err_404_project.json.
	if p := decodeProblem(t, resp.Body.String()); p.Detail != "project not found" || p.Title != "Not Found" {
		t.Fatalf("404 shape drifted from golden: %s", resp.Body.String())
	}
}

// TestProjectComponent_ErrorMapping drives the rest of mapProjectError through
// the real chain: untranslated OC sentinels ride the shared ocerr classifier
// (409/…), feature sentinels map to their statuses (403), and an opaque error
// falls back to an opaque 500 (no internal detail leaked).
func TestProjectComponent_ErrorMapping(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name       string
		err        error
		wantStatus int
		wantDetail string
	}{
		{"oc unauthorized → 401", openchoreo.ErrUnauthorized, 401, "invalid or expired token"},
		{"oc conflict → 409", openchoreo.ErrConflict, 409, ""},
		{"oc forbidden → 403", openchoreo.ErrForbidden, 403, "insufficient permissions to perform this action"},
		{"opaque → 500 without leaking internals", errors.New("pg: connection refused"), 500, "internal error"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			h, oc := newProjectHarness(t)
			oc.GetProjectFunc = func(context.Context, string, string) (*models.Project, error) {
				return nil, tc.err
			}
			resp := h.AsOrg("acme").Get("/api/v1/projects/web")
			if resp.Code != tc.wantStatus {
				t.Fatalf("want %d, got %d body=%s", tc.wantStatus, resp.Code, resp.Body.String())
			}
			p := decodeProblem(t, resp.Body.String())
			if tc.wantDetail != "" && p.Detail != tc.wantDetail {
				t.Fatalf("detail: got %q want %q", p.Detail, tc.wantDetail)
			}
			if tc.wantStatus == 500 && strings.Contains(resp.Body.String(), "connection refused") {
				t.Fatalf("500 body leaks internals: %s", resp.Body.String())
			}
		})
	}
}

func TestProjectComponent_GetHappyPath(t *testing.T) {
	t.Parallel()
	h, oc := newProjectHarness(t)
	oc.GetProjectFunc = func(_ context.Context, org, name string) (*models.Project, error) {
		return &models.Project{Name: name, NamespaceName: org}, nil
	}
	resp := h.AsOrg("acme").Get("/api/v1/projects/web")
	if resp.Code != 200 || !strings.Contains(resp.Body.String(), `"name":"web"`) {
		t.Fatalf("get: got %d body=%s", resp.Code, resp.Body.String())
	}
}

func TestProjectComponent_DeleteReturns204(t *testing.T) {
	t.Parallel()
	h, oc := newProjectHarness(t)
	oc.DeleteProjectFunc = func(context.Context, string, string) error { return nil }

	resp := h.AsOrg("acme").Delete("/api/v1/projects/web")
	if resp.Code != 204 {
		t.Fatalf("delete: want 204, got %d body=%s", resp.Code, resp.Body.String())
	}
	if got := len(oc.DeleteProjectCalls()); got != 1 {
		t.Fatalf("OC delete calls: got %d", got)
	}
}

func TestProjectComponent_StatusWiredThroughRealService(t *testing.T) {
	t.Parallel()
	h, _ := newProjectHarness(t)

	// With nil sibling ports the real service returns the no-repo phase — the
	// full ladder is unit-proven; this proves the route→service→body wiring.
	resp := h.AsOrg("acme").Get("/api/v1/projects/web/status")
	if resp.Code != 200 {
		t.Fatalf("status: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	var st models.ProjectStatus
	if err := json.Unmarshal(resp.Body.Bytes(), &st); err != nil {
		t.Fatalf("status body: %v\n%s", err, resp.Body.String())
	}
	if st.Phase != "no-repo" {
		t.Fatalf("phase: got %q", st.Phase)
	}
}
