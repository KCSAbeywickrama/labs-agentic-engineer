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

// COMPONENT tier (bff-component-testing.md §4): the REAL dependencies/resources
// services behind the REAL production handler chain — global middleware →
// faked auth at the jwt.WithClaims seam → Huma parsing/validation → the tenant
// gate in ENFORCE → the handlers' sentinel→status mapping — driven in-process
// via the componenttest harness. The out-of-process seams are faked at the
// interface: the OC ResourceClient (ocmocks), the org registry port, the
// design-reader port and the task store/completer ports.
//
// External test package: the harness imports api, which imports resources — an
// in-package test file would be an import cycle.
package resources_test

import (
	"context"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/api"
	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
	"github.com/wso2/aep/aep-api/internal/contracts"
	"github.com/wso2/aep/aep-api/internal/feature/dependencies/resources"
	"github.com/wso2/aep/aep-api/internal/platform/componenttest"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// ---- fakes at the package's consumer-side ports -------------------------------

type stubRegistry struct {
	rows      []models.ExternalResource
	consumers map[string][]repositories.ExternalResourceConsumer
	deleteErr error
	deleted   []string
}

func (s *stubRegistry) List(_ context.Context, _ string) ([]models.ExternalResource, error) {
	return s.rows, nil
}

func (s *stubRegistry) Consumers(_ context.Context, _, name string) ([]repositories.ExternalResourceConsumer, error) {
	return s.consumers[name], nil
}

func (s *stubRegistry) Delete(_ context.Context, _, name string) error {
	if s.deleteErr != nil {
		return s.deleteErr
	}
	s.deleted = append(s.deleted, name)
	return nil
}

type stubLookup struct{ er *models.ExternalResource }

func (s *stubLookup) Get(_ context.Context, _, name string) (*models.ExternalResource, error) {
	if s.er != nil && s.er.Name == name {
		return s.er, nil
	}
	return nil, nil
}

type stubDesignReader struct{ comps []models.DesignComponent }

func (s *stubDesignReader) ReadDesignComponents(_ context.Context, _, _ string) ([]models.DesignComponent, error) {
	return s.comps, nil
}

type stubTaskStore struct{ tasks []models.ComponentTask }

func (s *stubTaskStore) ListByProjectID(_ context.Context, _, _ string) ([]models.ComponentTask, error) {
	return s.tasks, nil
}

type stubCompleter struct {
	taskID string
	event  contracts.TaskEvent
	calls  int
}

func (s *stubCompleter) ApplyBuildResult(_ context.Context, taskID string, event contracts.TaskEvent, _ string) error {
	s.calls++
	s.taskID, s.event = taskID, event
	return nil
}

// happyRC is an OC ResourceClient whose applied Resource immediately reports a
// cut release and whose binding does not exist yet (mid-provision shape).
func happyRC() *ocmocks.ResourceClientMock {
	return &ocmocks.ResourceClientMock{
		EnsureResourceTypeFunc: func(_ context.Context, _ string, rt *openchoreo.ResourceType) (*openchoreo.ResourceType, error) {
			return rt, nil
		},
		ApplyResourceFunc: func(_ context.Context, _ string, r *openchoreo.Resource) (*openchoreo.Resource, error) {
			return r, nil
		},
		GetResourceFunc: func(_ context.Context, _, name string) (*openchoreo.Resource, error) {
			return &openchoreo.Resource{
				Metadata: openchoreo.OCObjectMeta{Name: name},
				Status:   &openchoreo.ResourceStatus{LatestRelease: &openchoreo.ResourceLatestRelease{Name: name + "-r1"}},
			}, nil
		},
		EnsureBindingFunc: func(_ context.Context, _ string, b *openchoreo.ResourceReleaseBinding) (*openchoreo.ResourceReleaseBinding, error) {
			return b, nil
		},
		GetBindingFunc: func(_ context.Context, _, _ string) (*openchoreo.ResourceReleaseBinding, error) {
			return nil, nil // 404 → not yet created (mid-provision)
		},
	}
}

func shopComponents() []models.DesignComponent {
	return []models.DesignComponent{
		{
			Name: "api",
			Dependencies: []models.Dependency{
				{Kind: models.DependencyKindPlatformResource, Name: "db", ResourceType: "postgres-cnpg"},
				{Kind: models.DependencyKindExternal, Name: "openweather"},
			},
		},
	}
}

// newResourcesHarness assembles the real chain around the REAL resources
// services (ValueService + ResourceService over the real provisioners), with
// only the OC client / registry / design / task collaborators faked.
func newResourcesHarness(t *testing.T, registry *stubRegistry, rc openchoreo.ResourceClient, completer *stubCompleter, tasks *stubTaskStore) *componenttest.Harness {
	t.Helper()

	lookup := &stubLookup{er: &models.ExternalResource{
		Name:             "openweather",
		ResourceTypeName: "openweather",
		ConfigKeys:       []models.ConfigKey{{Key: "OPENWEATHER_BASE_URL", Secret: false}},
	}}
	values := resources.NewValueService(lookup,
		resources.NewExternalResourceProvisioner(lookup, rc, nil), tasks, completer, nil)
	svc := resources.NewResourceService(&stubDesignReader{comps: shopComponents()},
		resources.NewOCNativeProvisioner(rc), tasks, completer)

	return componenttest.New(t, componenttest.Options{Deps: api.HumaDeps{
		ExternalResourceRegistry: registry,
		ExternalResourceValues:   values,
		ResourceSvc:              svc,
		ResourceClient:           rc,
	}})
}

// ---- list + delete -------------------------------------------------------------

func TestResourcesComponent_ListExternalResources(t *testing.T) {
	t.Parallel()

	registry := &stubRegistry{
		rows: []models.ExternalResource{{
			Name:        "openweather",
			Description: "weather data",
			ConfigKeys:  []models.ConfigKey{{Key: "OPENWEATHER_API_KEY", Secret: true}},
		}},
		consumers: map[string][]repositories.ExternalResourceConsumer{
			"openweather": {{ProjectID: "shop", ComponentName: "api"}},
		},
	}
	h := newResourcesHarness(t, registry, happyRC(), &stubCompleter{}, &stubTaskStore{})

	resp := h.AsOrg("acme").Get("/api/v1/dependencies/external-resources")
	if resp.Code != 200 {
		t.Fatalf("list: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	body := resp.Body.String()
	for _, want := range []string{`"name":"openweather"`, `"key":"OPENWEATHER_API_KEY"`, `"secret":true`, `"projectId":"shop"`, `"componentName":"api"`} {
		if !strings.Contains(body, want) {
			t.Errorf("list body missing %s: %s", want, body)
		}
	}
}

func TestResourcesComponent_DeleteExternalResource(t *testing.T) {
	t.Parallel()

	t.Run("in use is 409 naming the consumers", func(t *testing.T) {
		t.Parallel()
		registry := &stubRegistry{consumers: map[string][]repositories.ExternalResourceConsumer{
			"openweather": {{ProjectID: "shop", ComponentName: "api"}, {ProjectID: "crm", ComponentName: "web"}},
		}}
		h := newResourcesHarness(t, registry, happyRC(), &stubCompleter{}, &stubTaskStore{})

		resp := h.AsOrg("acme").Delete("/api/v1/dependencies/external-resources/openweather")
		if resp.Code != 409 {
			t.Fatalf("want 409, got %d body=%s", resp.Code, resp.Body.String())
		}
		p := componenttest.DecodeProblem(t, resp.Body.String())
		for _, want := range []string{"in use", "shop/api", "crm/web"} {
			if !strings.Contains(p.Detail, want) {
				t.Errorf("409 detail missing %q: %q", want, p.Detail)
			}
		}
		if len(registry.deleted) != 0 {
			t.Error("an in-use resource must not be deleted")
		}
	})

	t.Run("unknown resource is 404", func(t *testing.T) {
		t.Parallel()
		registry := &stubRegistry{deleteErr: repositories.ErrExternalResourceNotFound}
		h := newResourcesHarness(t, registry, happyRC(), &stubCompleter{}, &stubTaskStore{})

		resp := h.AsOrg("acme").Delete("/api/v1/dependencies/external-resources/ghost")
		if resp.Code != 404 {
			t.Fatalf("want 404, got %d body=%s", resp.Code, resp.Body.String())
		}
	})

	t.Run("unused resource deletes with 204", func(t *testing.T) {
		t.Parallel()
		registry := &stubRegistry{}
		h := newResourcesHarness(t, registry, happyRC(), &stubCompleter{}, &stubTaskStore{})

		resp := h.AsOrg("acme").Delete("/api/v1/dependencies/external-resources/openweather")
		if resp.Code != 204 {
			t.Fatalf("want 204, got %d body=%s", resp.Code, resp.Body.String())
		}
		if len(registry.deleted) != 1 || registry.deleted[0] != "openweather" {
			t.Fatalf("registry delete not invoked: %v", registry.deleted)
		}
	})
}

// ---- values ---------------------------------------------------------------------

func TestResourcesComponent_SaveExternalResourceValues(t *testing.T) {
	t.Parallel()

	t.Run("valid values provision and complete the config task", func(t *testing.T) {
		t.Parallel()
		rc := happyRC()
		completer := &stubCompleter{}
		tasks := &stubTaskStore{tasks: []models.ComponentTask{
			{ID: "t-cfg", Type: models.TaskTypeConfigCollection, ExternalResourceName: "openweather", Status: string(models.TaskStatusPending)},
		}}
		h := newResourcesHarness(t, &stubRegistry{}, rc, completer, tasks)

		resp := h.AsOrg("acme").Post("/api/v1/projects/shop/dependencies/external-resources/openweather/values",
			`{"environments":{"development":{"OPENWEATHER_BASE_URL":"https://api.openweathermap.org"}}}`)
		if resp.Code != 200 {
			t.Fatalf("want 200, got %d body=%s", resp.Code, resp.Body.String())
		}
		if !strings.Contains(resp.Body.String(), `"status":"provisioned"`) {
			t.Fatalf("body: %s", resp.Body.String())
		}
		// The REAL provisioner authored the pinned per-env binding…
		bindings := rc.EnsureBindingCalls()
		if len(bindings) != 1 || bindings[0].B.Metadata.Name != "shop-openweather-development" {
			t.Fatalf("binding not authored: %+v", bindings)
		}
		// …and the config-collection task completed through the contracts event.
		if completer.calls != 1 || completer.taskID != "t-cfg" || completer.event != contracts.TaskEventValuesProvisioned {
			t.Fatalf("config task not completed via contracts: calls=%d id=%q event=%q",
				completer.calls, completer.taskID, completer.event)
		}
	})

	t.Run("unregistered resource is 404", func(t *testing.T) {
		t.Parallel()
		h := newResourcesHarness(t, &stubRegistry{}, happyRC(), &stubCompleter{}, &stubTaskStore{})

		resp := h.AsOrg("acme").Post("/api/v1/projects/shop/dependencies/external-resources/ghost/values",
			`{"environments":{"development":{"K":"v"}}}`)
		if resp.Code != 404 {
			t.Fatalf("want 404, got %d body=%s", resp.Code, resp.Body.String())
		}
	})

	t.Run("missing environments body is 422", func(t *testing.T) {
		t.Parallel()
		h := newResourcesHarness(t, &stubRegistry{}, happyRC(), &stubCompleter{}, &stubTaskStore{})

		resp := h.AsOrg("acme").Post("/api/v1/projects/shop/dependencies/external-resources/openweather/values", `{}`)
		if resp.Code != 422 {
			t.Fatalf("want 422, got %d body=%s", resp.Code, resp.Body.String())
		}
	})
}

// ---- provision ------------------------------------------------------------------

func TestResourcesComponent_ProvisionDependency(t *testing.T) {
	t.Parallel()

	t.Run("platform-resource dep provisions with 202", func(t *testing.T) {
		t.Parallel()
		rc := happyRC()
		completer := &stubCompleter{}
		tasks := &stubTaskStore{tasks: []models.ComponentTask{
			{ID: "t-prov", Type: models.TaskTypeResourceProvisioning, ResourceName: "db", Status: string(models.TaskStatusPending)},
		}}
		h := newResourcesHarness(t, &stubRegistry{}, rc, completer, tasks)

		resp := h.AsOrg("acme").Post("/api/v1/projects/shop/components/api/dependencies/db/provision",
			`{"params":{"version":"16"},"environments":["development"]}`)
		if resp.Code != 202 {
			t.Fatalf("want 202, got %d body=%s", resp.Code, resp.Body.String())
		}
		if !strings.Contains(resp.Body.String(), `"status":"provisioning"`) {
			t.Fatalf("body: %s", resp.Body.String())
		}
		// The REAL OC-native provisioner referenced the DISCOVERED
		// ClusterResourceType — it never authored the type.
		if len(rc.EnsureResourceTypeCalls()) != 0 {
			t.Fatal("platform provisioning must never call EnsureResourceType")
		}
		applied := rc.ApplyResourceCalls()
		if len(applied) != 1 || applied[0].R.Spec.Type.Name != "postgres-cnpg" || applied[0].R.Spec.Type.Kind != "ClusterResourceType" {
			t.Fatalf("resource not authored against the discovered type: %+v", applied)
		}
		// Task moved through the contracts pending→building transition.
		if completer.calls != 1 || completer.taskID != "t-prov" || completer.event != contracts.TaskEventProvisionStarted {
			t.Fatalf("provision task not marked via contracts: calls=%d id=%q event=%q",
				completer.calls, completer.taskID, completer.event)
		}
	})

	t.Run("wrong-kind dep is 400 naming both kinds", func(t *testing.T) {
		t.Parallel()
		h := newResourcesHarness(t, &stubRegistry{}, happyRC(), &stubCompleter{}, &stubTaskStore{})

		resp := h.AsOrg("acme").Post("/api/v1/projects/shop/components/api/dependencies/openweather/provision",
			`{"environments":["development"]}`)
		if resp.Code != 400 {
			t.Fatalf("want 400, got %d body=%s", resp.Code, resp.Body.String())
		}
		p := componenttest.DecodeProblem(t, resp.Body.String())
		for _, want := range []string{models.DependencyKindExternal, models.DependencyKindPlatformResource} {
			if !strings.Contains(p.Detail, want) {
				t.Errorf("400 detail must name kind %q: %q", want, p.Detail)
			}
		}
	})

	t.Run("unknown dep is 404", func(t *testing.T) {
		t.Parallel()
		h := newResourcesHarness(t, &stubRegistry{}, happyRC(), &stubCompleter{}, &stubTaskStore{})

		resp := h.AsOrg("acme").Post("/api/v1/projects/shop/components/api/dependencies/ghost/provision",
			`{"environments":["development"]}`)
		if resp.Code != 404 {
			t.Fatalf("want 404, got %d body=%s", resp.Code, resp.Body.String())
		}
	})
}

// ---- status ---------------------------------------------------------------------

func TestResourcesComponent_DependencyStatus(t *testing.T) {
	t.Parallel()

	t.Run("mid-provision (no binding yet) is 200 with the task status", func(t *testing.T) {
		t.Parallel()
		tasks := &stubTaskStore{tasks: []models.ComponentTask{
			{Type: models.TaskTypeResourceProvisioning, ResourceName: "db", Status: string(models.TaskStatusBuilding)},
		}}
		h := newResourcesHarness(t, &stubRegistry{}, happyRC(), &stubCompleter{}, tasks)

		resp := h.AsOrg("acme").Get("/api/v1/projects/shop/components/api/dependencies/db/status")
		if resp.Code != 200 {
			t.Fatalf("want 200 mid-provision, got %d body=%s", resp.Code, resp.Body.String())
		}
		body := resp.Body.String()
		if !strings.Contains(body, `"ready":false`) || !strings.Contains(body, `"status":"building"`) {
			t.Fatalf("mid-provision body drifted: %s", body)
		}
	})

	t.Run("no task row falls back to pending", func(t *testing.T) {
		t.Parallel()
		h := newResourcesHarness(t, &stubRegistry{}, happyRC(), &stubCompleter{}, &stubTaskStore{})

		resp := h.AsOrg("acme").Get("/api/v1/projects/shop/components/api/dependencies/db/status")
		if resp.Code != 200 {
			t.Fatalf("want 200, got %d body=%s", resp.Code, resp.Body.String())
		}
		if !strings.Contains(resp.Body.String(), `"status":"pending"`) {
			t.Fatalf("want pending fallback: %s", resp.Body.String())
		}
	})

	t.Run("ready binding reports output NAMES only — values masked", func(t *testing.T) {
		t.Parallel()
		rc := happyRC()
		rc.GetBindingFunc = func(_ context.Context, _, name string) (*openchoreo.ResourceReleaseBinding, error) {
			return &openchoreo.ResourceReleaseBinding{
				Metadata: openchoreo.OCObjectMeta{Name: name},
				Status: &openchoreo.ResourceReleaseBindingStatus{
					Conditions: []openchoreo.OCCondition{{Type: "Ready", Status: "True"}},
					Outputs: []openchoreo.ResolvedOutput{
						{Name: "host", Value: "topsecret-host"},
						{Name: "password", SecretKeyRef: &openchoreo.OCKeyRef{Name: "db-cred-9f3", Key: "password"}},
					},
				},
			}, nil
		}
		tasks := &stubTaskStore{tasks: []models.ComponentTask{
			{Type: models.TaskTypeResourceProvisioning, ResourceName: "db", Status: string(models.TaskStatusDeployed)},
		}}
		h := newResourcesHarness(t, &stubRegistry{}, rc, &stubCompleter{}, tasks)

		resp := h.AsOrg("acme").Get("/api/v1/projects/shop/components/api/dependencies/db/status")
		if resp.Code != 200 {
			t.Fatalf("want 200, got %d body=%s", resp.Code, resp.Body.String())
		}
		body := resp.Body.String()
		if !strings.Contains(body, `"ready":true`) || !strings.Contains(body, `"name":"host"`) || !strings.Contains(body, `"name":"password"`) {
			t.Fatalf("status body drifted: %s", body)
		}
		for _, leak := range []string{"topsecret-host", "db-cred-9f3"} {
			if strings.Contains(body, leak) {
				t.Fatalf("output values must be masked, leaked %q: %s", leak, body)
			}
		}
	})

	t.Run("kind policy applies: wrong kind 400, unknown 404", func(t *testing.T) {
		t.Parallel()
		h := newResourcesHarness(t, &stubRegistry{}, happyRC(), &stubCompleter{}, &stubTaskStore{})

		if resp := h.AsOrg("acme").Get("/api/v1/projects/shop/components/api/dependencies/openweather/status"); resp.Code != 400 {
			t.Fatalf("wrong-kind status: want 400, got %d body=%s", resp.Code, resp.Body.String())
		}
		if resp := h.AsOrg("acme").Get("/api/v1/projects/shop/components/api/dependencies/ghost/status"); resp.Code != 404 {
			t.Fatalf("unknown-dep status: want 404, got %d body=%s", resp.Code, resp.Body.String())
		}
	})
}

// ---- gate + nil-guard --------------------------------------------------------

func TestResourcesComponent_NoClaimsDeniedByEnforceGate(t *testing.T) {
	t.Parallel()
	h := newResourcesHarness(t, &stubRegistry{}, happyRC(), &stubCompleter{}, &stubTaskStore{})

	resp := h.NoAuth().Get("/api/v1/dependencies/external-resources")
	if resp.Code != 401 {
		t.Fatalf("no-claims: want the gate's ENFORCE 401, got %d body=%s", resp.Code, resp.Body.String())
	}
}

// TestResourcesComponent_NilDeps503 proves registration is pure metadata: with
// zero deps the routes exist and nil-guard to 503 instead of panicking.
func TestResourcesComponent_NilDeps503(t *testing.T) {
	t.Parallel()
	h := componenttest.New(t, componenttest.Options{Deps: api.HumaDeps{}})

	for _, req := range []struct {
		method, path, body string
	}{
		{"GET", "/api/v1/dependencies/external-resources", ""},
		{"DELETE", "/api/v1/dependencies/external-resources/x", ""},
		{"POST", "/api/v1/projects/p/dependencies/external-resources/x/values", `{"environments":{"development":{}}}`},
		{"POST", "/api/v1/projects/p/components/c/dependencies/d/provision", `{"environments":["development"]}`},
		{"GET", "/api/v1/projects/p/components/c/dependencies/d/status", ""},
	} {
		var code int
		switch req.method {
		case "GET":
			code = h.AsOrg("acme").Get(req.path).Code
		case "DELETE":
			code = h.AsOrg("acme").Delete(req.path).Code
		case "POST":
			code = h.AsOrg("acme").Post(req.path, req.body).Code
		}
		if code != 503 {
			t.Errorf("%s %s with nil deps: want 503, got %d", req.method, req.path, code)
		}
	}
}
