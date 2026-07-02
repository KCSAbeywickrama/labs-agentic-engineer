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
// AnthropicCredentialService — over a pristine dbtest Postgres with the REAL
// AES-GCM store, its Anthropic probe faked at the HTTP boundary — behind the
// REAL production chain (faked auth at the jwt.WithClaims seam → orgensure →
// Huma parsing/validation → tenant gate ENFORCE → mapCredentialError), driven
// in-process via componenttest. The DB rides along because Connect's upsert
// IS the service (no store port to fake), so this file skips under -short
// like the dbtest tier. Body shapes mirror the harvested golden
// testdata/harvest/golden/get_org_credentials_anthropic.json.
//
// The gate's no-claims 401 is deliberately NOT re-proven here — it is covered
// once for the orgcreds feature by the GitHub-credential component tests
// (each behavior at one tier).
//
// External test package: the harness imports api, which imports orgcreds — an
// in-package test file would be an import cycle.
package orgcreds_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/api"
	"github.com/wso2/aep/aep-api/internal/credentials"
	"github.com/wso2/aep/aep-api/internal/feature/orgcreds"
	"github.com/wso2/aep/aep-api/internal/platform/componenttest"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
)

const (
	anthropicComponentPath = "/api/v1/org/credentials/anthropic"
	anthropicComponentKey  = "sk-ant-api03-QwErTyUiOpAsDfGhJkLzXcVbNm-comp-5678"
	anthropicComponentAES  = "fedcba9876543210fedcba9876543210"
)

// newAnthropicHarness assembles the real chain around the REAL service: dbtest
// Postgres + real encrypted store + a fake Anthropic API answering apiStatus;
// wpClient nil (degraded mode, pinned at the dbtest tier).
func newAnthropicHarness(t *testing.T, apiStatus int) *componenttest.Harness {
	t.Helper()
	db := dbtest.New(t)
	store, err := credentials.NewDBStore(db, []byte(anthropicComponentAES))
	if err != nil {
		t.Fatalf("real DBStore: %v", err)
	}
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(apiStatus)
		_, _ = w.Write([]byte(`{"id":"msg_fake"}`))
	}))
	t.Cleanup(fake.Close)
	svc := orgcreds.NewAnthropicCredentialService(db, store, nil).WithAnthropicAPIBase(fake.URL)
	return componenttest.New(t, componenttest.Options{Deps: api.HumaDeps{AnthropicSvc: svc}})
}

// anthropicProblem is the RFC-9457 body Huma serves for every error.
type anthropicProblem struct {
	Title  string `json:"title"`
	Status int    `json:"status"`
	Detail string `json:"detail"`
	Errors []struct {
		Message  string `json:"message"`
		Location string `json:"location"`
	} `json:"errors"`
}

func anthropicDecodeProblem(t *testing.T, body string) anthropicProblem {
	t.Helper()
	var p anthropicProblem
	if err := json.Unmarshal([]byte(body), &p); err != nil {
		t.Fatalf("not an RFC-9457 problem body: %v\n%s", err, body)
	}
	return p
}

func anthropicDecodeMap(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("body is not a JSON object: %v\n%s", err, body)
	}
	return m
}

func anthropicSortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// anthropicGoldenKeys loads the harvested connected-status golden and returns
// its sorted field set — the values are scrubbed; the SHAPE is the contract.
func anthropicGoldenKeys(t *testing.T) []string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "testdata", "harvest", "golden", "get_org_credentials_anthropic.json"))
	if err != nil {
		t.Fatalf("read golden: %v", err)
	}
	return anthropicSortedKeys(anthropicDecodeMap(t, raw))
}

func anthropicConnectBody(key string) string {
	return `{"apiKey":"` + key + `"}`
}

func TestAnthropicComponent_ConnectValidReturnsActiveProjection(t *testing.T) {
	t.Parallel()
	h := newAnthropicHarness(t, http.StatusOK)

	resp := h.AsOrg("acme").Post(anthropicComponentPath, anthropicConnectBody(anthropicComponentKey))
	// No DefaultStatus on the op → Huma's 200 (unlike project create's 201).
	if resp.Code != 200 {
		t.Fatalf("connect: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	m := anthropicDecodeMap(t, resp.Body.Bytes())
	// ocOrgId is bound from the TOKEN by the gate — never from client input.
	if m["ocOrgId"] != "acme" || m["status"] != "active" {
		t.Fatalf("connect body identity: %s", resp.Body.String())
	}
	if m["keyPrefix"] != anthropicComponentKey[:15] {
		t.Fatalf("keyPrefix: got %v, want the 15-char golden-style truncation %q", m["keyPrefix"], anthropicComponentKey[:15])
	}
	if m["keyLast4"] != anthropicComponentKey[len(anthropicComponentKey)-4:] {
		t.Fatalf("keyLast4: got %v", m["keyLast4"])
	}
	// The raw key must never echo back.
	if strings.Contains(resp.Body.String(), anthropicComponentKey) {
		t.Fatalf("connect response leaks the full key: %s", resp.Body.String())
	}
}

func TestAnthropicComponent_ConnectRejections(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name       string
		apiStatus  int    // what the fake Anthropic answers
		body       string // request body
		wantStatus int
		wantDetail string // exact when non-empty and no wantInError
		wantInErr  string // substring expected in errors[] (422 shape)
	}{
		{
			// apiKey property ABSENT → Huma schema validation 422; never
			// reaches the service.
			name: "missing apiKey is 422", apiStatus: http.StatusOK,
			body: `{}`, wantStatus: 422, wantInErr: "expected required property apiKey to be present",
		},
		{
			// apiKey PRESENT but empty → the service guard's 400, message
			// preserved by mapCredentialError.
			name: "empty apiKey is 400", apiStatus: http.StatusOK,
			body: anthropicConnectBody(""), wantStatus: 400, wantDetail: "apiKey is required",
		},
		{
			name: "malformed key is 400", apiStatus: http.StatusOK,
			body: anthropicConnectBody("sk-oai-000000000000000000000000"), wantStatus: 400,
			wantDetail: "API key does not look like an Anthropic key (expected prefix 'sk-ant-')",
		},
		{
			name: "upstream 401 is 400 with the cause preserved", apiStatus: http.StatusUnauthorized,
			body: anthropicConnectBody(anthropicComponentKey), wantStatus: 400,
			wantDetail: "Anthropic rejected the key (401 Unauthorized)",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			h := newAnthropicHarness(t, tc.apiStatus)
			resp := h.AsOrg("acme").Post(anthropicComponentPath, tc.body)
			if resp.Code != tc.wantStatus {
				t.Fatalf("want %d, got %d body=%s", tc.wantStatus, resp.Code, resp.Body.String())
			}
			p := anthropicDecodeProblem(t, resp.Body.String())
			if tc.wantDetail != "" && p.Detail != tc.wantDetail {
				t.Fatalf("detail: got %q want %q", p.Detail, tc.wantDetail)
			}
			if tc.wantInErr != "" && (len(p.Errors) == 0 || !strings.Contains(p.Errors[0].Message, tc.wantInErr)) {
				t.Fatalf("errors[] missing %q: %s", tc.wantInErr, resp.Body.String())
			}
			// Any rejection leaves the org disconnected.
			st := h.AsOrg("acme").Get(anthropicComponentPath)
			if m := anthropicDecodeMap(t, st.Body.Bytes()); m["status"] != "not_connected" {
				t.Fatalf("rejected connect must leave no row: %s", st.Body.String())
			}
		})
	}
}

func TestAnthropicComponent_StatusConnectedMatchesGoldenFieldSet(t *testing.T) {
	t.Parallel()
	h := newAnthropicHarness(t, http.StatusOK)
	if resp := h.AsOrg("acme").Post(anthropicComponentPath, anthropicConnectBody(anthropicComponentKey)); resp.Code != 200 {
		t.Fatalf("connect: %d body=%s", resp.Code, resp.Body.String())
	}

	resp := h.AsOrg("acme").Get(anthropicComponentPath)
	if resp.Code != 200 {
		t.Fatalf("status: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	m := anthropicDecodeMap(t, resp.Body.Bytes())

	// The field SET is the golden's, exactly — {connectedAt, keyLast4,
	// keyPrefix, lastValidatedAt, ocOrgId, status}. The golden's values are
	// scrubbed; the semantics are asserted below.
	got, want := anthropicSortedKeys(m), anthropicGoldenKeys(t)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("connected status field set drifted from golden:\n got %v\nwant %v", got, want)
	}
	if m["status"] != "active" || m["ocOrgId"] != "acme" {
		t.Fatalf("status semantics: %s", resp.Body.String())
	}
	// Golden prefix semantics: "sk-ant-api03-XX"-style — the first 15 chars,
	// last 4 chars, never the whole key.
	prefix, _ := m["keyPrefix"].(string)
	last4, _ := m["keyLast4"].(string)
	if prefix != anthropicComponentKey[:15] || last4 != anthropicComponentKey[len(anthropicComponentKey)-4:] {
		t.Fatalf("preview semantics drifted: prefix=%q last4=%q", prefix, last4)
	}
	if strings.Contains(resp.Body.String(), anthropicComponentKey) {
		t.Fatalf("status leaks the full key: %s", resp.Body.String())
	}
}

func TestAnthropicComponent_StatusNotConnectedShape(t *testing.T) {
	t.Parallel()
	h := newAnthropicHarness(t, http.StatusOK)

	// Not connected is a 200 with the minimal two-field body — NOT a 404 —
	// so the console can render the "Configure" panel without an error.
	resp := h.AsOrg("acme").Get(anthropicComponentPath)
	if resp.Code != 200 {
		t.Fatalf("status: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	m := anthropicDecodeMap(t, resp.Body.Bytes())
	if len(m) != 2 || m["ocOrgId"] != "acme" || m["status"] != "not_connected" {
		t.Fatalf("not-connected shape drifted: %s", resp.Body.String())
	}
}

func TestAnthropicComponent_DisconnectIsIdempotent(t *testing.T) {
	t.Parallel()
	h := newAnthropicHarness(t, http.StatusOK)
	if resp := h.AsOrg("acme").Post(anthropicComponentPath, anthropicConnectBody(anthropicComponentKey)); resp.Code != 200 {
		t.Fatalf("connect: %d body=%s", resp.Code, resp.Body.String())
	}

	resp := h.AsOrg("acme").Delete(anthropicComponentPath)
	if resp.Code != 200 {
		t.Fatalf("disconnect: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	m := anthropicDecodeMap(t, resp.Body.Bytes())
	if len(m) != 1 || m["status"] != "disconnected" {
		t.Fatalf("disconnect body drifted: %s", resp.Body.String())
	}

	// The row is gone…
	st := h.AsOrg("acme").Get(anthropicComponentPath)
	if m := anthropicDecodeMap(t, st.Body.Bytes()); m["status"] != "not_connected" {
		t.Fatalf("status after disconnect: %s", st.Body.String())
	}
	// …and a second disconnect serves the same success (idempotent).
	resp = h.AsOrg("acme").Delete(anthropicComponentPath)
	if resp.Code != 200 {
		t.Fatalf("second disconnect: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if m := anthropicDecodeMap(t, resp.Body.Bytes()); m["status"] != "disconnected" {
		t.Fatalf("second disconnect body drifted: %s", resp.Body.String())
	}
}
