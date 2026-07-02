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

// COMPONENT tier (bff-component-testing.md §4), Component+DB flavor: the REAL
// idpService — over a pristine dbtest Postgres with a fake Thunder admin client
// (and, for discovery, a wire-faked OIDC issuer) — behind the REAL production
// chain (faked auth at the jwt.WithClaims seam → orgensure → Huma
// parsing/validation → tenant gate ENFORCE → the per-op error mapping in
// idp_huma.go), driven in-process via componenttest. The DB rides along because
// GetProfile/UpdateProfile/RegenerateClientSecret ARE the service (gorm is the
// seam, no store port to fake), so this file skips under -short like the dbtest
// tier. Body shapes mirror the harvested goldens get_org_idp.json /
// get_org_idp_discovery.json.
//
// Gate note: every op here embeds humakit.OrgScopedInput, so the whole
// /org/idp subtree — INCLUDING discovery — sits behind the ENFORCE gate. The
// discovery handler ignores the org (its result is a pure function of ?issuer),
// so it is a documented org-unused carve-out, but it is NOT ungated. The
// ENFORCE no-claims 401 is proven ONCE, on get-profile (each behavior at one
// tier).
//
// External test package: the harness imports api, which imports idp — an
// in-package test file would be an import cycle.
package idp_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/api"
	"github.com/wso2/aep/aep-api/internal/clients/thundersvc"
	"github.com/wso2/aep/aep-api/internal/feature/idp"
	"github.com/wso2/aep/aep-api/internal/platform/componenttest"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
)

const (
	idpPath          = "/api/v1/org/idp"
	idpRotatePath    = "/api/v1/org/idp/rotate"
	idpDiscoverPath  = "/api/v1/org/idp/discovery"
	goldenProfile    = "../../../testdata/harvest/golden/get_org_idp.json"
	goldenDiscovery  = "../../../testdata/harvest/golden/get_org_idp_discovery.json"
	compPlatformIss  = "http://thunder.test:8080"
	compPlatformJWKS = "http://thunder.test:8090/oauth2/jwks"
)

var compPlatform = idp.PlatformIDPConfig{Issuer: compPlatformIss, JWKSURL: compPlatformJWKS}

// compThunder is the component tier's fake Thunder admin client. idpService
// only calls Ensure/Delete/Regenerate; the rest are irrelevant and panic.
type compThunder struct {
	ensureFn func(ctx context.Context, orgHandle, orgOUID string) (string, string, bool, error)
	regenFn  func(ctx context.Context, orgHandle string) (string, error)
	regen    []string
}

var _ thundersvc.Client = (*compThunder)(nil)

func (f *compThunder) EnsurePublisherApp(ctx context.Context, orgHandle, orgOUID string) (string, string, bool, error) {
	if f.ensureFn == nil {
		return "aep-publisher-" + orgHandle, "secret-" + orgHandle, true, nil
	}
	return f.ensureFn(ctx, orgHandle, orgOUID)
}

func (f *compThunder) RegenerateClientSecret(ctx context.Context, orgHandle string) (string, error) {
	f.regen = append(f.regen, orgHandle)
	if f.regenFn == nil {
		return "rotated-" + orgHandle, nil
	}
	return f.regenFn(ctx, orgHandle)
}

func (f *compThunder) DeletePublisherApp(context.Context, string) (bool, error) {
	panic("compThunder: DeletePublisherApp unexpected in these cases")
}
func (f *compThunder) OUExists(context.Context, string) (bool, error) { panic("compThunder: OUExists") }
func (f *compThunder) EnsureRedirectURIs(context.Context, string, []string) (bool, error) {
	panic("compThunder: EnsureRedirectURIs")
}
func (f *compThunder) EnsureProjectOAuthClient(context.Context, string, []string) (string, bool, error) {
	panic("compThunder: EnsureProjectOAuthClient")
}

// newIDPHarness assembles the real chain around the REAL service: dbtest
// Postgres + the given Thunder (nil ⇒ the mutating ops answer
// ErrIDPThunderUnavailable). The service is returned so a test can provision a
// publisher through the real EnsureOrgPublisher path before it drives HTTP.
func newIDPHarness(t *testing.T, thunder thundersvc.Client) (*componenttest.Harness, idp.IDPService) {
	t.Helper()
	svc := idp.NewIDPService(dbtest.New(t), thunder, compPlatform)
	h := componenttest.New(t, componenttest.Options{Deps: api.HumaDeps{IDPSvc: svc}})
	return h, svc
}

// withoutSchema drops Huma's "$schema" key so a typed-body response (discovery)
// and a Body-any response (profile) compare against their goldens on the same
// footing — the task's "exclude $schema on both sides".
func withoutSchema(keys []string) []string {
	out := make([]string, 0, len(keys))
	for _, k := range keys {
		if k != "$schema" {
			out = append(out, k)
		}
	}
	return out
}

func decodeMap(t *testing.T, body []byte) map[string]any {
	t.Helper()
	m := map[string]any{}
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("body is not a JSON object: %v\n%s", err, body)
	}
	return m
}

// --- get-profile ------------------------------------------------------------

func TestIDPComponent_GetProfileMatchesGoldenFieldSet(t *testing.T) {
	t.Parallel()
	h, svc := newIDPHarness(t, &compThunder{})

	// Provision a publisher through the real service path so the row carries
	// the full triplet the golden was harvested from.
	if _, _, _, err := svc.EnsureOrgPublisher(context.Background(), "acme", "ada@x.io"); err != nil {
		t.Fatalf("provision publisher: %v", err)
	}

	resp := h.AsOrg("acme").Get(idpPath)
	if resp.Code != 200 {
		t.Fatalf("get profile: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	got := withoutSchema(componenttest.FieldSet(t, resp.Body.String()))
	want := withoutSchema(componenttest.GoldenFieldSet(t, goldenProfile))
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("profile field set drifted from golden:\n got %v\nwant %v", got, want)
	}

	m := decodeMap(t, resp.Body.Bytes())
	// orgId is bound from the TOKEN by the gate, never client input.
	if m["orgId"] != "acme" || m["kind"] != "platform" {
		t.Fatalf("profile identity drifted: %s", resp.Body.String())
	}
	if m["publisherClientId"] != "aep-publisher-acme" || m["publisherSecretRef"] != "secret/aep/acme/idp/publisher" {
		t.Fatalf("publisher fields drifted: %s", resp.Body.String())
	}
	// The live secret is `json:"-"` — it must never reach the wire.
	if strings.Contains(resp.Body.String(), "secret-acme") {
		t.Fatalf("profile response leaked the publisher client secret: %s", resp.Body.String())
	}
}

func TestIDPComponent_GetProfileNotConfiguredShape(t *testing.T) {
	t.Parallel()
	h, _ := newIDPHarness(t, &compThunder{})

	// No profile row yet → a 200 (not a 404) with the "not configured" body so
	// the console renders the setup panel; kind is null.
	resp := h.AsOrg("acme").Get(idpPath)
	if resp.Code != 200 {
		t.Fatalf("get profile (absent): want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	m := decodeMap(t, resp.Body.Bytes())
	if len(m) != 3 || m["orgId"] != "acme" || m["kind"] != nil {
		t.Fatalf("not-configured shape drifted: %s", resp.Body.String())
	}
	if _, ok := m["message"]; !ok {
		t.Fatalf("not-configured body must carry a message: %s", resp.Body.String())
	}
}

func TestIDPComponent_GetProfileRepoFailureMapsToOpaque500(t *testing.T) {
	t.Parallel()
	// A closed DB pool makes GetProfile error; the handler maps ANY load
	// failure to an opaque 500 and must not leak the driver error. dbtest.New
	// skips this under -short, so it is a DB-tier component check.
	d := dbtest.New(t)
	sqlDB, err := d.DB()
	if err != nil {
		t.Fatalf("db handle: %v", err)
	}
	_ = sqlDB.Close() // subsequent queries now fail; dbtest's own cleanup close is a no-op
	svc := idp.NewIDPService(d, &compThunder{}, compPlatform)
	h := componenttest.New(t, componenttest.Options{Deps: api.HumaDeps{IDPSvc: svc}})

	resp := h.AsOrg("acme").Get(idpPath)
	if resp.Code != 500 {
		t.Fatalf("repo failure: want 500, got %d body=%s", resp.Code, resp.Body.String())
	}
	p := componenttest.DecodeProblem(t, resp.Body.String())
	if p.Detail != "failed to load IDP profile" {
		t.Fatalf("500 detail drifted: %q", p.Detail)
	}
	if strings.Contains(resp.Body.String(), "database is closed") || strings.Contains(resp.Body.String(), "sql:") {
		t.Fatalf("500 body leaks the driver error: %s", resp.Body.String())
	}
}

// --- update-profile ---------------------------------------------------------

func TestIDPComponent_UpdateProfileHappyPath(t *testing.T) {
	t.Parallel()
	h, _ := newIDPHarness(t, nil) // no publisher exists yet ⇒ no Thunder cleanup fires

	resp := h.AsOrg("acme").Put(idpPath, `{"kind":"custom","issuer":"https://byo.example","jwksUrl":"https://byo.example/jwks"}`)
	if resp.Code != 200 {
		t.Fatalf("update: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	m := decodeMap(t, resp.Body.Bytes())
	if m["kind"] != "custom" || m["issuer"] != "https://byo.example" || m["jwksUrl"] != "https://byo.example/jwks" {
		t.Fatalf("update body drifted: %s", resp.Body.String())
	}
	if m["orgId"] != "acme" {
		t.Fatalf("update must bind the token org: %s", resp.Body.String())
	}

	// The change persisted — a follow-up GET serves it back.
	st := h.AsOrg("acme").Get(idpPath)
	if sm := decodeMap(t, st.Body.Bytes()); sm["kind"] != "custom" || sm["issuer"] != "https://byo.example" {
		t.Fatalf("update did not persist: %s", st.Body.String())
	}
}

func TestIDPComponent_UpdateProfileInvalidKindIs400(t *testing.T) {
	t.Parallel()
	h, _ := newIDPHarness(t, nil)

	// All three body fields are REQUIRED by the Huma schema (non-pointer, no
	// omitempty) despite their "empty leaves unchanged" doc — so issuer/jwksUrl
	// must be present (empty is fine). kind is a free-form string (no enum), so
	// its validation is the service's, mapped to a 400 (Error400BadRequest(err)).
	resp := h.AsOrg("acme").Put(idpPath, `{"kind":"nonsense","issuer":"","jwksUrl":""}`)
	if resp.Code != 400 {
		t.Fatalf("invalid kind: want 400, got %d body=%s", resp.Code, resp.Body.String())
	}
	p := componenttest.DecodeProblem(t, resp.Body.String())
	if !strings.Contains(p.Detail, `invalid kind "nonsense"`) {
		t.Fatalf("400 detail drifted: %q", p.Detail)
	}
}

func TestIDPComponent_UpdateProfileMissingRequiredFieldsIs422(t *testing.T) {
	t.Parallel()
	h, _ := newIDPHarness(t, nil)

	// Omitting issuer/jwksUrl is a Huma schema 422 (the fields are required by
	// construction) — it never reaches the service. This pins the actual wire
	// contract, which is stricter than the field docs suggest.
	resp := h.AsOrg("acme").Put(idpPath, `{"kind":"custom"}`)
	if resp.Code != 422 {
		t.Fatalf("missing required fields: want 422, got %d body=%s", resp.Code, resp.Body.String())
	}
	p := componenttest.DecodeProblem(t, resp.Body.String())
	if len(p.Errors) == 0 || !strings.Contains(p.Errors[0].Message, "expected required property") {
		t.Fatalf("422 shape drifted: %s", resp.Body.String())
	}
}

// --- rotate (regenerate client secret) --------------------------------------

func TestIDPComponent_RotateHappyPath(t *testing.T) {
	t.Parallel()
	thunder := &compThunder{
		regenFn: func(context.Context, string) (string, error) { return "rotated-secret", nil },
	}
	h, svc := newIDPHarness(t, thunder)
	if _, _, _, err := svc.EnsureOrgPublisher(context.Background(), "acme", "ada@x.io"); err != nil {
		t.Fatalf("provision: %v", err)
	}

	resp := h.AsOrg("acme").Post(idpRotatePath, "")
	if resp.Code != 200 {
		t.Fatalf("rotate: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	m := decodeMap(t, resp.Body.Bytes())
	if m["clientSecret"] != "rotated-secret" {
		t.Fatalf("rotate body drifted: %s", resp.Body.String())
	}
	if len(thunder.regen) != 1 || thunder.regen[0] != "acme" {
		t.Fatalf("rotate must call Thunder once for the token org: %v", thunder.regen)
	}
}

func TestIDPComponent_RotateThunderUnavailableIs503(t *testing.T) {
	t.Parallel()
	// nil Thunder ⇒ RegenerateClientSecret returns ErrIDPThunderUnavailable ⇒
	// the handler maps it to a 503 (distinct from the opaque 500 below).
	h, _ := newIDPHarness(t, nil)

	resp := h.AsOrg("acme").Post(idpRotatePath, "")
	if resp.Code != 503 {
		t.Fatalf("rotate (no thunder): want 503, got %d body=%s", resp.Code, resp.Body.String())
	}
	if p := componenttest.DecodeProblem(t, resp.Body.String()); p.Detail != "Thunder admin client not configured" {
		t.Fatalf("503 detail drifted: %q", p.Detail)
	}
}

func TestIDPComponent_RotateNoPublisherIs500(t *testing.T) {
	t.Parallel()
	// Thunder is wired but no publisher was ever provisioned ⇒ the service
	// errors with a non-sentinel ("no publisher app") ⇒ the handler's opaque
	// 500 branch (NOT the 503).
	h, _ := newIDPHarness(t, &compThunder{})

	resp := h.AsOrg("acme").Post(idpRotatePath, "")
	if resp.Code != 500 {
		t.Fatalf("rotate (no publisher): want 500, got %d body=%s", resp.Code, resp.Body.String())
	}
	if p := componenttest.DecodeProblem(t, resp.Body.String()); p.Detail != "failed to regenerate client secret" {
		t.Fatalf("500 detail drifted: %q", p.Detail)
	}
}

// --- discovery (org-gated but org-unused carve-out) -------------------------

func TestIDPComponent_DiscoveryMatchesGoldenFieldSet(t *testing.T) {
	t.Parallel()
	h, _ := newIDPHarness(t, nil) // discovery never touches Thunder

	// Wire-fake the issuer: DiscoverFromIssuer GETs <issuer>/.well-known/
	// openid-configuration and validates the returned issuer echoes the request.
	var issuerURL string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/.well-known/openid-configuration" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"issuer":"` + issuerURL + `","jwks_uri":"` + issuerURL + `/oauth2/jwks"}`))
	}))
	t.Cleanup(srv.Close)
	issuerURL = srv.URL

	resp := h.AsOrg("acme").Get(idpDiscoverPath + "?issuer=" + issuerURL)
	if resp.Code != 200 {
		t.Fatalf("discovery: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	got := withoutSchema(componenttest.FieldSet(t, resp.Body.String()))
	want := withoutSchema(componenttest.GoldenFieldSet(t, goldenDiscovery))
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("discovery field set drifted from golden:\n got %v\nwant %v", got, want)
	}
	m := decodeMap(t, resp.Body.Bytes())
	if m["issuer"] != issuerURL || m["jwksUrl"] != issuerURL+"/oauth2/jwks" {
		t.Fatalf("discovery body drifted: %s", resp.Body.String())
	}
}

func TestIDPComponent_DiscoveryMissingIssuerIs400(t *testing.T) {
	t.Parallel()
	h, _ := newIDPHarness(t, nil)

	resp := h.AsOrg("acme").Get(idpDiscoverPath)
	if resp.Code != 400 {
		t.Fatalf("discovery (no issuer): want 400, got %d body=%s", resp.Code, resp.Body.String())
	}
	if p := componenttest.DecodeProblem(t, resp.Body.String()); p.Detail != "issuer query param required" {
		t.Fatalf("400 detail drifted: %q", p.Detail)
	}
}

func TestIDPComponent_DiscoveryUpstreamErrorIs502(t *testing.T) {
	t.Parallel()
	h, _ := newIDPHarness(t, nil)

	// An issuer whose well-known endpoint 404s ⇒ DiscoverFromIssuer errors ⇒
	// the handler maps it to a 502 (bad gateway to the upstream IDP).
	srv := httptest.NewServer(http.NotFoundHandler())
	t.Cleanup(srv.Close)

	resp := h.AsOrg("acme").Get(idpDiscoverPath + "?issuer=" + srv.URL)
	if resp.Code != 502 {
		t.Fatalf("discovery (upstream 404): want 502, got %d body=%s", resp.Code, resp.Body.String())
	}
}

// --- the ENFORCE gate (proven once, on a gated op) --------------------------

func TestIDPComponent_NoClaimsDeniedByEnforceGate(t *testing.T) {
	t.Parallel()
	h, _ := newIDPHarness(t, nil)

	resp := h.NoAuth().Get(idpPath)
	if resp.Code != 401 {
		t.Fatalf("no-claims get: want the gate's ENFORCE 401, got %d body=%s", resp.Code, resp.Body.String())
	}
	// Huma aggregates the resolver's gate error into one RFC-9457 problem; the
	// gate's message rides errors[].
	p := componenttest.DecodeProblem(t, resp.Body.String())
	if p.Status != 401 || len(p.Errors) == 0 || !strings.Contains(p.Errors[0].Message, "authentication required") {
		t.Fatalf("gate 401 problem shape drifted: %s", resp.Body.String())
	}
}
