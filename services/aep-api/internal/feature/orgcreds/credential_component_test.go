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

// COMPONENT tier (bff-component-testing.md §4): the REAL orgcreds GitHub
// operations behind the REAL production handler chain — global middleware →
// faked auth at the jwt.WithClaims seam → orgensure → Huma parsing/validation →
// the tenant gate in ENFORCE → mapCredentialError — driven in-process via the
// componenttest harness. The feature's own CredentialService/OrgDisconnectService
// run for real over a pristine Postgres (dbtest.New, so these ride `make
// test-db` and self-skip under -short); only the out-of-process GitHub API is
// faked. This is the sanctioned Component+DB flavor (the caller builds the
// DB-backed service and puts it in Deps).
//
// External test package: the harness imports api, which imports orgcreds — an
// in-package test file would be an import cycle (mirrors project_component_test.go).
//
// SCOPE of the mapCredentialError coverage here: only the branches an orggithub
// route actually reaches (400 ValidationError, 409 ConflictError) plus the
// route-owned 503 (start-connect). The full 404/503/500 table — including the
// 500 message-preservation leak — is pinned exhaustively at the unit tier
// against mapCredentialError directly (credential_service_test.go), because the
// GitHub connect/status/disconnect routes never surface those through the mapper.
package orgcreds_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/wso2/aep/aep-api/internal/api"
	"github.com/wso2/aep/aep-api/internal/credentials"
	"github.com/wso2/aep/aep-api/internal/feature/orgcreds"
	"github.com/wso2/aep/aep-api/internal/platform/componenttest"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
	"github.com/wso2/aep/aep-api/models"
)

const base = "/api/v1/org/credentials/github"

const componentAESKey = "0123456789abcdef0123456789abcdef"
const componentEnvSecret = "platform-webhook-secret"

// fakeGH is the external-package fake api.github.com (the internal stub isn't
// exported). Register status+body per "METHOD /path"; unregistered → 404.
type fakeGH struct {
	*httptest.Server
	mu     sync.Mutex
	routes map[string]http.HandlerFunc
}

func newFakeGH(t *testing.T) *fakeGH {
	t.Helper()
	g := &fakeGH{routes: map[string]http.HandlerFunc{}}
	g.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		g.mu.Lock()
		h := g.routes[r.Method+" "+r.URL.Path]
		g.mu.Unlock()
		if h == nil {
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"message":"Not Found"}`)
			return
		}
		h(w, r)
	}))
	t.Cleanup(g.Server.Close)
	return g
}

func (g *fakeGH) on(method, path string, code int, body string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.routes[method+" "+path] = func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(code)
		_, _ = io.WriteString(w, body)
	}
}

// patHappy registers the responses a valid PAT connect for login "ada" needs.
func (g *fakeGH) patHappy() {
	g.on("GET", "/user", 200, `{"login":"ada","name":"Ada","email":"ada@x.io"}`)
	g.on("GET", "/orgs/ada/repos", 200, `[]`)
}

// newHarness assembles the real handler with the REAL DB-backed credential
// services over a pristine per-test Postgres and a fake GitHub. GitHubAppClientID
// is left empty (start-connect 503). Returns the db + fake so tests can seed
// rows / program GitHub.
func newHarness(t *testing.T) (*componenttest.Harness, *gorm.DB, *fakeGH) {
	t.Helper()
	db := dbtest.New(t) // self-skips under -short
	gh := newFakeGH(t)

	store, err := credentials.NewDBStore(db, []byte(componentAESKey))
	if err != nil {
		t.Fatalf("NewDBStore: %v", err)
	}
	minter, err := credentials.NewAppTokenMinter(nil)
	if err != nil {
		t.Fatalf("NewAppTokenMinter: %v", err)
	}
	credSvc := orgcreds.NewCredentialService(db, store, minter, componentEnvSecret, "", "", nil).WithGitHubAPIBase(gh.URL)
	// Tasks are GitHub issues now (no task cascade on disconnect); the service
	// just finalizes the credential.
	disconnectSvc := orgcreds.NewOrgDisconnectService(db, credSvc, nil)
	bearerSvc := orgcreds.NewBearerService("state-key", time.Minute)

	h := componenttest.New(t, componenttest.Options{Deps: api.HumaDeps{
		CredentialSvc: credSvc,
		DisconnectSvc: disconnectSvc,
		BearerSvc:     bearerSvc,
		// GitHubAppClientID intentionally empty → start-connect 503.
	}})
	return h, db, gh
}

// problem is the RFC-9457 body Huma serves for every error.
type problem struct {
	Title  string `json:"title"`
	Status int    `json:"status"`
	Detail string `json:"detail"`
	Errors []struct {
		Message string `json:"message"`
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

func decodeMap(t *testing.T, body string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(body), &m); err != nil {
		t.Fatalf("decode body: %v\n%s", err, body)
	}
	return m
}

// insertAppRow seeds an active app-installation row directly (satisfying the
// CHECK constraints) so the cross-mode conflict path can be driven.
func insertAppRow(t *testing.T, db *gorm.DB, ocOrgID string, installID int64) {
	t.Helper()
	id := installID
	if err := db.Create(&models.OrgCredential{
		OcOrgID:        ocOrgID,
		Kind:           "app-installation",
		GitHubLogin:    "acme-org",
		IdentityName:   "AEP Bot",
		IdentityEmail:  "bot@aep.dev",
		IdentityLogin:  "aep[bot]",
		InstallationID: &id,
		Status:         "active",
		ConnectedAt:    time.Now().UTC(),
	}).Error; err != nil {
		t.Fatalf("seed app row: %v", err)
	}
}

func TestOrgGitHubComponent_Status_NotConnected(t *testing.T) {
	t.Parallel()
	h, _, _ := newHarness(t)

	resp := h.AsOrg("acme").Get(base)
	if resp.Code != 200 {
		t.Fatalf("status not-connected: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	m := decodeMap(t, resp.Body.String())
	if m["ocOrgId"] != "acme" || m["status"] != "not_connected" || m["kind"] != "" {
		t.Fatalf("not-connected shape: %v", m)
	}
}

func TestOrgGitHubComponent_ConnectPAT_HappyThenStatus(t *testing.T) {
	t.Parallel()
	h, _, gh := newHarness(t)
	gh.patHappy()

	resp := h.AsOrg("acme").Post(base+"/pat", `{"pat":"ghp_live","githubLogin":"ada"}`)
	if resp.Code != 200 {
		t.Fatalf("connect pat: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	m := decodeMap(t, resp.Body.String())
	if m["kind"] != "user-pat" || m["status"] != "active" || m["identityLogin"] != "ada" {
		t.Fatalf("connect projection: %v", m)
	}

	// The row is now visible via a subsequent status GET (full projection).
	resp = h.AsOrg("acme").Get(base)
	if resp.Code != 200 {
		t.Fatalf("status after connect: got %d body=%s", resp.Code, resp.Body.String())
	}
	m = decodeMap(t, resp.Body.String())
	if m["status"] != "active" || m["kind"] != "user-pat" || m["ocOrgId"] != "acme" {
		t.Fatalf("status projection: %v", m)
	}
}

func TestOrgGitHubComponent_ConnectPAT_InvalidPAT_400(t *testing.T) {
	t.Parallel()
	h, _, gh := newHarness(t)
	gh.on("GET", "/user", 401, `{"message":"Bad credentials"}`)

	resp := h.AsOrg("acme").Post(base+"/pat", `{"pat":"bad","githubLogin":"ada"}`)
	if resp.Code != 400 {
		t.Fatalf("invalid pat: want 400, got %d body=%s", resp.Code, resp.Body.String())
	}
	// The ValidationError message is preserved in the problem detail.
	if p := decodeProblem(t, resp.Body.String()); p.Detail != "PAT is not a valid GitHub token" {
		t.Fatalf("400 detail: %q", p.Detail)
	}
}

func TestOrgGitHubComponent_ConnectPAT_Validation(t *testing.T) {
	t.Parallel()
	h, _, _ := newHarness(t)

	// pat KEY absent → Huma schema-required 422 (never reaches the handler).
	resp := h.AsOrg("acme").Post(base+"/pat", `{}`)
	if resp.Code != 422 {
		t.Fatalf("missing pat key: want 422, got %d body=%s", resp.Code, resp.Body.String())
	}
	// pat PRESENT but empty → handler guard's 400 (pat_missing).
	resp = h.AsOrg("acme").Post(base+"/pat", `{"pat":"","githubLogin":"ada"}`)
	if resp.Code != 400 {
		t.Fatalf("empty pat: want 400, got %d body=%s", resp.Code, resp.Body.String())
	}
	if p := decodeProblem(t, resp.Body.String()); p.Detail != "PAT is required" {
		t.Fatalf("400 detail: %q", p.Detail)
	}
}

func TestOrgGitHubComponent_ConnectPAT_CrossModeConflict_409(t *testing.T) {
	t.Parallel()
	h, db, gh := newHarness(t)
	gh.patHappy()
	insertAppRow(t, db, "acme", 4242) // existing active app-installation row

	resp := h.AsOrg("acme").Post(base+"/pat", `{"pat":"ghp","githubLogin":"ada"}`)
	if resp.Code != 409 {
		t.Fatalf("cross-mode: want 409, got %d body=%s", resp.Code, resp.Body.String())
	}
	if p := decodeProblem(t, resp.Body.String()); !strings.Contains(p.Detail, "disconnect before connecting user-pat") {
		t.Fatalf("409 detail: %q", p.Detail)
	}
}

func TestOrgGitHubComponent_Disconnect(t *testing.T) {
	t.Parallel()
	h, _, gh := newHarness(t)
	gh.patHappy()

	// Connect, then disconnect → {"status":"disconnected"}.
	if resp := h.AsOrg("acme").Post(base+"/pat", `{"pat":"ghp","githubLogin":"ada"}`); resp.Code != 200 {
		t.Fatalf("connect: %d %s", resp.Code, resp.Body.String())
	}
	resp := h.AsOrg("acme").Delete(base)
	if resp.Code != 200 {
		t.Fatalf("disconnect: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if m := decodeMap(t, resp.Body.String()); m["status"] != "disconnected" {
		t.Fatalf("disconnect body: %v", m)
	}
	// A second disconnect on the now-disconnected row is idempotent (the row
	// still exists in status=disconnected, so Phase A returns cleanly).
	resp = h.AsOrg("acme").Delete(base)
	if resp.Code != 200 || decodeMap(t, resp.Body.String())["status"] != "disconnected" {
		t.Fatalf("idempotent disconnect: %d %s", resp.Code, resp.Body.String())
	}
}

func TestOrgGitHubComponent_Disconnect_NeverConnected_NotConnected(t *testing.T) {
	t.Parallel()
	h, _, _ := newHarness(t)

	// No row at all → ErrOrgNotFound → {"status":"not_connected"} (200).
	resp := h.AsOrg("acme").Delete(base)
	if resp.Code != 200 {
		t.Fatalf("disconnect never-connected: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if m := decodeMap(t, resp.Body.String()); m["status"] != "not_connected" {
		t.Fatalf("never-connected body: %v", m)
	}
}

func TestOrgGitHubComponent_StartConnect_503(t *testing.T) {
	t.Parallel()
	h, _, _ := newHarness(t)

	// GitHubAppClientID is unset → the OAuth-driven connect start is 503.
	resp := h.AsOrg("acme").Post(base+"/connect/start", `{}`)
	if resp.Code != 503 {
		t.Fatalf("start-connect: want 503, got %d body=%s", resp.Code, resp.Body.String())
	}
}

func TestOrgGitHubComponent_NoAuth_401(t *testing.T) {
	t.Parallel()
	h, _, _ := newHarness(t)

	// Tokenless org-scoped request → the gate's ENFORCE no-claims 401 (NOT the
	// verifier's rejection; the harness fakes the verifier away — see §3).
	resp := h.NoAuth().Get(base)
	if resp.Code != 401 {
		t.Fatalf("no-auth: want gate 401, got %d body=%s", resp.Code, resp.Body.String())
	}
}
