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
//   - thundersvc.Client → hand fake (only EnsureProjectOAuthClient is on this
//     feature's path; the other six panic, so a stray call is a test bug).
//   - artifacts.ArtifactStore → the REAL artifacts.NewArtifactStore decorator
//     over artifactstest.FakeArtifactService, fed a valid design working-tree
//     map. The frontmatter → models.DesignComponent parse (componentType,
//     dependsOn, callerIdentity.mode) is therefore the real one, not a stub.
//
// (runtime_config_service_test.go, external_url_test.go) and untouched here.
package runtimeconfig

import (
	"context"
	"errors"
	"strings"
	"testing"

	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
	"github.com/wso2/aep/aep-api/internal/clients/thundersvc"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts/artifactstest"
	"github.com/wso2/aep/aep-api/models"
)

// --- test doubles ------------------------------------------------------------

// fakeThunder hand-fakes thundersvc.Client. runtimeconfig only ever calls
// EnsureProjectOAuthClient; the other six methods are not on this feature's
// path, so a call to one is a test bug — they panic (moq convention). Each
// fake is built per-test and driven synchronously, so no mutex is needed.
type fakeThunder struct {
	ensureFn    func(ctx context.Context, projectName string, redirectURIs []string) (string, bool, error)
	ensureCalls []ensureProjectCall
}

type ensureProjectCall struct {
	projectName  string
	redirectURIs []string
}

var _ thundersvc.Client = (*fakeThunder)(nil)

func (f *fakeThunder) EnsureProjectOAuthClient(ctx context.Context, projectName string, redirectURIs []string) (string, bool, error) {
	f.ensureCalls = append(f.ensureCalls, ensureProjectCall{projectName: projectName, redirectURIs: redirectURIs})
	if f.ensureFn == nil {
		return "cid-" + projectName, true, nil
	}
	return f.ensureFn(ctx, projectName, redirectURIs)
}

func (f *fakeThunder) EnsurePublisherApp(context.Context, string, string) (string, string, bool, error) {
	panic("fakeThunder: EnsurePublisherApp is not part of the runtimeconfig feature")
}
func (f *fakeThunder) OUExists(context.Context, string) (bool, error) {
	panic("fakeThunder: OUExists is not part of the runtimeconfig feature")
}
func (f *fakeThunder) DeletePublisherApp(context.Context, string) (bool, error) {
	panic("fakeThunder: DeletePublisherApp is not part of the runtimeconfig feature")
}
func (f *fakeThunder) RegenerateClientSecret(context.Context, string) (string, error) {
	panic("fakeThunder: RegenerateClientSecret is not part of the runtimeconfig feature")
}
func (f *fakeThunder) EnsureRedirectURIs(context.Context, string, []string) (bool, error) {
	panic("fakeThunder: EnsureRedirectURIs is not part of the runtimeconfig feature")
}

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
	return componentDesignJSONFixture("api", "service", nil, false)
}

// webappMd renders a web-app component's design.json. deps become component-kind
// dependencies; oidc=true adds callerIdentity.mode=end-user.
func webappMd(name string, oidc bool, deps ...string) string {
	return componentDesignJSONFixture(name, "web-app", deps, oidc)
}

// componentDesignJSONFixture builds a `components/<name>/design.json` body:
// component-kind dependencies from deps, optional end-user callerIdentity.
func componentDesignJSONFixture(name, typ string, deps []string, oidc bool) string {
	var b strings.Builder
	b.WriteString("{\n")
	b.WriteString("  \"name\": \"" + name + "\",\n")
	b.WriteString("  \"type\": \"" + typ + "\",\n")
	if typ == "service" {
		b.WriteString("  \"language\": \"Go\",\n")
	}
	if len(deps) > 0 {
		b.WriteString("  \"dependencies\": [\n")
		for i, d := range deps {
			comma := ","
			if i == len(deps)-1 {
				comma = ""
			}
			b.WriteString("    {\n      \"kind\": \"component\",\n      \"name\": \"" + d + "\"\n    }" + comma + "\n")
		}
		b.WriteString("  ]")
	} else {
		b.WriteString("  \"dependencies\": []")
	}
	if oidc {
		b.WriteString(",\n  \"callerIdentity\": {\n    \"mode\": \"end-user\"\n  }")
	}
	b.WriteString("\n}\n")
	return b.String()
}

// --- buildEnvValues ----------------------------------------------------------

func Test_buildEnvValues(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	t.Run("resolved service dep, oidc off: ready + sibling URL keys, no THUNDER", func(t *testing.T) {
		t.Parallel()
		files := map[string]string{
			artifacts.DesignRootFile:     rootDesignMd(),
			"components/web/design.json": webappMd("web", false, "api"),
			"components/api/design.json": serviceComponentMd(),
		}
		design := readDesign(t, files)
		web := componentNamed(t, design, "web")

		oc := ocResolving(map[string]string{"api": "http://api.local/todo/"}) // trailing slash trimmed
		svc := NewRuntimeConfigService(oc, nil)

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
				t.Errorf("THUNDER_* must not appear when callerIdentity.mode != end-user; got key %q", k)
			}
		}
	})

	t.Run("multiple service deps: API_BASE_URL is the first declared service", func(t *testing.T) {
		t.Parallel()
		files := map[string]string{
			artifacts.DesignRootFile:          rootDesignMd(),
			"components/web/design.json":      webappMd("web", false, "api", "auth-svc"),
			"components/api/design.json":      serviceComponentMd(),
			"components/auth-svc/design.json": componentDesignJSONFixture("auth-svc", "service", nil, false),
		}
		design := readDesign(t, files)
		web := componentNamed(t, design, "web")

		oc := ocResolving(map[string]string{
			"api":      "http://api.local",
			"auth-svc": "http://auth.local",
		})
		out, ready := NewRuntimeConfigService(oc, nil).buildEnvValues(ctx, "acme", "proj", web, design)
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
			"components/web/design.json": webappMd("web", false, "api"),
			"components/api/design.json": serviceComponentMd(),
		}
		design := readDesign(t, files)
		web := componentNamed(t, design, "web")

		// api maps to nothing → ocResolving returns an empty deployment list →
		// no URL yet → the required dep is not resolvable → not ready.
		oc := ocResolving(map[string]string{})
		out, ready := NewRuntimeConfigService(oc, nil).buildEnvValues(ctx, "acme", "proj", web, design)
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
			"components/web/design.json": webappMd("web", false, "api"),
			"components/api/design.json": serviceComponentMd(),
		}
		design := readDesign(t, files)
		web := componentNamed(t, design, "web")

		oc := &ocmocks.ComponentClientMock{
			ListDeploymentsFunc: func(context.Context, string, string, string) (*models.DeploymentList, error) {
				return nil, errors.New("oc: transient")
			},
		}
		_, ready := NewRuntimeConfigService(oc, nil).buildEnvValues(ctx, "acme", "proj", web, design)
		if ready {
			t.Fatalf("want ready=false on a transient OC error for a required dep; got true")
		}
	})

	t.Run("nil deployment list on a dep gates emission", func(t *testing.T) {
		t.Parallel()
		files := map[string]string{
			artifacts.DesignRootFile:     rootDesignMd(),
			"components/web/design.json": webappMd("web", false, "api"),
			"components/api/design.json": serviceComponentMd(),
		}
		design := readDesign(t, files)
		web := componentNamed(t, design, "web")

		oc := &ocmocks.ComponentClientMock{
			ListDeploymentsFunc: func(context.Context, string, string, string) (*models.DeploymentList, error) {
				return nil, nil // no error, but nil list → not resolvable yet
			},
		}
		_, ready := NewRuntimeConfigService(oc, nil).buildEnvValues(ctx, "acme", "proj", web, design)
		if ready {
			t.Fatalf("want ready=false when the dep's deployment list is nil; got true")
		}
	})

	t.Run("non-service dep is skipped, not gated", func(t *testing.T) {
		t.Parallel()
		// web depends on a peer web-app (not a service) → skipped over HTTP;
		// no URL contributed, but readiness is NOT withheld.
		files := map[string]string{
			artifacts.DesignRootFile:      rootDesignMd(),
			"components/web/design.json":  webappMd("web", false, "peer"),
			"components/peer/design.json": webappMd("peer", false),
		}
		design := readDesign(t, files)
		web := componentNamed(t, design, "web")

		// ListDeployments must NOT be called for a non-service dep — leave it
		// unset so a stray call panics.
		oc := &ocmocks.ComponentClientMock{}
		out, ready := NewRuntimeConfigService(oc, nil).buildEnvValues(ctx, "acme", "proj", web, design)
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

	t.Run("dangling dependsOn (unknown sibling) is skipped, not gated", func(t *testing.T) {
		t.Parallel()
		files := map[string]string{
			artifacts.DesignRootFile:     rootDesignMd(),
			"components/web/design.json": webappMd("web", false, "ghost"),
		}
		design := readDesign(t, files)
		web := componentNamed(t, design, "web")

		oc := &ocmocks.ComponentClientMock{} // must not be called
		out, ready := NewRuntimeConfigService(oc, nil).buildEnvValues(ctx, "acme", "proj", web, design)
		if !ready {
			t.Fatalf("want ready=true; an unresolvable sibling name is skipped, not deferred")
		}
		if len(out) != 0 {
			t.Errorf("want empty env map; got %v", out)
		}
	})

	t.Run("oidc on + everything resolved: ready with THUNDER_* layered", func(t *testing.T) {
		t.Parallel()
		files := map[string]string{
			artifacts.DesignRootFile:     rootDesignMd(),
			"components/web/design.json": webappMd("web", true, "api"),
			"components/api/design.json": serviceComponentMd(),
		}
		design := readDesign(t, files)
		web := componentNamed(t, design, "web")

		oc := ocResolving(map[string]string{
			"api": "http://api.local",
			"web": "http://web.local/",
		})
		th := &fakeThunder{}
		svc := NewRuntimeConfigService(oc, nil)
		svc.SetPlatformIDP("http://thunder.local", "")
		svc.SetThunderAdmin(th)

		out, ready := svc.buildEnvValues(ctx, "acme", "proj", web, design)
		if !ready {
			t.Fatalf("want ready=true; got false (out=%v)", out)
		}
		if out["THUNDER_CLIENT_ID"] != "cid-proj" || out["THUNDER_URL"] != "http://thunder.local" {
			t.Errorf("THUNDER_* not layered: %v", out)
		}
	})

	t.Run("oidc on but SPA URL unresolved gates emission", func(t *testing.T) {
		t.Parallel()
		files := map[string]string{
			artifacts.DesignRootFile:     rootDesignMd(),
			"components/web/design.json": webappMd("web", true, "api"),
			"components/api/design.json": serviceComponentMd(),
		}
		design := readDesign(t, files)
		web := componentNamed(t, design, "web")

		// api resolves, but the SPA's own URL (web) does not → layerThunderKeys
		// returns false → overall not ready.
		oc := ocResolving(map[string]string{"api": "http://api.local"})
		th := &fakeThunder{}
		svc := NewRuntimeConfigService(oc, nil)
		svc.SetPlatformIDP("http://thunder.local", "")
		svc.SetThunderAdmin(th)

		_, ready := svc.buildEnvValues(ctx, "acme", "proj", web, design)
		if ready {
			t.Fatalf("want ready=false when the SPA external URL is not yet resolved")
		}
		if len(th.ensureCalls) != 0 {
			t.Errorf("thunder must not be called before the SPA URL resolves; got %d calls", len(th.ensureCalls))
		}
	})
}

// --- layerThunderKeys --------------------------------------------------------

func Test_layerThunderKeys(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	webapp := &models.DesignComponent{
		Name:           "web",
		ComponentType:  "web-app",
		CallerIdentity: &models.CallerIdentity{Mode: "end-user"},
	}

	t.Run("happy: all five THUNDER_* keys + correct redirect URI", func(t *testing.T) {
		t.Parallel()
		oc := ocResolving(map[string]string{"web": "http://web.local/"})
		th := &fakeThunder{ensureFn: func(_ context.Context, _ string, _ []string) (string, bool, error) {
			return "web-cid", true, nil
		}}
		svc := NewRuntimeConfigService(oc, nil)
		svc.SetPlatformIDP("http://thunder.local", "") // empty scopes keeps the ctor default

		svc.SetThunderAdmin(th)

		out := map[string]interface{}{}
		if ok := svc.layerThunderKeys(ctx, "acme", "proj", webapp, out); !ok {
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
		if len(th.ensureCalls) != 1 {
			t.Fatalf("want 1 EnsureProjectOAuthClient call; got %d", len(th.ensureCalls))
		}
		call := th.ensureCalls[0]
		if call.projectName != "proj" {
			t.Errorf("EnsureProjectOAuthClient projectName = %q; want proj", call.projectName)
		}
		if len(call.redirectURIs) != 1 || call.redirectURIs[0] != "http://web.local/callback" {
			t.Errorf("redirectURIs = %v; want [http://web.local/callback]", call.redirectURIs)
		}
	})

	t.Run("issuer not configured → false, no keys, no downstream calls", func(t *testing.T) {
		t.Parallel()
		// Leave ListDeployments unset: if layerThunderKeys got past the issuer
		// check to componentExternalURL, the mock would panic.
		oc := &ocmocks.ComponentClientMock{}
		th := &fakeThunder{}
		svc := NewRuntimeConfigService(oc, nil) // platformIDPIssuer == ""
		svc.SetThunderAdmin(th)

		out := map[string]interface{}{}
		if ok := svc.layerThunderKeys(ctx, "acme", "proj", webapp, out); ok {
			t.Fatalf("want false when platformIDPIssuer is empty")
		}
		if len(out) != 0 {
			t.Errorf("no keys expected; got %v", out)
		}
	})

	t.Run("SPA URL not resolved → false, thunder not called", func(t *testing.T) {
		t.Parallel()
		oc := ocResolving(map[string]string{}) // web → empty list
		th := &fakeThunder{}
		svc := NewRuntimeConfigService(oc, nil)
		svc.SetPlatformIDP("http://thunder.local", "")
		svc.SetThunderAdmin(th)

		out := map[string]interface{}{}
		if ok := svc.layerThunderKeys(ctx, "acme", "proj", webapp, out); ok {
			t.Fatalf("want false when the SPA external URL is unresolved")
		}
		if len(th.ensureCalls) != 0 {
			t.Errorf("thunder must not be called before the SPA URL resolves; got %d", len(th.ensureCalls))
		}
	})

	t.Run("thunderAdmin not wired → false", func(t *testing.T) {
		t.Parallel()
		oc := ocResolving(map[string]string{"web": "http://web.local"})
		svc := NewRuntimeConfigService(oc, nil)
		svc.SetPlatformIDP("http://thunder.local", "")
		// no SetThunderAdmin

		out := map[string]interface{}{}
		if ok := svc.layerThunderKeys(ctx, "acme", "proj", webapp, out); ok {
			t.Fatalf("want false when thunderAdmin is nil")
		}
		if len(out) != 0 {
			t.Errorf("no keys expected; got %v", out)
		}
	})

	t.Run("EnsureProjectOAuthClient error → false", func(t *testing.T) {
		t.Parallel()
		oc := ocResolving(map[string]string{"web": "http://web.local"})
		th := &fakeThunder{ensureFn: func(context.Context, string, []string) (string, bool, error) {
			return "", false, errors.New("thunder down")
		}}
		svc := NewRuntimeConfigService(oc, nil)
		svc.SetPlatformIDP("http://thunder.local", "")
		svc.SetThunderAdmin(th)

		out := map[string]interface{}{}
		if ok := svc.layerThunderKeys(ctx, "acme", "proj", webapp, out); ok {
			t.Fatalf("want false when EnsureProjectOAuthClient errors")
		}
		if len(out) != 0 {
			t.Errorf("no keys expected on error; got %v", out)
		}
	})

	t.Run("EnsureProjectOAuthClient empty clientID → false", func(t *testing.T) {
		t.Parallel()
		oc := ocResolving(map[string]string{"web": "http://web.local"})
		th := &fakeThunder{ensureFn: func(context.Context, string, []string) (string, bool, error) {
			return "", false, nil // no error, but no clientID
		}}
		svc := NewRuntimeConfigService(oc, nil)
		svc.SetPlatformIDP("http://thunder.local", "")
		svc.SetThunderAdmin(th)

		out := map[string]interface{}{}
		if ok := svc.layerThunderKeys(ctx, "acme", "proj", webapp, out); ok {
			t.Fatalf("want false when EnsureProjectOAuthClient returns an empty clientID")
		}
	})

	t.Run("SetPlatformIDP custom scopes flow through", func(t *testing.T) {
		t.Parallel()
		oc := ocResolving(map[string]string{"web": "http://web.local"})
		th := &fakeThunder{}
		svc := NewRuntimeConfigService(oc, nil)
		svc.SetPlatformIDP("http://thunder.local", "openid custom")
		svc.SetThunderAdmin(th)

		out := map[string]interface{}{}
		if ok := svc.layerThunderKeys(ctx, "acme", "proj", webapp, out); !ok {
			t.Fatalf("layerThunderKeys returned false")
		}
		if out["THUNDER_SCOPES"] != "openid custom" {
			t.Errorf("THUNDER_SCOPES = %v; want the overridden scope string", out["THUNDER_SCOPES"])
		}
	})
}

// --- oidcSPAEnabled ----------------------------------------------------------

func Test_oidcSPAEnabled(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   *models.DesignComponent
		want bool
	}{
		{"nil component", nil, false},
		{"service with end-user identity is not an SPA", &models.DesignComponent{ComponentType: "service", CallerIdentity: &models.CallerIdentity{Mode: "end-user"}}, false},
		{"web-app without callerIdentity", &models.DesignComponent{ComponentType: "web-app"}, false},
		{"web-app service-account mode", &models.DesignComponent{ComponentType: "web-app", CallerIdentity: &models.CallerIdentity{Mode: "service-account"}}, false},
		{"web-app end-user mode", &models.DesignComponent{ComponentType: "web-app", CallerIdentity: &models.CallerIdentity{Mode: "end-user"}}, true},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := oidcSPAEnabled(c.in); got != c.want {
				t.Errorf("oidcSPAEnabled(%s) = %v; want %v", c.name, got, c.want)
			}
		})
	}
}

// --- componentExternalURL ----------------------------------------------------

func Test_componentExternalURL(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	t.Run("nil componentClient → empty", func(t *testing.T) {
		t.Parallel()
		svc := NewRuntimeConfigService(nil, nil)
		if got := svc.componentExternalURL(ctx, "acme", "proj", "web"); got != "" {
			t.Errorf("want empty when componentClient is nil; got %q", got)
		}
	})

	t.Run("ListDeployments error → empty", func(t *testing.T) {
		t.Parallel()
		oc := &ocmocks.ComponentClientMock{ListDeploymentsFunc: func(context.Context, string, string, string) (*models.DeploymentList, error) {
			return nil, errors.New("boom")
		}}
		if got := NewRuntimeConfigService(oc, nil).componentExternalURL(ctx, "acme", "proj", "web"); got != "" {
			t.Errorf("want empty on error; got %q", got)
		}
	})

	t.Run("nil list → empty", func(t *testing.T) {
		t.Parallel()
		oc := &ocmocks.ComponentClientMock{ListDeploymentsFunc: func(context.Context, string, string, string) (*models.DeploymentList, error) {
			return nil, nil
		}}
		if got := NewRuntimeConfigService(oc, nil).componentExternalURL(ctx, "acme", "proj", "web"); got != "" {
			t.Errorf("want empty on nil list; got %q", got)
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
		if got := NewRuntimeConfigService(oc, nil).componentExternalURL(ctx, "acme", "proj", "web"); got != "http://web.local/" {
			t.Errorf("componentExternalURL = %q; want the first non-empty URL verbatim", got)
		}
	})
}

// --- EmitForComponent --------------------------------------------------------

func Test_EmitForComponent(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	webAndAPI := func(oidc bool) map[string]string {
		return map[string]string{
			artifacts.DesignRootFile:     rootDesignMd(),
			"components/web/design.json": webappMd("web", oidc, "api"),
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
		th := &fakeThunder{ensureFn: func(context.Context, string, []string) (string, bool, error) {
			return "web-cid", true, nil
		}}
		svc := NewRuntimeConfigService(oc, storeWith(webAndAPI(true)))
		svc.SetPlatformIDP("http://thunder.local", "")
		svc.SetThunderAdmin(th)

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
		// OIDC off so only the service-dep gate is in play; api unresolved.
		oc := ocResolving(map[string]string{})
		oc.UpdateComponentWorkflowFilesFunc = func(context.Context, string, string, string, []models.WorkflowFileVar) error {
			t.Errorf("UpdateComponentWorkflowFiles must NOT be called when not ready")
			return nil
		}
		svc := NewRuntimeConfigService(oc, storeWith(webAndAPI(false)))

		if err := svc.EmitForComponent(ctx, "acme", "proj", "web"); err != nil {
			t.Fatalf("EmitForComponent should be a soft no-op when not ready; got %v", err)
		}
		if n := len(oc.UpdateComponentWorkflowFilesCalls()); n != 0 {
			t.Errorf("want 0 emits when not ready; got %d", n)
		}
	})

	t.Run("not-ready (oidc SPA URL unresolved) defers the write", func(t *testing.T) {
		t.Parallel()
		// api resolves; the SPA's own URL does not → THUNDER layer defers.
		oc := ocResolving(map[string]string{"api": "http://api.local"})
		oc.UpdateComponentWorkflowFilesFunc = func(context.Context, string, string, string, []models.WorkflowFileVar) error {
			t.Errorf("UpdateComponentWorkflowFiles must NOT be called when the SPA URL is unresolved")
			return nil
		}
		th := &fakeThunder{}
		svc := NewRuntimeConfigService(oc, storeWith(webAndAPI(true)))
		svc.SetPlatformIDP("http://thunder.local", "")
		svc.SetThunderAdmin(th)

		if err := svc.EmitForComponent(ctx, "acme", "proj", "web"); err != nil {
			t.Fatalf("EmitForComponent: %v", err)
		}
		if n := len(oc.UpdateComponentWorkflowFilesCalls()); n != 0 {
			t.Errorf("want 0 emits; got %d", n)
		}
	})

	t.Run("non-web-app component is a no-op", func(t *testing.T) {
		t.Parallel()
		// api is a service. Leave ListDeployments + Update unset so any attempt
		// to build/emit panics — proving the early web-app guard short-circuits.
		oc := &ocmocks.ComponentClientMock{}
		svc := NewRuntimeConfigService(oc, storeWith(webAndAPI(false)))

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
		svc := NewRuntimeConfigService(oc, storeWith(webAndAPI(false)))
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
		svc := NewRuntimeConfigService(oc, storeWith(map[string]string{}))
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
		svc := NewRuntimeConfigService(oc, store)
		if err := svc.EmitForComponent(ctx, "acme", "proj", "web"); err != nil {
			t.Fatalf("ErrArtifactNotFound must be swallowed; got %v", err)
		}
	})

	t.Run("empty identifiers error", func(t *testing.T) {
		t.Parallel()
		svc := NewRuntimeConfigService(&ocmocks.ComponentClientMock{}, storeWith(webAndAPI(false)))
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
		oc := ocResolving(map[string]string{"api": "http://api.local"}) // OIDC off → ready
		oc.UpdateComponentWorkflowFilesFunc = func(context.Context, string, string, string, []models.WorkflowFileVar) error {
			return errors.New("oc write failed")
		}
		svc := NewRuntimeConfigService(oc, storeWith(webAndAPI(false)))
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
		"components/web1/design.json": webappMd("web1", false, "api"),
		"components/web2/design.json": webappMd("web2", false, "api"),
		"components/api/design.json":  serviceComponentMd(),
	}

	t.Run("emits each web-app, skips services", func(t *testing.T) {
		t.Parallel()
		oc := ocResolving(map[string]string{"api": "http://api.local"})
		oc.UpdateComponentWorkflowFilesFunc = func(context.Context, string, string, string, []models.WorkflowFileVar) error {
			return nil
		}
		svc := NewRuntimeConfigService(oc, storeWith(twoSPAsOneService))

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
		svc := NewRuntimeConfigService(oc, storeWith(files))
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
		svc := NewRuntimeConfigService(oc, storeWith(twoSPAsOneService))

		if err := svc.EmitForProjectSPAs(ctx, "acme", "proj"); err != nil {
			t.Fatalf("EmitForProjectSPAs must swallow per-component errors; got %v", err)
		}
		// Both SPAs were attempted even though web1 errored.
		if n := len(oc.UpdateComponentWorkflowFilesCalls()); n != 2 {
			t.Errorf("want both SPAs attempted (2 write calls); got %d", n)
		}
	})

	t.Run("empty identifiers error", func(t *testing.T) {
		t.Parallel()
		svc := NewRuntimeConfigService(&ocmocks.ComponentClientMock{}, storeWith(twoSPAsOneService))
		if err := svc.EmitForProjectSPAs(ctx, "", "proj"); err == nil {
			t.Errorf("empty orgID should error")
		}
		if err := svc.EmitForProjectSPAs(ctx, "acme", ""); err == nil {
			t.Errorf("empty projectID should error")
		}
	})

	t.Run("design absent is a no-op", func(t *testing.T) {
		t.Parallel()
		oc := &ocmocks.ComponentClientMock{}
		svc := NewRuntimeConfigService(oc, storeWith(map[string]string{}))
		if err := svc.EmitForProjectSPAs(ctx, "acme", "proj"); err != nil {
			t.Fatalf("want nil when there is no design yet; got %v", err)
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
