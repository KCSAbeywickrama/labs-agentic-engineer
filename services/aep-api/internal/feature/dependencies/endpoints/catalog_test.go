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

package endpoints

import (
	"context"
	"errors"
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
)

// NOTE (dependency-management migration): the structural compile-time check that
// *Catalog satisfies artifacts.OrgServiceResolver is re-added in Phase 5, when the
// read-time org-service resolver (artifacts.OrgServiceResolver) is introduced.

func sampleEndpoints() []openchoreo.WorkloadEndpointInfo {
	return []openchoreo.WorkloadEndpointInfo{
		// org-published: external + namespace → an org-service target.
		{Project: "hr", Component: "employee-api", Workload: "hr-employee-api-workload",
			Name: "http", Type: "HTTP", Port: 8080, Visibility: []string{"external", "namespace"}},
		// project-only: no namespace visibility → NOT an org-service target.
		{Project: "hr", Component: "payroll-internal", Workload: "hr-payroll-internal-workload",
			Name: "http", Type: "HTTP", Port: 8081, Visibility: []string{"external"}},
		// same-project sibling with ONLY implicit project visibility (no
		// namespace/external) → resolvable by ResolveProjectEndpoint, but NOT
		// namespace-visible.
		{Project: "org-roster", Component: "org-roster-todo-api", Workload: "org-roster-todo-api-workload",
			Name: "http", Type: "HTTP", Port: 8082, Visibility: nil},
	}
}

func fakeRC(endpoints []openchoreo.WorkloadEndpointInfo) *ocmocks.ResourceClientMock {
	return &ocmocks.ResourceClientMock{
		ListWorkloadEndpointsFunc: func(_ context.Context, _ string) ([]openchoreo.WorkloadEndpointInfo, error) {
			return endpoints, nil
		},
	}
}

func TestCatalog_List(t *testing.T) {
	t.Parallel()
	cat := NewCatalog(fakeRC(sampleEndpoints()))

	got, err := cat.List(context.Background(), "ns")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("want 3 endpoints, got %d: %+v", len(got), got)
	}
}

func TestCatalog_List_PropagatesError(t *testing.T) {
	t.Parallel()
	wantErr := errors.New("boom")
	rc := &ocmocks.ResourceClientMock{
		ListWorkloadEndpointsFunc: func(_ context.Context, _ string) ([]openchoreo.WorkloadEndpointInfo, error) {
			return nil, wantErr
		},
	}
	cat := NewCatalog(rc)

	if _, err := cat.List(context.Background(), "ns"); !errors.Is(err, wantErr) {
		t.Fatalf("want wrapped %v, got %v", wantErr, err)
	}
}

func TestCatalog_NilSafety(t *testing.T) {
	t.Parallel()

	var nilCatalog *Catalog
	got, err := nilCatalog.List(context.Background(), "ns")
	if got != nil || err != nil {
		t.Fatalf("nil receiver: want (nil, nil), got (%v, %v)", got, err)
	}

	unwired := NewCatalog(nil)
	got, err = unwired.List(context.Background(), "ns")
	if got != nil || err != nil {
		t.Fatalf("nil client: want (nil, nil), got (%v, %v)", got, err)
	}
}

func TestCatalog_ResolveProjectEndpoint(t *testing.T) {
	t.Parallel()
	cat := NewCatalog(fakeRC(sampleEndpoints()))

	// A project-only sibling (NOT namespace-visible) resolves by project+component.
	got, ok, err := cat.ResolveProjectEndpoint(context.Background(), "ns", "org-roster", "org-roster-todo-api")
	if err != nil || !ok {
		t.Fatalf("org-roster-todo-api: want resolved, got ok=%v err=%v", ok, err)
	}
	if got.Name != "http" || got.Component != "org-roster-todo-api" {
		t.Fatalf("resolved wrong target: %+v", got)
	}
	// Sanity: this endpoint is project-only — it must NOT be namespace-visible.
	if got.NamespaceVisible() {
		t.Fatalf("expected project-only endpoint, got namespace-visible: %+v", got)
	}

	// Unknown component must not resolve.
	if _, ok, _ := cat.ResolveProjectEndpoint(context.Background(), "ns", "org-roster", "org-roster-nope"); ok {
		t.Fatalf("unknown component must not resolve")
	}
}

func TestCatalog_ResolveNamespaceVisible(t *testing.T) {
	t.Parallel()
	cat := NewCatalog(fakeRC(sampleEndpoints()))

	got, ok, err := cat.ResolveNamespaceVisible(context.Background(), "ns", "employee-api")
	if err != nil || !ok {
		t.Fatalf("employee-api: want resolved, got ok=%v err=%v", ok, err)
	}
	if got.Project != "hr" || got.Name != "http" {
		t.Fatalf("resolved wrong target: %+v", got)
	}

	// project-only target must not resolve as an org-service.
	if _, ok, _ := cat.ResolveNamespaceVisible(context.Background(), "ns", "payroll-internal"); ok {
		t.Fatalf("payroll-internal is project-only — must not resolve")
	}
	// unknown name.
	if _, ok, _ := cat.ResolveNamespaceVisible(context.Background(), "ns", "nope"); ok {
		t.Fatalf("unknown org-service must not resolve")
	}
}

func TestCatalog_IsNamespaceVisible(t *testing.T) {
	t.Parallel()
	cat := NewCatalog(fakeRC(sampleEndpoints()))

	ok, err := cat.IsNamespaceVisible(context.Background(), "ns", "employee-api")
	if err != nil || !ok {
		t.Fatalf("employee-api: want visible, got ok=%v err=%v", ok, err)
	}
	ok, err = cat.IsNamespaceVisible(context.Background(), "ns", "payroll-internal")
	if err != nil || ok {
		t.Fatalf("payroll-internal: want not visible, got ok=%v err=%v", ok, err)
	}
}

func TestCatalog_ExistsAnyVisibility(t *testing.T) {
	t.Parallel()
	cat := NewCatalog(fakeRC(sampleEndpoints()))

	// A project-only component (NOT namespace-visible) still exists in the
	// catalog → ExistsAnyVisibility true (the blocked/access-required case).
	got, err := cat.ExistsAnyVisibility(context.Background(), "ns", "org-roster-todo-api")
	if err != nil {
		t.Fatalf("org-roster-todo-api: unexpected error: %v", err)
	}
	if !got {
		t.Fatalf("org-roster-todo-api: want exists=true (project-only but present)")
	}

	// An unknown component does not exist at any visibility → the not-found case.
	got, err = cat.ExistsAnyVisibility(context.Background(), "ns", "nope")
	if err != nil {
		t.Fatalf("nope: unexpected error: %v", err)
	}
	if got {
		t.Fatalf("nope: want exists=false")
	}
}

func TestCatalog_FindByComponent(t *testing.T) {
	t.Parallel()
	cat := NewCatalog(fakeRC(sampleEndpoints()))

	// A project-only component (NOT namespace-visible) is still found — the
	// provider lookup resolves the row regardless of visibility.
	got, ok, err := cat.FindByComponent(context.Background(), "ns", "payroll-internal")
	if err != nil || !ok {
		t.Fatalf("payroll-internal: want found, got ok=%v err=%v", ok, err)
	}
	if got.Project != "hr" || got.Name != "http" || got.Type != "HTTP" {
		t.Fatalf("resolved wrong row: %+v", got)
	}

	// An org-published component is also found.
	if _, ok, _ := cat.FindByComponent(context.Background(), "ns", "employee-api"); !ok {
		t.Fatalf("employee-api: want found")
	}

	// Unknown component must not resolve (the not-found case).
	if _, ok, _ := cat.FindByComponent(context.Background(), "ns", "nope"); ok {
		t.Fatalf("unknown component must not resolve")
	}
}

func TestOrgServiceURLEnv(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"employee-api": "EMPLOYEE_API_URL",
		"todo":         "TODO_URL",
		"order-svc-2":  "ORDER_SVC_2_URL",
	}
	for in, want := range cases {
		if got := OrgServiceURLEnv(in); got != want {
			t.Errorf("OrgServiceURLEnv(%q) = %q, want %q", in, got, want)
		}
	}
}
