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

package artifacts

import (
	"context"
	"errors"
	"testing"

	"github.com/wso2/aep/aep-api/models"
)

// fakeExternalResourceResolver is a static ExternalResourceResolver: `hits`
// names a registered external resource (Get returns it), anything else is
// absent (Get returns (nil, nil)). `errs` forces a lookup error for a
// specific name.
type fakeExternalResourceResolver struct {
	hits map[string]*models.ExternalResource
	errs map[string]error
}

func (f fakeExternalResourceResolver) Get(_ context.Context, _, name string) (*models.ExternalResource, error) {
	if err, ok := f.errs[name]; ok {
		return nil, err
	}
	return f.hits[name], nil
}

// TestResolveExternalDependencies_RegistryHit_Resolves asserts rule 2: a name
// registered in the org's external-resource registry resolves, even with no
// style at all (registry reuse wins ahead of every stored-intent rule).
func TestResolveExternalDependencies_RegistryHit_Resolves(t *testing.T) {
	store := &ArtifactStore{}
	store.SetExternalResourceResolver(fakeExternalResourceResolver{
		hits: map[string]*models.ExternalResource{"stripe": {Name: "stripe"}},
	})

	d := &DesignFile{Components: []models.DesignComponent{{
		Name: "checkout",
		Dependencies: []models.Dependency{
			{Kind: models.DependencyKindExternal, Name: "stripe"},
		},
	}}}

	store.resolveExternalDependencies(context.Background(), "org", d)

	dep := d.Components[0].Dependencies[0]
	if dep.Status != models.DependencyStatusResolved || dep.Reason != "" {
		t.Errorf("registry hit: status/reason = %q/%q, want %q/empty", dep.Status, dep.Reason, models.DependencyStatusResolved)
	}
}

// TestResolveExternalDependencies_NoResolverWired_StillAppliesStoredRules
// asserts rules 3-6 need no resolver at all: with NO ExternalResourceResolver
// wired, an external dependency still resolves purely from its own stored
// intent fields (style/specPath/package) — only rule 2 (registry reuse) is
// unavailable.
func TestResolveExternalDependencies_NoResolverWired_StillAppliesStoredRules(t *testing.T) {
	store := &ArtifactStore{}

	d := &DesignFile{Components: []models.DesignComponent{{
		Name: "checkout",
		Dependencies: []models.Dependency{
			{Kind: models.DependencyKindExternal, Name: "no-style"},
			{Kind: models.DependencyKindExternal, Name: "sdk-ready", Style: models.DependencyStyleSDK, Package: "npm:stripe@^14"},
			{Kind: models.DependencyKindExternal, Name: "rest-no-spec", Style: models.DependencyStyleRestAPI},
		},
	}}}

	store.resolveExternalDependencies(context.Background(), "org", d)

	deps := d.Components[0].Dependencies
	if deps[0].Status != models.DependencyStatusUnresolved || deps[0].Reason != models.DependencyReasonNeedsInput {
		t.Errorf("no-style: status/reason = %q/%q, want %q/%q", deps[0].Status, deps[0].Reason,
			models.DependencyStatusUnresolved, models.DependencyReasonNeedsInput)
	}
	if deps[1].Status != models.DependencyStatusResolved {
		t.Errorf("sdk-ready: status = %q, want %q", deps[1].Status, models.DependencyStatusResolved)
	}
	if deps[2].Status != models.DependencyStatusUnresolved || deps[2].Reason != models.DependencyReasonNeedsSpec {
		t.Errorf("rest-no-spec: status/reason = %q/%q, want %q/%q", deps[2].Status, deps[2].Reason,
			models.DependencyStatusUnresolved, models.DependencyReasonNeedsSpec)
	}
}

// TestResolveExternalDependencies_RegistryError_LeavesUntouched asserts the
// registry lookup is fail-open, mirroring resolveOrgServices'
// IsNamespaceVisible fail-open: a lookup error leaves the dependency's
// Status/Reason completely untouched rather than falling through to the
// stored-intent rules with registryHit=false.
func TestResolveExternalDependencies_RegistryError_LeavesUntouched(t *testing.T) {
	store := &ArtifactStore{}
	store.SetExternalResourceResolver(fakeExternalResourceResolver{
		errs: map[string]error{"stripe": errors.New("transient DB error")},
	})

	d := &DesignFile{Components: []models.DesignComponent{{
		Name: "checkout",
		Dependencies: []models.Dependency{
			{Kind: models.DependencyKindExternal, Name: "stripe"},
		},
	}}}

	store.resolveExternalDependencies(context.Background(), "org", d)

	dep := d.Components[0].Dependencies[0]
	if dep.Status != "" || dep.Reason != "" {
		t.Errorf("registry lookup error: status/reason = %q/%q, want untouched (empty)", dep.Status, dep.Reason)
	}
}

// TestResolveExternalDependencies_ComponentAndPlatformResourceAlwaysResolved
// asserts the two kinds this layer never blocks on: they resolve regardless
// of the registry resolver being wired.
func TestResolveExternalDependencies_ComponentAndPlatformResourceAlwaysResolved(t *testing.T) {
	store := &ArtifactStore{}

	d := &DesignFile{Components: []models.DesignComponent{{
		Name: "checkout",
		Dependencies: []models.Dependency{
			{Kind: models.DependencyKindComponent, Name: "cart"},
			{Kind: models.DependencyKindPlatformResource, Name: "orders-db", ResourceType: "postgres-cnpg"},
		},
	}}}

	store.resolveExternalDependencies(context.Background(), "org", d)

	for _, dep := range d.Components[0].Dependencies {
		if dep.Status != models.DependencyStatusResolved || dep.Reason != "" {
			t.Errorf("%s: status/reason = %q/%q, want %q/empty", dep.Name, dep.Status, dep.Reason, models.DependencyStatusResolved)
		}
	}
}

// TestResolveExternalDependencies_OrgServiceUntouched asserts org-service
// dependencies are left completely alone here — resolveOrgServices owns them.
func TestResolveExternalDependencies_OrgServiceUntouched(t *testing.T) {
	store := &ArtifactStore{}
	store.SetExternalResourceResolver(fakeExternalResourceResolver{})

	d := &DesignFile{Components: []models.DesignComponent{{
		Name: "checkout",
		Dependencies: []models.Dependency{
			{Kind: models.DependencyKindOrgService, Name: "billing"},
		},
	}}}

	store.resolveExternalDependencies(context.Background(), "org", d)

	dep := d.Components[0].Dependencies[0]
	if dep.Status != "" || dep.Reason != "" {
		t.Errorf("org-service: status/reason = %q/%q, want untouched (empty) — resolveOrgServices owns this kind", dep.Status, dep.Reason)
	}
}

// TestAssembleDesignFrom_ResolvesBothOrgServiceAndExternal is the read-path
// wiring test: a single design mixing an `org-service` and an `external`
// dependency gets BOTH resolved by one AssembleDesignFrom call.
func TestAssembleDesignFrom_ResolvesBothOrgServiceAndExternal(t *testing.T) {
	store := &ArtifactStore{}
	store.SetOrgServiceResolver(fakeOrgServiceResolver{visible: map[string]bool{"billing": true}})
	store.SetExternalResourceResolver(fakeExternalResourceResolver{
		hits: map[string]*models.ExternalResource{"stripe": {Name: "stripe"}},
	})

	files := map[string]string{
		DesignRootFile: "Overview.\n",
		"components/checkout/design.json": `{
  "name": "checkout",
  "type": "service",
  "dependencies": [
    {"kind": "org-service", "name": "billing"},
    {"kind": "external", "name": "stripe"}
  ]
}
`,
	}

	design, err := store.AssembleDesignFrom(context.Background(), "org", files)
	if err != nil {
		t.Fatalf("AssembleDesignFrom: %v", err)
	}
	deps := design.Components[0].Dependencies
	if deps[0].Status != models.DependencyStatusResolved {
		t.Errorf("org-service: status = %q, want %q", deps[0].Status, models.DependencyStatusResolved)
	}
	if deps[1].Status != models.DependencyStatusResolved {
		t.Errorf("external (registry hit): status = %q, want %q", deps[1].Status, models.DependencyStatusResolved)
	}
}
