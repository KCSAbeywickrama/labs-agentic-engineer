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

// Package codingagent — consumer-wiring renderer unit tests.
//
// resolveConsumerDependenciesYAML renders the four consumer-dependency kinds
// into the `workload.yaml` `dependencies:` block: cross-project org-service
// endpoints, same-project component endpoints, external-resource outputs, and
// platform-resource outputs. Pure rendering driven by fakes — no OC client, no
// DB.
package codingagent

import (
	"context"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts/artifactstest"
	"github.com/wso2/aep/aep-api/models"
)

// --- fakes -------------------------------------------------------------------

// fakeBindingReader returns a hard-coded binding for a known name, nil otherwise.
func fakeBindingReader(bindings map[string]*openchoreo.ResourceReleaseBinding) BindingReader {
	return func(_ context.Context, _, name string) (*openchoreo.ResourceReleaseBinding, error) {
		return bindings[name], nil
	}
}

// bindingWithOutputs builds a ready ResourceReleaseBinding with the given output names.
func bindingWithOutputs(names ...string) *openchoreo.ResourceReleaseBinding {
	outputs := make([]openchoreo.ResolvedOutput, 0, len(names))
	for _, n := range names {
		outputs = append(outputs, openchoreo.ResolvedOutput{Name: n})
	}
	return &openchoreo.ResourceReleaseBinding{
		Status: &openchoreo.ResourceReleaseBindingStatus{Outputs: outputs},
	}
}

// fakeOrgServiceResolver resolves org-service names + same-project ocComponents
// from static maps. Missing keys return ok=false (not yet published).
type fakeOrgServiceResolver struct {
	nsVisible map[string]openchoreo.WorkloadEndpointInfo // by org-service name
	project   map[string]openchoreo.WorkloadEndpointInfo // by ocComponent
}

func (f *fakeOrgServiceResolver) ResolveNamespaceVisible(_ context.Context, _, name string) (openchoreo.WorkloadEndpointInfo, bool, error) {
	v, ok := f.nsVisible[name]
	return v, ok, nil
}

func (f *fakeOrgServiceResolver) ResolveProjectEndpoint(_ context.Context, _, _, ocComponent string) (openchoreo.WorkloadEndpointInfo, bool, error) {
	v, ok := f.project[ocComponent]
	return v, ok, nil
}

// designStoreWith builds an ArtifactStore backed by a fake returning a design
// tree with the single supplied component.
func designStoreWith(t *testing.T, comp models.DesignComponent) *artifacts.ArtifactStore {
	t.Helper()
	files, err := artifacts.SplitDesign(&artifacts.DesignFile{
		Overview:   "# Design\n",
		Components: []models.DesignComponent{comp},
	})
	if err != nil {
		t.Fatalf("SplitDesign: %v", err)
	}
	files[artifacts.DesignRootFile] = "# Design\n"
	fake := &artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(_ context.Context, _, _ string) (map[string]string, error) {
			out := make(map[string]string, len(files))
			for k, v := range files {
				out[k] = v
			}
			return out, nil
		},
	}
	return artifacts.NewArtifactStore(fake)
}

// --- platform-resource -------------------------------------------------------

func TestResolveConsumerDeps_PlatformResource(t *testing.T) {
	const project, dep = "todo", "db"
	reader := fakeBindingReader(map[string]*openchoreo.ResourceReleaseBinding{
		project + "-" + dep + "-development": bindingWithOutputs("host", "password"),
	})
	svc := &dispatchService{bindingReader: reader} // orgServiceResolver nil → no design read

	task := &models.ComponentTask{
		OrgID: "acme", ProjectID: project, ComponentName: "todo-app",
		DependsOnResources: models.StringSlice{dep},
	}
	got, err := svc.resolveConsumerDependenciesYAML(context.Background(), task)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	mustContain(t, got, "ref: "+project+"-"+dep)
	// <DEP>_<OUTPUT> uppercased convention.
	mustContain(t, got, "host: DB_HOST")
	mustContain(t, got, "password: DB_PASSWORD")
}

func TestResolveConsumerDeps_PlatformResource_SkipsUnprovisioned(t *testing.T) {
	svc := &dispatchService{bindingReader: fakeBindingReader(nil)} // reader returns nil for all
	task := &models.ComponentTask{
		OrgID: "acme", ProjectID: "todo", ComponentName: "todo-app",
		DependsOnResources: models.StringSlice{"db"},
	}
	got, err := svc.resolveConsumerDependenciesYAML(context.Background(), task)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if got != "" {
		t.Fatalf("unprovisioned dep must render empty, got:\n%s", got)
	}
}

// --- external-resource -------------------------------------------------------

func TestResolveConsumerDeps_ExternalResource(t *testing.T) {
	const project, name = "todo", "weather"
	reader := fakeBindingReader(map[string]*openchoreo.ResourceReleaseBinding{
		project + "-" + name + "-development": bindingWithOutputs("OPENWEATHER_API_KEY"),
	})
	svc := &dispatchService{bindingReader: reader}

	task := &models.ComponentTask{
		OrgID: "acme", ProjectID: project, ComponentName: "todo-app",
		DependsOnExternalResources: models.StringSlice{name},
	}
	got, err := svc.resolveConsumerDependenciesYAML(context.Background(), task)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	mustContain(t, got, "ref: "+project+"-"+name)
	// External-resource outputs are pre-namespaced by the schema → verbatim env var.
	mustContain(t, got, "OPENWEATHER_API_KEY: OPENWEATHER_API_KEY")
}

// --- org-service + same-project component endpoints --------------------------

func TestResolveConsumerDeps_OrgServiceAndComponentEndpoints(t *testing.T) {
	const org, project = "acme", "todo"
	comp := models.DesignComponent{
		Name:                       "consumer",
		ComponentType:              "service",
		Language:                   "Go",
		AppPath:                    "consumer",
		ComponentAgentInstructions: "serve consumer",
		Dependencies: []models.Dependency{
			{Kind: models.DependencyKindOrgService, Name: "billing"},
			{Kind: models.DependencyKindOrgService, Name: "notyet"}, // not published → skipped
			{Kind: models.DependencyKindComponent, Name: "cart"},
		},
	}
	resolver := &fakeOrgServiceResolver{
		nsVisible: map[string]openchoreo.WorkloadEndpointInfo{
			"billing": {Project: "billing-proj", Component: "billing-proj-billing", Name: "http-api"},
		},
		project: map[string]openchoreo.WorkloadEndpointInfo{
			project + "-cart": {Project: project, Component: project + "-cart", Name: "cart-api"},
		},
	}
	svc := &dispatchService{store: designStoreWith(t, comp), orgServiceResolver: resolver}

	task := &models.ComponentTask{OrgID: org, ProjectID: project, ComponentName: "consumer"}
	got, err := svc.resolveConsumerDependenciesYAML(context.Background(), task)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}

	// org-service (namespace visibility) — carries the provider project.
	mustContain(t, got, "component: billing-proj-billing")
	mustContain(t, got, "visibility: namespace")
	mustContain(t, got, "project: billing-proj")
	mustContain(t, got, "address: BILLING_URL")
	// same-project component (project visibility) — no project key, logical env name.
	mustContain(t, got, "component: "+project+"-cart")
	mustContain(t, got, "visibility: project")
	mustContain(t, got, "address: CART_URL")
	// not-yet-published org-service must be skipped silently.
	if strings.Contains(got, "notyet") || strings.Contains(got, "NOTYET_URL") {
		t.Fatalf("unpublished org-service must be skipped, got:\n%s", got)
	}
}

func mustContain(t *testing.T, haystack, needle string) {
	t.Helper()
	if !strings.Contains(haystack, needle) {
		t.Fatalf("rendered YAML missing %q:\n%s", needle, haystack)
	}
}
