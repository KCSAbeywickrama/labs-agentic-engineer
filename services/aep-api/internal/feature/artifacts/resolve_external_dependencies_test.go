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
	"testing"

	"github.com/wso2/aep/aep-api/models"
)

// TestResolveExternalDependencies_AppliesStoredRules asserts the `external`
// precedence rules resolve purely from the dependency's own stored intent
// fields (style/specPath/package) — the registry-reuse hit (rule 2) was
// retired with the external_resources table (D6), so registryHit is always
// false and every rule derives from stored intent alone.
func TestResolveExternalDependencies_AppliesStoredRules(t *testing.T) {
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

// TestResolveExternalDependencies_ComponentAndPlatformResourceAlwaysResolved
// asserts the two kinds this layer never blocks on: they always resolve.
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
// dependency gets BOTH resolved by one AssembleDesignFrom call. The external
// dependency resolves off its stored intent (an SDK-style dep with a package),
// since the registry-reuse lookup was retired (D6).
func TestAssembleDesignFrom_ResolvesBothOrgServiceAndExternal(t *testing.T) {
	store := &ArtifactStore{}
	store.SetOrgServiceResolver(fakeOrgServiceResolver{visible: map[string]bool{"billing": true}})

	files := map[string]string{
		DesignRootFile: "Overview.\n",
		"components/checkout/design.json": `{
  "name": "checkout",
  "type": "service",
  "dependencies": [
    {"kind": "org-service", "name": "billing"},
    {"kind": "external", "name": "stripe", "style": "sdk", "package": "npm:stripe@^14"}
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
		t.Errorf("external (sdk stored intent): status = %q, want %q", deps[1].Status, models.DependencyStatusResolved)
	}
}
