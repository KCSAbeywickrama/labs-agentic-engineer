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

package app_test

// Composition-root wiring proof (D5): Build assembles the REAL service graph
// over a real (migrated, per-test) Postgres and this test asserts the
// dependency-management wiring is live, not stubbed:
//
//   - Build succeeds with a minimal-but-valid config (no OC, no GitHub App,
//     no SM-API — every optional client degrades as documented).
//   - The watcher slice includes the ResourceWatcher (D3).
//   - The mounted /internal/v1/mcp surface answers 401 without a token
//     (mounted + verified — NOT 404-unmounted, NOT 503-unwired) and serves a
//     full JSON-RPC round trip with a minted MCP token, with
//     list_external_resources hitting the REAL A3 repository on the real DB
//     (a row Upserted through the repo comes back through the HTTP surface).

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/app"
	"github.com/wso2/aep/aep-api/internal/config"
	"github.com/wso2/aep/aep-api/internal/feature/codingagent"
	"github.com/wso2/aep/aep-api/internal/platform/auth"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// buildTestConfig is the minimal config Build accepts: a credential key,
// a repo base path, the git provider, and the RS256 task-token key (which
// also gates the MCP mount). Everything optional is left empty and must
// degrade per its documented posture.
func buildTestConfig(t *testing.T) config.Config {
	t.Helper()
	credKey := make([]byte, 32)
	if _, err := rand.Read(credKey); err != nil {
		t.Fatalf("rand: %v", err)
	}
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}
	pemKey := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(priv),
	})
	return config.Config{
		// Required (config.Validate would reject an empty OC base URL and the
		// OC client constructors parse it eagerly). Never dialed during Build.
		PlatformAPI:             config.PlatformAPIConfig{BaseURL: "http://openchoreo.invalid:8195"},
		RepoBasePath:            t.TempDir(),
		CredentialEncryptionKey: base64.StdEncoding.EncodeToString(credKey),
		GitProvider:             "github",
		TaskTokenSigningKey:     string(pemKey),
		TaskTokenIssuer:         "aep-bff",
		TaskTokenAudience:       "git-service",
	}
}

func TestBuild_WiresDependencyManagement(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	cfg := buildTestConfig(t)

	a, err := app.Build(cfg, db)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}

	// D3: the resource-readiness watcher must be part of the launched set.
	foundResourceWatcher := false
	for _, w := range a.Watchers {
		if _, ok := w.(*codingagent.ResourceWatcher); ok {
			foundResourceWatcher = true
		}
	}
	if !foundResourceWatcher {
		t.Errorf("Watchers = %T…, want a *codingagent.ResourceWatcher among them", a.Watchers)
	}

	srv := httptest.NewServer(a.Handler)
	t.Cleanup(srv.Close)

	// C5 mount posture: no token → 401 from the verifier. 404 would mean the
	// surface never mounted (no TaskTokens); 503 would mean the MCP ports were
	// left nil (the pre-D5 state).
	resp := postMCP(t, srv, "", `{"jsonrpc":"2.0","id":1,"method":"initialize"}`)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("MCP without token: status = %d, want 401", resp.StatusCode)
	}

	// Mint an MCP token with a parallel manager over the SAME key + issuer —
	// kid is derived from the public key, so Build's manager verifies it.
	mgr, err := auth.NewTaskTokenManager(auth.TaskTokenConfig{
		PrivateKey: cfg.TaskTokenSigningKey,
		Issuer:     cfg.TaskTokenIssuer,
		Audience:   cfg.TaskTokenAudience,
		TTL:        time.Hour,
	})
	if err != nil {
		t.Fatalf("NewTaskTokenManager: %v", err)
	}
	tok, err := mgr.IssueMCPToken("org-d5")
	if err != nil {
		t.Fatalf("IssueMCPToken: %v", err)
	}

	// initialize → 200 proves the MCP ports are wired (a nil
	// MCPExternalResources would 503 before any method dispatch).
	resp = postMCP(t, srv, tok, `{"jsonrpc":"2.0","id":1,"method":"initialize"}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("MCP initialize: status = %d, want 200", resp.StatusCode)
	}

	// End-to-end through the REAL A3 repository: a row Upserted directly via
	// the repo (same DB Build wired) must come back through the HTTP surface,
	// scoped to the token's org.
	repo := repositories.NewExternalResourceRepository(db)
	if _, err := repo.Upsert(t.Context(), "org-d5", "salesforce", "CRM",
		[]models.ConfigKey{{Key: "SALESFORCE_TOKEN", Secret: true}}); err != nil {
		t.Fatalf("seed Upsert: %v", err)
	}
	resp = postMCP(t, srv, tok,
		`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_external_resources","arguments":{}}}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("MCP tools/call: status = %d, want 200", resp.StatusCode)
	}
	var envelope struct {
		Result struct {
			Content []struct {
				Text string `json:"text"`
			} `json:"content"`
		} `json:"result"`
		Error *json.RawMessage `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if envelope.Error != nil {
		t.Fatalf("unexpected JSON-RPC error: %s", *envelope.Error)
	}
	if len(envelope.Result.Content) == 0 {
		t.Fatalf("tools/call returned no content")
	}
	text := envelope.Result.Content[0].Text
	if !bytes.Contains([]byte(text), []byte(`"salesforce"`)) ||
		!bytes.Contains([]byte(text), []byte(`"SALESFORCE_TOKEN"`)) {
		t.Errorf("tool payload = %q, want the seeded resource + its config key", text)
	}
}

// TestBuild_NoTaskTokens_MCPUnmounted pins the degraded posture: without the
// signing key the MCP surface is not mounted at all (404, not 401/503) and
// Build still succeeds.
func TestBuild_NoTaskTokens_MCPUnmounted(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	cfg := buildTestConfig(t)
	cfg.TaskTokenSigningKey = ""

	a, err := app.Build(cfg, db)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	srv := httptest.NewServer(a.Handler)
	t.Cleanup(srv.Close)

	resp := postMCP(t, srv, "", `{"jsonrpc":"2.0","id":1,"method":"initialize"}`)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("MCP without token manager: status = %d, want 404 (unmounted)", resp.StatusCode)
	}
}

// postMCP POSTs a JSON-RPC body to the mounted MCP path with the given bearer.
func postMCP(t *testing.T, srv *httptest.Server, bearer, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/internal/v1/mcp", bytes.NewReader([]byte(body)))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST mcp: %v", err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}
