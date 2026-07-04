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

// COMPONENT tier (bff-component-testing.md §4): the REAL AccessService behind
// the REAL production handler chain — global middleware → faked auth at the
// jwt.WithClaims seam → Huma parsing/validation → the tenant gate in ENFORCE →
// the handler's sentinel→status mapping — driven in-process via the
// componenttest harness. The out-of-process seams (OC catalog, access store,
// design reader, issue ops, task creator, org-published marker) are faked at
// the ports.
//
// External test package: the harness imports api, which imports endpoints — an
// in-package test file would be an import cycle.
package endpoints_test

import (
	"context"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/api"
	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
	"github.com/wso2/aep/aep-api/internal/feature/dependencies/endpoints"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/platform/componenttest"
	"github.com/wso2/aep/aep-api/models"
)

// ---- fakes at the AccessService ports (structural; the unexported port types
// are satisfied without naming them) --------------------------------------------

type stubStore struct {
	rows    []*models.AccessRequest
	created int
}

func (s *stubStore) FindOpenForTarget(_ context.Context, orgID, pp, pc string) (*models.AccessRequest, error) {
	for _, ar := range s.rows {
		if ar.OrgID == orgID && ar.ProviderProjectID == pp && ar.ProviderComponentName == pc &&
			(ar.Status == models.AccessRequestStatusRequested || ar.Status == models.AccessRequestStatusInProgress) {
			return ar, nil
		}
	}
	return nil, nil
}
func (s *stubStore) Create(_ context.Context, ar *models.AccessRequest) error {
	if ar.ID == "" {
		ar.ID = "ar-1"
	}
	s.created++
	s.rows = append(s.rows, ar)
	return nil
}
func (s *stubStore) ListByProviderTask(_ context.Context, id string) ([]models.AccessRequest, error) {
	var out []models.AccessRequest
	for _, ar := range s.rows {
		if ar.ProviderTaskID == id {
			out = append(out, *ar)
		}
	}
	return out, nil
}
func (s *stubStore) ListByConsumerProject(_ context.Context, orgID, pid string) ([]models.AccessRequest, error) {
	var out []models.AccessRequest
	for _, ar := range s.rows {
		if ar.OrgID == orgID && ar.ConsumerProjectID == pid {
			out = append(out, *ar)
		}
	}
	return out, nil
}
func (s *stubStore) UpdateStatus(context.Context, string, string) error { return nil }

type stubDesign struct{ byProject map[string][]models.DesignComponent }

func (d *stubDesign) ReadDesignComponents(_ context.Context, _, pid string) ([]models.DesignComponent, error) {
	return d.byProject[pid], nil
}

type stubIssue struct{ created, closed int }

func (s *stubIssue) CreateIssue(_ context.Context, _, _ string, _ gitrepo.CreateIssueRequest) (*gitrepo.IssueResult, error) {
	s.created++
	return &gitrepo.IssueResult{Number: 1, URL: "https://github.com/acme/repo/issues/1"}, nil
}
func (s *stubIssue) CloseIssue(context.Context, string, string, int, string) error {
	s.closed++
	return nil
}

type stubTasks struct{ created int }

func (s *stubTasks) Create(_ context.Context, t *models.ComponentTask) error {
	s.created++
	t.ID = "task-1"
	return nil
}

type stubMarker struct{}

func (stubMarker) SetComponentOrgPublished(context.Context, string, string, string) error { return nil }

// catalogWith returns a real endpoints.Catalog over a faked OC client listing
// the given provider endpoints.
func catalogWith(eps []openchoreo.WorkloadEndpointInfo) *endpoints.Catalog {
	return endpoints.NewCatalog(&ocmocks.ResourceClientMock{
		ListWorkloadEndpointsFunc: func(_ context.Context, _ string) ([]openchoreo.WorkloadEndpointInfo, error) {
			return eps, nil
		},
	})
}

func providerEndpoints() []openchoreo.WorkloadEndpointInfo {
	return []openchoreo.WorkloadEndpointInfo{
		{Project: "hr-directory", Component: "hr-directory-employee-api", Name: "http", Type: "HTTP",
			Port: 8080, Visibility: []string{"external"}},
	}
}

func consumerComps() map[string][]models.DesignComponent {
	return map[string][]models.DesignComponent{
		"store-front": {{Name: "checkout", Dependencies: []models.Dependency{
			{Kind: models.DependencyKindOrgService, Name: "hr-directory-employee-api"},
			{Kind: models.DependencyKindExternal, Name: "stripe"},
		}}},
		"hr-directory": {{Name: "employee-api", AppPath: "/services/employee-api"}},
	}
}

func newAccessHarness(t *testing.T, store *stubStore, iss *stubIssue, tasks *stubTasks, eps []openchoreo.WorkloadEndpointInfo) *componenttest.Harness {
	t.Helper()
	svc := endpoints.NewAccessService(store, catalogWith(eps), &stubDesign{byProject: consumerComps()},
		iss, tasks, stubMarker{})
	return componenttest.New(t, componenttest.Options{Deps: api.HumaDeps{AccessSvc: svc}})
}

// ---- create ---------------------------------------------------------------------

func TestAccessComponent_CreateAccessRequest(t *testing.T) {
	t.Parallel()

	t.Run("valid org-service dep creates task+issue with 201", func(t *testing.T) {
		t.Parallel()
		store, iss, tasks := &stubStore{}, &stubIssue{}, &stubTasks{}
		h := newAccessHarness(t, store, iss, tasks, providerEndpoints())

		resp := h.AsOrg("acme").Post(
			"/api/v1/projects/store-front/components/checkout/dependencies/hr-directory-employee-api/access-request", "")
		if resp.Code != 201 {
			t.Fatalf("want 201, got %d body=%s", resp.Code, resp.Body.String())
		}
		body := resp.Body.String()
		for _, want := range []string{`"providerComponentName":"employee-api"`, `"status":"requested"`} {
			if !strings.Contains(body, want) {
				t.Errorf("201 body missing %s: %s", want, body)
			}
		}
		if tasks.created != 1 || iss.created != 1 || store.created != 1 {
			t.Fatalf("want one task/issue/row, got task=%d issue=%d row=%d", tasks.created, iss.created, store.created)
		}
	})

	t.Run("unknown org-service (empty catalog) is 404", func(t *testing.T) {
		t.Parallel()
		h := newAccessHarness(t, &stubStore{}, &stubIssue{}, &stubTasks{}, nil)

		resp := h.AsOrg("acme").Post(
			"/api/v1/projects/store-front/components/checkout/dependencies/hr-directory-employee-api/access-request", "")
		if resp.Code != 404 {
			t.Fatalf("want 404, got %d body=%s", resp.Code, resp.Body.String())
		}
	})

	t.Run("unknown dep on the component is 404", func(t *testing.T) {
		t.Parallel()
		h := newAccessHarness(t, &stubStore{}, &stubIssue{}, &stubTasks{}, providerEndpoints())

		resp := h.AsOrg("acme").Post(
			"/api/v1/projects/store-front/components/checkout/dependencies/no-such-dep/access-request", "")
		if resp.Code != 404 {
			t.Fatalf("want 404, got %d body=%s", resp.Code, resp.Body.String())
		}
	})

	t.Run("wrong-kind dep is 400 naming both kinds", func(t *testing.T) {
		t.Parallel()
		h := newAccessHarness(t, &stubStore{}, &stubIssue{}, &stubTasks{}, providerEndpoints())

		resp := h.AsOrg("acme").Post(
			"/api/v1/projects/store-front/components/checkout/dependencies/stripe/access-request", "")
		if resp.Code != 400 {
			t.Fatalf("want 400, got %d body=%s", resp.Code, resp.Body.String())
		}
		p := componenttest.DecodeProblem(t, resp.Body.String())
		for _, want := range []string{models.DependencyKindExternal, models.DependencyKindOrgService} {
			if !strings.Contains(p.Detail, want) {
				t.Errorf("400 detail must name kind %q: %q", want, p.Detail)
			}
		}
	})
}

// ---- list -----------------------------------------------------------------------

func TestAccessComponent_ListAccessRequests(t *testing.T) {
	t.Parallel()
	store := &stubStore{rows: []*models.AccessRequest{
		{ID: "a", OrgID: "acme", ConsumerProjectID: "store-front", OrgServiceName: "hr-directory-employee-api",
			Status: models.AccessRequestStatusRequested},
		{ID: "b", OrgID: "acme", ConsumerProjectID: "other", Status: models.AccessRequestStatusGranted},
	}}
	h := newAccessHarness(t, store, &stubIssue{}, &stubTasks{}, providerEndpoints())

	resp := h.AsOrg("acme").Get("/api/v1/projects/store-front/dependencies/access-requests")
	if resp.Code != 200 {
		t.Fatalf("want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	body := resp.Body.String()
	if !strings.Contains(body, `"orgServiceName":"hr-directory-employee-api"`) {
		t.Errorf("list body missing the store-front row: %s", body)
	}
	if strings.Contains(body, `"consumerProjectId":"other"`) {
		t.Errorf("list must scope to the addressed project, leaked other: %s", body)
	}
}

// ---- gate + nil-guard -----------------------------------------------------------

func TestAccessComponent_NoClaimsDeniedByEnforceGate(t *testing.T) {
	t.Parallel()
	h := newAccessHarness(t, &stubStore{}, &stubIssue{}, &stubTasks{}, providerEndpoints())

	resp := h.NoAuth().Get("/api/v1/projects/store-front/dependencies/access-requests")
	if resp.Code != 401 {
		t.Fatalf("no-claims: want the gate's ENFORCE 401, got %d body=%s", resp.Code, resp.Body.String())
	}
}

// TestAccessComponent_NilDeps503 proves registration is pure metadata: with a
// nil AccessSvc the routes exist and nil-guard to 503 instead of panicking.
func TestAccessComponent_NilDeps503(t *testing.T) {
	t.Parallel()
	h := componenttest.New(t, componenttest.Options{Deps: api.HumaDeps{}})

	if code := h.AsOrg("acme").Post(
		"/api/v1/projects/p/components/c/dependencies/d/access-request", "").Code; code != 503 {
		t.Errorf("create with nil deps: want 503, got %d", code)
	}
	if code := h.AsOrg("acme").Get("/api/v1/projects/p/dependencies/access-requests").Code; code != 503 {
		t.Errorf("list with nil deps: want 503, got %d", code)
	}
}
