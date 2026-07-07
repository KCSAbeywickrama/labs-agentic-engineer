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

// UNIT tier (bff-component-testing.md §2) for the runtime-config emit pipeline.
// runtimeconfig is BACKEND-ONLY: it has no *_huma.go (no HTTP surface — it is
// driven by the codingagent dispatch cascade, not a router route) and no SQL,
// so there is deliberately NO component tier and NO dbtest here — the correct
// exception per ADR-0003 §9, not a coverage gap.
//
// The three out-of-process seams are doubled exactly at the process boundary:
//   - openchoreo.ComponentClient → the generated moq (ListDeployments to read a
//     component's resolved external URL; UpdateComponentWorkflowFiles to emit
//     env-config.js onto the ReleaseBindings — we CAPTURE that payload and
//     assert its window._env_ shape).
//   - openchoreo.ResourceClient → the generated moq (PatchBindingEnvironmentConfigs
//     to declare the SPA's redirect URI; GetBinding to read the thunder-app
//     dependency's resolved OIDC outputs). THUNDER_* is emitted purely from
//     these binding outputs — there is no BFF→Thunder call on this path.
//   - artifacts.ArtifactStore → the REAL artifacts.NewArtifactStore decorator
//     over artifactstest.FakeArtifactService, fed a valid design working-tree
//     map. The frontmatter → models.DesignComponent parse (componentType,
//     dependencies) is therefore the real one, not a stub.
package runtimeconfig

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts/artifactstest"
	"github.com/wso2/aep/aep-api/models"
)

// --- test doubles ------------------------------------------------------------

// storeWith wraps the REAL artifacts.NewArtifactStore decorator over a fake
// artifact service that serves the given design working-tree map. ReadDesign's
// frontmatter parse (AssembleDesign) therefore runs for real.
func storeWith(files map[string]string) *artifacts.ArtifactStore {
	return artifacts.NewArtifactStore(&artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return files, nil
		},
	})
}

// ocResolving builds a ComponentClient moq whose ListDeployments returns the
// mapped external URL for a component (keyed by the k8s component name), or an
// empty deployment list (no URL resolved yet) for any unmapped component.
func ocResolving(urlsByComponent map[string]string) *ocmocks.ComponentClientMock {
	return &ocmocks.ComponentClientMock{
		ListDeploymentsFunc: func(_ context.Context, _, _, componentName string) (*models.DeploymentList, error) {
			if u, ok := urlsByComponent[componentName]; ok && u != "" {
				return &models.DeploymentList{Items: []models.Deployment{{EndpointURL: u}}}, nil
			}
			return &models.DeploymentList{}, nil
		},
	}
}

// thunderRC builds a ResourceClient moq for the thunder-app binding path.
// PatchBindingEnvironmentConfigs returns patchErr (records the call args);
// GetBinding returns a binding whose status.outputs carry the given resolved
// values. A nil `outputs` map yields a binding with NO status (not ready yet).
func thunderRC(outputs map[string]string, patchErr error) *ocmocks.ResourceClientMock {
	return &ocmocks.ResourceClientMock{
		PatchBindingEnvironmentConfigsFunc: func(context.Context, string, string, map[string]string) error {
			return patchErr
		},
		GetBindingFunc: func(_ context.Context, _, _ string) (*openchoreo.ResourceReleaseBinding, error) {
			if outputs == nil {
				return &openchoreo.ResourceReleaseBinding{}, nil // no status → not ready
			}
			outs := make([]openchoreo.ResolvedOutput, 0, len(outputs))
			for k, v := range outputs {
				outs = append(outs, openchoreo.ResolvedOutput{Name: k, Value: v})
			}
			return &openchoreo.ResourceReleaseBinding{
				Status: &openchoreo.ResourceReleaseBindingStatus{Outputs: outs},
			}, nil
		},
	}
}

// thunderOutputs is the full resolved-output set a ready thunder-app binding
// carries. ALL outputs — including client_id — arrive as literal values: the
// ClusterResourceType emits client_id via a `${applied.app.status.clientId}`
// CEL value (OC resolves it from the ThunderApplication's live status), never
// as a ref-shaped output without a value.
func thunderOutputs() map[string]string {
	return map[string]string{
		"client_id": "web-cid",
		"issuer":    "http://thunder.local",
		"jwks_url":  "http://thunder.local/jwks",
		"scopes":    "openid profile email",
	}
}

// readDesign parses a design working-tree map through the real store and
// returns the assembled DesignFile.
func readDesign(t *testing.T, files map[string]string) *artifacts.DesignFile {
	t.Helper()
	d, err := storeWith(files).ReadDesign(context.Background(), "acme", "proj")
	if err != nil {
		t.Fatalf("ReadDesign: %v", err)
	}
	if d == nil {
		t.Fatalf("ReadDesign returned nil design for fixture")
	}
	return d
}

func componentNamed(t *testing.T, d *artifacts.DesignFile, name string) *models.DesignComponent {
	t.Helper()
	for i := range d.Components {
		if d.Components[i].Name == name {
			return &d.Components[i]
		}
	}
	t.Fatalf("component %q not present in assembled design", name)
	return nil
}

// --- design fixtures ---------------------------------------------------------

func rootDesignMd() string {
	return "---\nsourceSpec: v1\n---\n\nOverview prose.\n"
}

func serviceComponentMd() string {
	return buildComponentJSON("api", "service", nil, "")
}

// webappMd renders a web-app component with only component-kind dependencies.
func webappMd(name string, deps ...string) string {
	return buildComponentJSON(name, "web-app", deps, "")
}

// webappWithThunderMd renders a web-app that declares a `thunder-app`
// platform-resource dependency named thunderDep (drives OIDC), plus optional
// component-kind deps.
func webappWithThunderMd(name, thunderDep string, deps ...string) string {
	return buildComponentJSON(name, "web-app", deps, thunderDep)
}

// buildComponentJSON assembles a `components/<name>/design.json` body:
// component-kind dependencies from deps, plus (when thunderDep != "") a
// platform-resource dependency with resourceType "thunder-app".
func buildComponentJSON(name, typ string, deps []string, thunderDep string) string {
	m := map[string]any{"name": name, "type": typ}
	if typ == "service" {
		m["language"] = "Go"
	}
	dependencies := make([]map[string]any, 0, len(deps)+1)
	for _, d := range deps {
		dependencies = append(dependencies, map[string]any{"kind": "component", "name": d})
	}
	if thunderDep != "" {
		dependencies = append(dependencies, map[string]any{
			"kind":         "platform-resource",
			"name":         thunderDep,
			"resourceType": "thunder-app",
		})
	}
	m["dependencies"] = dependencies
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		panic(err)
	}
	return string(b) + "\n"
}

// --- thunderAppDep -----------------------------------------------------------

func Test_thunderAppDep(t *testing.T) {
	t.Parallel()
	thunder := models.Dependency{Kind: models.DependencyKindPlatformResource, Name: "auth", ResourceType: "thunder-app"}
	otherPR := models.Dependency{Kind: models.DependencyKindPlatformResource, Name: "db", ResourceType: "postgres-cnpg"}
	comp := models.Dependency{Kind: models.DependencyKindComponent, Name: "api"}

	cases := []struct {
		name    string
		in      *models.DesignComponent
		wantDep string // "" ⇒ nil
	}{
		{"nil component", nil, ""},
		{"web-app no deps", &models.DesignComponent{ComponentType: "web-app"}, ""},
		{"service with thunder dep is not a web-app", &models.DesignComponent{ComponentType: "service", Dependencies: []models.Dependency{thunder}}, ""},
		{"web-app with only a non-thunder platform-resource", &models.DesignComponent{ComponentType: "web-app", Dependencies: []models.Dependency{otherPR}}, ""},
		{"web-app with only component deps", &models.DesignComponent{ComponentType: "web-app", Dependencies: []models.Dependency{comp}}, ""},
		{"web-app with thunder dep", &models.DesignComponent{ComponentType: "web-app", Dependencies: []models.Dependency{comp, otherPR, thunder}}, "auth"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			got := thunderAppDep(c.in)
			if c.wantDep == "" {
				if got != nil {
					t.Errorf("thunderAppDep = %+v; want nil", got)
				}
				return
			}
			if got == nil || got.Name != c.wantDep {
				t.Errorf("thunderAppDep = %+v; want dep %q", got, c.wantDep)
			}
		})
	}
}

// --- buildEnvValues ----------------------------------------------------------

func Test_buildEnvValues(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	t.Run("resolved service dep, no thunder: ready + sibling URL keys, no THUNDER", func(t *testing.T) {
		t.Parallel()
		files := map[string]string{
			artifacts.DesignRootFile:     rootDesignMd(),
			"components/web/design.json": webappMd("web", "api"),
			"components/api/design.json": serviceComponentMd(),
		}
		design := readDesign(t, files)
		web := componentNamed(t, design, "web")

		oc := ocResolving(map[string]string{"api": "http://api.local/todo/"}) // trailing slash trimmed
		svc := NewRuntimeConfigService(oc, nil, nil)

		out, ready := svc.buildEnvValues(ctx, "acme", "proj", web, design)
		if !ready {
			t.Fatalf("want ready=true when the only service dep resolved; got false (out=%v)", out)
		}
		if out["API_BASE_URL"] != "http://api.local/todo" {
			t.Errorf("API_BASE_URL = %v; want http://api.local/todo (first service dep, trailing slash trimmed)", out["API_BASE_URL"])
		}
		if out["API_URL"] != "http://api.local/todo" {
			t.Errorf("API_URL = %v; want the per-dep keyed URL", out["API_URL"])
		}
		for k := range out {
			if strings.HasPrefix(k, "THUNDER_") {
				t.Errorf("THUNDER_* must not appear without a thunder-app dep; got key %q", k)
			}
		}
	})

	t.Run("web-app without the thunder dep: no THUNDER_*, no patch call", func(t *testing.T) {
		t.Parallel()
		files := map[string]string{
			artifacts.DesignRootFile:     rootDesignMd(),
			"components/web/design.json": webappMd("web", "api"),
			"components/api/design.json": serviceComponentMd(),
		}
		design := readDesign(t, files)
		web := componentNamed(t, design, "web")

		oc := ocResolving(map[string]string{"api": "http://api.local"})
		rc := thunderRC(thunderOutputs(), nil) // wired but must never be touched
		out, ready := NewRuntimeConfigService(oc, rc, nil).buildEnvValues(ctx, "acme", "proj", web, design)
		if !ready {
			t.Fatalf("want ready=true; got false (out=%v)", out)
		}
		for k := range out {
			if strings.HasPrefix(k, "THUNDER_") {
				t.Errorf("THUNDER_* must not appear; got key %q", k)
			}
		}
		if n := len(rc.PatchBindingEnvironmentConfigsCalls()); n != 0 {
			t.Errorf("no binding patch expected without a thunder-app dep; got %d", n)
		}
		if n := len(rc.GetBindingCalls()); n != 0 {
			t.Errorf("no binding read expected without a thunder-app dep; got %d", n)
		}
	})

	t.Run("multiple service deps: API_BASE_URL is the first declared service", func(t *testing.T) {
		t.Parallel()
		files := map[string]string{
			artifacts.DesignRootFile:          rootDesignMd(),
			"components/web/design.json":      webappMd("web", "api", "auth-svc"),
			"components/api/design.json":      serviceComponentMd(),
			"components/auth-svc/design.json": buildComponentJSON("auth-svc", "service", nil, ""),
		}
		design := readDesign(t, files)
		web := componentNamed(t, design, "web")

		oc := ocResolving(map[string]string{
			"api":      "http://api.local",
			"auth-svc": "http://auth.local",
		})
		out, ready := NewRuntimeConfigService(oc, nil, nil).buildEnvValues(ctx, "acme", "proj", web, design)
		if !ready {
			t.Fatalf("want ready=true; got false (out=%v)", out)
		}
		if out["API_BASE_URL"] != "http://api.local" {
			t.Errorf("API_BASE_URL = %v; want the first dependsOn service (api)", out["API_BASE_URL"])
		}
		if out["API_URL"] != "http://api.local" || out["AUTH_SVC_URL"] != "http://auth.local" {
			t.Errorf("per-dep keys drifted: API_URL=%v AUTH_SVC_URL=%v", out["API_URL"], out["AUTH_SVC_URL"])
		}
	})

	t.Run("unresolved service dep gates emission (ready=false)", func(t *testing.T) {
		t.Parallel()
		files := map[string]string{
			artifacts.DesignRootFile:     rootDesignMd(),
			"components/web/design.json": webappMd("web", "api"),
			"components/api/design.json": serviceComponentMd(),
		}
		design := readDesign(t, files)
		web := componentNamed(t, design, "web")

		oc := ocResolving(map[string]string{})
		out, ready := NewRuntimeConfigService(oc, nil, nil).buildEnvValues(ctx, "acme", "proj", web, design)
		if ready {
			t.Fatalf("want ready=false when a required service dep has no resolved URL; got true (out=%v)", out)
		}
		if _, ok := out["API_BASE_URL"]; ok {
			t.Errorf("API_BASE_URL must be absent when the dep is unresolved; out=%v", out)
		}
	})

	t.Run("ListDeployments error on a dep gates emission", func(t *testing.T) {
		t.Parallel()
		files := map[string]string{
			artifacts.DesignRootFile:     rootDesignMd(),
			"components/web/design.json": webappMd("web", "api"),
			"components/api/design.json": serviceComponentMd(),
		}
		design := readDesign(t, files)
		web := componentNamed(t, design, "web")

		oc := &ocmocks.ComponentClientMock{
			ListDeploymentsFunc: func(context.Context, string, string, string) (*models.DeploymentList, error) {
				return nil, errors.New("oc: transient")
			},
		}
		_, ready := NewRuntimeConfigService(oc, nil, nil).buildEnvValues(ctx, "acme", "proj", web, design)
		if ready {
			t.Fatalf("want ready=false on a transient OC error for a required dep; got true")
		}
	})

	t.Run("non-service dep is skipped, not gated", func(t *testing.T) {
		t.Parallel()
		files := map[string]string{
			artifacts.DesignRootFile:      rootDesignMd(),
			"components/web/design.json":  webappMd("web", "peer"),
			"components/peer/design.json": webappMd("peer"),
		}
		design := readDesign(t, files)
		web := componentNamed(t, design, "web")

		oc := &ocmocks.ComponentClientMock{}
		out, ready := NewRuntimeConfigService(oc, nil, nil).buildEnvValues(ctx, "acme", "proj", web, design)
		if !ready {
			t.Fatalf("want ready=true; a non-service dep is skipped, not deferred")
		}
		if len(out) != 0 {
			t.Errorf("want empty env map for a webapp with only a peer-webapp dep; got %v", out)
		}
		if len(oc.ListDeploymentsCalls()) != 0 {
			t.Errorf("ListDeployments must not be called for a non-service dep; got %d calls", len(oc.ListDeploymentsCalls()))
		}
	})

	t.Run("thunder dep + everything resolved: ready with all five THUNDER_* + patch once", func(t *testing.T) {
		t.Parallel()
		files := map[string]string{
			artifacts.DesignRootFile:     rootDesignMd(),
			"components/web/design.json": webappWithThunderMd("web", "auth", "api"),
			"components/api/design.json": serviceComponentMd(),
		}
		design := readDesign(t, files)
		web := componentNamed(t, design, "web")

		oc := ocResolving(map[string]string{
			"api": "http://api.local",
			"web": "http://web.local/",
		})
		rc := thunderRC(thunderOutputs(), nil)
		svc := NewRuntimeConfigService(oc, rc, nil)

		out, ready := svc.buildEnvValues(ctx, "acme", "proj", web, design)
		if !ready {
			t.Fatalf("want ready=true; got false (out=%v)", out)
		}
		want := map[string]interface{}{
			"THUNDER_URL":               "http://thunder.local",
			"THUNDER_CLIENT_ID":         "web-cid",
			"THUNDER_SCOPES":            "openid profile email",
			"THUNDER_REDIRECT_URI":      "http://web.local/callback",
			"THUNDER_AFTER_SIGN_IN_URL": "http://web.local",
		}
		for k, v := range want {
			if out[k] != v {
				t.Errorf("out[%q] = %v; want %v", k, out[k], v)
			}
		}
		calls := rc.PatchBindingEnvironmentConfigsCalls()
		if len(calls) != 1 {
			t.Fatalf("want exactly 1 binding patch; got %d", len(calls))
		}
		if got := calls[0].Configs["redirectUris"]; got != "http://web.local/callback" {
			t.Errorf("patched redirectUris = %q; want http://web.local/callback", got)
		}
		if calls[0].BindingName != "proj-auth-development" {
			t.Errorf("patched binding = %q; want proj-auth-development", calls[0].BindingName)
		}
	})

	t.Run("thunder dep, outputs missing client_id: ready=false, no partial THUNDER_*", func(t *testing.T) {
		t.Parallel()
		files := map[string]string{
			artifacts.DesignRootFile:     rootDesignMd(),
			"components/web/design.json": webappWithThunderMd("web", "auth", "api"),
			"components/api/design.json": serviceComponentMd(),
		}
		design := readDesign(t, files)
		web := componentNamed(t, design, "web")

		oc := ocResolving(map[string]string{"api": "http://api.local", "web": "http://web.local"})
		// issuer/scopes present but client_id missing → not reconciled yet.
		rc := thunderRC(map[string]string{"issuer": "http://thunder.local", "scopes": "openid"}, nil)
		out, ready := NewRuntimeConfigService(oc, rc, nil).buildEnvValues(ctx, "acme", "proj", web, design)
		if ready {
			t.Fatalf("want ready=false when client_id is not yet resolved; got true (out=%v)", out)
		}
		for k := range out {
			if strings.HasPrefix(k, "THUNDER_") {
				t.Errorf("no partial THUNDER_* on defer; got key %q", k)
			}
		}
	})

	t.Run("thunder dep, patch failure: ready=false", func(t *testing.T) {
		t.Parallel()
		files := map[string]string{
			artifacts.DesignRootFile:     rootDesignMd(),
			"components/web/design.json": webappWithThunderMd("web", "auth", "api"),
			"components/api/design.json": serviceComponentMd(),
		}
		design := readDesign(t, files)
		web := componentNamed(t, design, "web")

		oc := ocResolving(map[string]string{"api": "http://api.local", "web": "http://web.local"})
		rc := thunderRC(thunderOutputs(), errors.New("oc: patch failed"))
		out, ready := NewRuntimeConfigService(oc, rc, nil).buildEnvValues(ctx, "acme", "proj", web, design)
		if ready {
			t.Fatalf("want ready=false when the redirect-URI patch fails; got true")
		}
		for k := range out {
			if strings.HasPrefix(k, "THUNDER_") {
				t.Errorf("no THUNDER_* when the patch failed; got key %q", k)
			}
		}
		// Patch failed before the read, so the outputs are never fetched.
		if n := len(rc.GetBindingCalls()); n != 0 {
			t.Errorf("GetBinding must not run after a patch failure; got %d", n)
		}
	})

	t.Run("thunder dep but SPA URL unresolved gates emission (no patch)", func(t *testing.T) {
		t.Parallel()
		files := map[string]string{
			artifacts.DesignRootFile:     rootDesignMd(),
			"components/web/design.json": webappWithThunderMd("web", "auth", "api"),
			"components/api/design.json": serviceComponentMd(),
		}
		design := readDesign(t, files)
		web := componentNamed(t, design, "web")

		// api resolves, but the SPA's own URL (web) does not → defer before any patch.
		oc := ocResolving(map[string]string{"api": "http://api.local"})
		rc := thunderRC(thunderOutputs(), nil)
		_, ready := NewRuntimeConfigService(oc, rc, nil).buildEnvValues(ctx, "acme", "proj", web, design)
		if ready {
			t.Fatalf("want ready=false when the SPA external URL is not yet resolved")
		}
		if n := len(rc.PatchBindingEnvironmentConfigsCalls()); n != 0 {
			t.Errorf("the binding must not be patched before the SPA URL resolves; got %d", n)
		}
	})
}

// --- layerThunderKeys --------------------------------------------------------

func Test_layerThunderKeys(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	webapp := &models.DesignComponent{
		Name:          "web",
		ComponentType: "web-app",
		Dependencies: []models.Dependency{
			{Kind: models.DependencyKindPlatformResource, Name: "auth", ResourceType: "thunder-app"},
		},
	}
	dep := thunderAppDep(webapp)

	t.Run("happy: all five THUNDER_* keys + correct redirect URI", func(t *testing.T) {
		t.Parallel()
		oc := ocResolving(map[string]string{"web": "http://web.local/"})
		rc := thunderRC(thunderOutputs(), nil)
		svc := NewRuntimeConfigService(oc, rc, nil)

		out := map[string]interface{}{}
		if ok := svc.layerThunderKeys(ctx, "acme", "proj", webapp, dep, out); !ok {
			t.Fatalf("layerThunderKeys returned false on the happy path")
		}
		want := map[string]interface{}{
			"THUNDER_URL":               "http://thunder.local",
			"THUNDER_CLIENT_ID":         "web-cid",
			"THUNDER_REDIRECT_URI":      "http://web.local/callback",
			"THUNDER_SCOPES":            "openid profile email",
			"THUNDER_AFTER_SIGN_IN_URL": "http://web.local",
		}
		for k, v := range want {
			if out[k] != v {
				t.Errorf("out[%q] = %v; want %v", k, out[k], v)
			}
		}
		if len(rc.PatchBindingEnvironmentConfigsCalls()) != 1 {
			t.Fatalf("want 1 patch call; got %d", len(rc.PatchBindingEnvironmentConfigsCalls()))
		}
	})

	t.Run("resourceClient not wired → false, no keys", func(t *testing.T) {
		t.Parallel()
		// ListDeployments unset: if it got past the nil guard, the mock panics.
		oc := &ocmocks.ComponentClientMock{}
		svc := NewRuntimeConfigService(oc, nil, nil)

		out := map[string]interface{}{}
		if ok := svc.layerThunderKeys(ctx, "acme", "proj", webapp, dep, out); ok {
			t.Fatalf("want false when resourceClient is nil")
		}
		if len(out) != 0 {
			t.Errorf("no keys expected; got %v", out)
		}
	})

	t.Run("SPA URL not resolved → false, no patch", func(t *testing.T) {
		t.Parallel()
		oc := ocResolving(map[string]string{}) // web → empty list
		rc := thunderRC(thunderOutputs(), nil)
		svc := NewRuntimeConfigService(oc, rc, nil)

		out := map[string]interface{}{}
		if ok := svc.layerThunderKeys(ctx, "acme", "proj", webapp, dep, out); ok {
			t.Fatalf("want false when the SPA external URL is unresolved")
		}
		if len(rc.PatchBindingEnvironmentConfigsCalls()) != 0 {
			t.Errorf("the binding must not be patched before the SPA URL resolves")
		}
	})

	t.Run("patch failure → false, no read", func(t *testing.T) {
		t.Parallel()
		oc := ocResolving(map[string]string{"web": "http://web.local"})
		rc := thunderRC(thunderOutputs(), errors.New("patch down"))
		svc := NewRuntimeConfigService(oc, rc, nil)

		out := map[string]interface{}{}
		if ok := svc.layerThunderKeys(ctx, "acme", "proj", webapp, dep, out); ok {
			t.Fatalf("want false when the patch fails")
		}
		if len(out) != 0 {
			t.Errorf("no keys expected on patch failure; got %v", out)
		}
	})

	t.Run("binding without status → false", func(t *testing.T) {
		t.Parallel()
		oc := ocResolving(map[string]string{"web": "http://web.local"})
		rc := thunderRC(nil, nil) // binding has no status yet
		svc := NewRuntimeConfigService(oc, rc, nil)

		out := map[string]interface{}{}
		if ok := svc.layerThunderKeys(ctx, "acme", "proj", webapp, dep, out); ok {
			t.Fatalf("want false when the binding has no status/outputs")
		}
	})

	t.Run("GetBinding error → false", func(t *testing.T) {
		t.Parallel()
		oc := ocResolving(map[string]string{"web": "http://web.local"})
		rc := thunderRC(thunderOutputs(), nil)
		rc.GetBindingFunc = func(context.Context, string, string) (*openchoreo.ResourceReleaseBinding, error) {
			return nil, errors.New("oc down")
		}
		svc := NewRuntimeConfigService(oc, rc, nil)

		out := map[string]interface{}{}
		if ok := svc.layerThunderKeys(ctx, "acme", "proj", webapp, dep, out); ok {
			t.Fatalf("want false when GetBinding errors")
		}
	})
}

// --- componentExternalURL ----------------------------------------------------

func Test_componentExternalURL(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	t.Run("nil componentClient → empty", func(t *testing.T) {
		t.Parallel()
		svc := NewRuntimeConfigService(nil, nil, nil)
		if got := svc.componentExternalURL(ctx, "acme", "proj", "web"); got != "" {
			t.Errorf("want empty when componentClient is nil; got %q", got)
		}
	})

	t.Run("ListDeployments error → empty", func(t *testing.T) {
		t.Parallel()
		oc := &ocmocks.ComponentClientMock{ListDeploymentsFunc: func(context.Context, string, string, string) (*models.DeploymentList, error) {
			return nil, errors.New("boom")
		}}
		if got := NewRuntimeConfigService(oc, nil, nil).componentExternalURL(ctx, "acme", "proj", "web"); got != "" {
			t.Errorf("want empty on error; got %q", got)
		}
	})

	t.Run("returns first non-empty EndpointURL verbatim", func(t *testing.T) {
		t.Parallel()
		oc := &ocmocks.ComponentClientMock{ListDeploymentsFunc: func(context.Context, string, string, string) (*models.DeploymentList, error) {
			return &models.DeploymentList{Items: []models.Deployment{
				{EndpointURL: ""},                  // skipped
				{EndpointURL: "http://web.local/"}, // returned untrimmed
			}}, nil
		}}
		if got := NewRuntimeConfigService(oc, nil, nil).componentExternalURL(ctx, "acme", "proj", "web"); got != "http://web.local/" {
			t.Errorf("componentExternalURL = %q; want the first non-empty URL verbatim", got)
		}
	})
}

// --- EmitForComponent --------------------------------------------------------

func Test_EmitForComponent(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	webAndAPI := func(thunderDep string) map[string]string {
		return map[string]string{
			artifacts.DesignRootFile:     rootDesignMd(),
			"components/web/design.json": webappWithThunderMd("web", thunderDep, "api"),
			"components/api/design.json": serviceComponentMd(),
		}
	}

	t.Run("happy path emits env-config.js with the full window._env_ shape", func(t *testing.T) {
		t.Parallel()
		oc := ocResolving(map[string]string{
			"api": "http://api.local/todo",
			"web": "http://web.local/",
		})
		oc.UpdateComponentWorkflowFilesFunc = func(context.Context, string, string, string, []models.WorkflowFileVar) error {
			return nil
		}
		rc := thunderRC(thunderOutputs(), nil)
		svc := NewRuntimeConfigService(oc, rc, storeWith(webAndAPI("auth")))

		if err := svc.EmitForComponent(ctx, "acme", "proj", "web"); err != nil {
			t.Fatalf("EmitForComponent: %v", err)
		}
		calls := oc.UpdateComponentWorkflowFilesCalls()
		if len(calls) != 1 {
			t.Fatalf("want exactly 1 UpdateComponentWorkflowFiles call; got %d", len(calls))
		}
		call := calls[0]
		if call.OrgName != "acme" || call.ProjectName != "proj" || call.ComponentName != "web" {
			t.Errorf("emit scoped wrong: org=%q proj=%q comp=%q", call.OrgName, call.ProjectName, call.ComponentName)
		}
		if len(call.Files) != 1 {
			t.Fatalf("want 1 file emitted; got %d", len(call.Files))
		}
		f := call.Files[0]
		if f.Key != "env-config.js" || f.MountPath != "/usr/share/nginx/html/" {
			t.Errorf("file identity drifted: key=%q mountPath=%q", f.Key, f.MountPath)
		}
		for _, want := range []string{
			"window._env_ = {",
			`API_BASE_URL: "http://api.local/todo"`,
			`API_URL: "http://api.local/todo"`,
			`THUNDER_URL: "http://thunder.local"`,
			`THUNDER_CLIENT_ID: "web-cid"`,
			`THUNDER_REDIRECT_URI: "http://web.local/callback"`,
			`THUNDER_SCOPES: "openid profile email"`,
			`THUNDER_AFTER_SIGN_IN_URL: "http://web.local"`,
		} {
			if !strings.Contains(f.Value, want) {
				t.Errorf("emitted env-config.js missing %q\ngot:\n%s", want, f.Value)
			}
		}
	})

	t.Run("not-ready (unresolved dep) defers the write", func(t *testing.T) {
		t.Parallel()
		// No thunder dep so only the service-dep gate is in play; api unresolved.
		oc := ocResolving(map[string]string{})
		oc.UpdateComponentWorkflowFilesFunc = func(context.Context, string, string, string, []models.WorkflowFileVar) error {
			t.Errorf("UpdateComponentWorkflowFiles must NOT be called when not ready")
			return nil
		}
		svc := NewRuntimeConfigService(oc, nil, storeWith(webAndAPI("")))

		if err := svc.EmitForComponent(ctx, "acme", "proj", "web"); err != nil {
			t.Fatalf("EmitForComponent should be a soft no-op when not ready; got %v", err)
		}
		if n := len(oc.UpdateComponentWorkflowFilesCalls()); n != 0 {
			t.Errorf("want 0 emits when not ready; got %d", n)
		}
	})

	t.Run("not-ready (thunder outputs unresolved) defers the write", func(t *testing.T) {
		t.Parallel()
		// api + SPA resolve; the binding outputs lack client_id → THUNDER layer defers.
		oc := ocResolving(map[string]string{"api": "http://api.local", "web": "http://web.local"})
		oc.UpdateComponentWorkflowFilesFunc = func(context.Context, string, string, string, []models.WorkflowFileVar) error {
			t.Errorf("UpdateComponentWorkflowFiles must NOT be called when outputs are unresolved")
			return nil
		}
		rc := thunderRC(map[string]string{"issuer": "http://thunder.local"}, nil) // no client_id
		svc := NewRuntimeConfigService(oc, rc, storeWith(webAndAPI("auth")))

		if err := svc.EmitForComponent(ctx, "acme", "proj", "web"); err != nil {
			t.Fatalf("EmitForComponent: %v", err)
		}
		if n := len(oc.UpdateComponentWorkflowFilesCalls()); n != 0 {
			t.Errorf("want 0 emits; got %d", n)
		}
	})

	t.Run("non-web-app component is a no-op", func(t *testing.T) {
		t.Parallel()
		oc := &ocmocks.ComponentClientMock{}
		svc := NewRuntimeConfigService(oc, nil, storeWith(webAndAPI("")))

		if err := svc.EmitForComponent(ctx, "acme", "proj", "api"); err != nil {
			t.Fatalf("EmitForComponent on a service should be nil; got %v", err)
		}
		if len(oc.ListDeploymentsCalls()) != 0 {
			t.Errorf("no OC reads expected for a non-web-app; got %d", len(oc.ListDeploymentsCalls()))
		}
	})

	t.Run("unknown component name is a no-op", func(t *testing.T) {
		t.Parallel()
		oc := &ocmocks.ComponentClientMock{}
		svc := NewRuntimeConfigService(oc, nil, storeWith(webAndAPI("")))
		if err := svc.EmitForComponent(ctx, "acme", "proj", "ghost"); err != nil {
			t.Fatalf("EmitForComponent on a missing component should be nil; got %v", err)
		}
		if len(oc.ListDeploymentsCalls()) != 0 {
			t.Errorf("no OC reads expected; got %d", len(oc.ListDeploymentsCalls()))
		}
	})

	t.Run("design absent (empty tree) is a no-op", func(t *testing.T) {
		t.Parallel()
		oc := &ocmocks.ComponentClientMock{}
		svc := NewRuntimeConfigService(oc, nil, storeWith(map[string]string{}))
		if err := svc.EmitForComponent(ctx, "acme", "proj", "web"); err != nil {
			t.Fatalf("want nil when there is no design yet; got %v", err)
		}
	})

	t.Run("design read not-found is swallowed", func(t *testing.T) {
		t.Parallel()
		store := artifacts.NewArtifactStore(&artifactstest.FakeArtifactService{
			ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
				return nil, artifacts.ErrArtifactNotFound
			},
		})
		oc := &ocmocks.ComponentClientMock{}
		svc := NewRuntimeConfigService(oc, nil, store)
		if err := svc.EmitForComponent(ctx, "acme", "proj", "web"); err != nil {
			t.Fatalf("ErrArtifactNotFound must be swallowed; got %v", err)
		}
	})

	t.Run("empty identifiers error", func(t *testing.T) {
		t.Parallel()
		svc := NewRuntimeConfigService(&ocmocks.ComponentClientMock{}, nil, storeWith(webAndAPI("")))
		for _, tc := range []struct{ org, proj, comp string }{
			{"", "proj", "web"},
			{"acme", "", "web"},
			{"acme", "proj", ""},
		} {
			if err := svc.EmitForComponent(ctx, tc.org, tc.proj, tc.comp); err == nil {
				t.Errorf("EmitForComponent(%q,%q,%q) should error on empty identifier", tc.org, tc.proj, tc.comp)
			}
		}
	})

	t.Run("UpdateComponentWorkflowFiles error propagates", func(t *testing.T) {
		t.Parallel()
		oc := ocResolving(map[string]string{"api": "http://api.local"}) // no thunder → ready
		oc.UpdateComponentWorkflowFilesFunc = func(context.Context, string, string, string, []models.WorkflowFileVar) error {
			return errors.New("oc write failed")
		}
		svc := NewRuntimeConfigService(oc, nil, storeWith(webAndAPI("")))
		err := svc.EmitForComponent(ctx, "acme", "proj", "web")
		if err == nil {
			t.Fatalf("want the OC write error to propagate")
		}
		if !strings.Contains(err.Error(), "update workflow files") {
			t.Errorf("error not wrapped as expected: %v", err)
		}
	})

	t.Run("nil service receiver is a no-op", func(t *testing.T) {
		t.Parallel()
		var svc *RuntimeConfigService
		if err := svc.EmitForComponent(ctx, "acme", "proj", "web"); err != nil {
			t.Errorf("nil receiver EmitForComponent should be nil; got %v", err)
		}
	})
}

// --- EmitForProjectSPAs ------------------------------------------------------

func Test_EmitForProjectSPAs(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	twoSPAsOneService := map[string]string{
		artifacts.DesignRootFile:      rootDesignMd(),
		"components/web1/design.json": webappMd("web1", "api"),
		"components/web2/design.json": webappMd("web2", "api"),
		"components/api/design.json":  serviceComponentMd(),
	}

	t.Run("emits each web-app, skips services", func(t *testing.T) {
		t.Parallel()
		oc := ocResolving(map[string]string{"api": "http://api.local"})
		oc.UpdateComponentWorkflowFilesFunc = func(context.Context, string, string, string, []models.WorkflowFileVar) error {
			return nil
		}
		svc := NewRuntimeConfigService(oc, nil, storeWith(twoSPAsOneService))

		if err := svc.EmitForProjectSPAs(ctx, "acme", "proj"); err != nil {
			t.Fatalf("EmitForProjectSPAs: %v", err)
		}
		calls := oc.UpdateComponentWorkflowFilesCalls()
		if len(calls) != 2 {
			t.Fatalf("want 2 emits (one per web-app); got %d", len(calls))
		}
		emitted := map[string]bool{}
		for _, c := range calls {
			emitted[c.ComponentName] = true
		}
		if !emitted["web1"] || !emitted["web2"] {
			t.Errorf("both SPAs must be emitted; got %v", emitted)
		}
		if emitted["api"] {
			t.Errorf("the service component must not be emitted")
		}
	})

	t.Run("no web-apps is a no-op", func(t *testing.T) {
		t.Parallel()
		files := map[string]string{
			artifacts.DesignRootFile:     rootDesignMd(),
			"components/api/design.json": serviceComponentMd(),
		}
		oc := &ocmocks.ComponentClientMock{} // must never be touched
		svc := NewRuntimeConfigService(oc, nil, storeWith(files))
		if err := svc.EmitForProjectSPAs(ctx, "acme", "proj"); err != nil {
			t.Fatalf("want nil with no web-apps; got %v", err)
		}
		if len(oc.UpdateComponentWorkflowFilesCalls()) != 0 {
			t.Errorf("no emits expected; got %d", len(oc.UpdateComponentWorkflowFilesCalls()))
		}
	})

	t.Run("per-SPA emit failure is best-effort: continues and returns nil", func(t *testing.T) {
		t.Parallel()
		oc := ocResolving(map[string]string{"api": "http://api.local"})
		oc.UpdateComponentWorkflowFilesFunc = func(_ context.Context, _, _, componentName string, _ []models.WorkflowFileVar) error {
			if componentName == "web1" {
				return errors.New("oc write failed for web1")
			}
			return nil
		}
		svc := NewRuntimeConfigService(oc, nil, storeWith(twoSPAsOneService))

		if err := svc.EmitForProjectSPAs(ctx, "acme", "proj"); err != nil {
			t.Fatalf("EmitForProjectSPAs must swallow per-component errors; got %v", err)
		}
		if n := len(oc.UpdateComponentWorkflowFilesCalls()); n != 2 {
			t.Errorf("want both SPAs attempted (2 write calls); got %d", n)
		}
	})

	t.Run("empty identifiers error", func(t *testing.T) {
		t.Parallel()
		svc := NewRuntimeConfigService(&ocmocks.ComponentClientMock{}, nil, storeWith(twoSPAsOneService))
		if err := svc.EmitForProjectSPAs(ctx, "", "proj"); err == nil {
			t.Errorf("empty orgID should error")
		}
		if err := svc.EmitForProjectSPAs(ctx, "acme", ""); err == nil {
			t.Errorf("empty projectID should error")
		}
	})

	t.Run("nil service receiver is a no-op", func(t *testing.T) {
		t.Parallel()
		var svc *RuntimeConfigService
		if err := svc.EmitForProjectSPAs(ctx, "acme", "proj"); err != nil {
			t.Errorf("nil receiver EmitForProjectSPAs should be nil; got %v", err)
		}
	})
}
