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

package codingagent

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/clustergatewayproxy"
)

// TestDispatcher_Dispatch_AppliesExternalSecretsWithRefsPresent pins that the
// proxy Dispatcher still builds and applies per-run ExternalSecrets when
// Anthropic/GitHub SR triplets are populated (refs-only secret delivery path).
func TestDispatcher_Dispatch_AppliesExternalSecretsWithRefsPresent(t *testing.T) {
	var esBodies []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/externalsecrets"):
			body, _ := io.ReadAll(r.Body)
			var obj map[string]any
			if err := json.Unmarshal(body, &obj); err != nil {
				t.Errorf("ExternalSecret body not JSON: %v", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			esBodies = append(esBodies, obj)
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"metadata":{"resourceVersion":"1"}}`))
		case r.Method == http.MethodPost:
			// Namespace, ServiceAccount, Job
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"metadata":{"resourceVersion":"1"}}`))
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusInternalServerError)
		}
	}))
	defer srv.Close()

	d := New(clustergatewayproxy.New(clustergatewayproxy.Config{BaseURL: srv.URL}))
	orgUUID := "d3adbeef-1234-4321-abcd-c0ffee123456"
	runName, err := d.Dispatch(context.Background(), Inputs{
		OrgUUID:                orgUUID,
		ClusterSecretStoreName: "default",
		AnthropicSR: SecretRef{
			SecretRefName: "sr-anthropic",
			KVPath:        "user-app-secrets/org/anthropic",
			Property:      "api-key",
		},
		GitHubSR: SecretRef{
			SecretRefName: "sr-github",
			KVPath:        "user-app-secrets/org/github-pat",
			Property:      "token",
		},
		Job: JobInputs{
			RunName:       "ca-run1",
			TaskID:        "exec-1",
			OrgID:         "acme",
			ProjectID:     "widgets",
			ComponentName: "svc",
			RunnerImage:   "runner:1",
			RepoURL:       "https://git.example/acme/widgets.git",
			Prompt:        "implement",
			IdentityName:  "bot",
			IdentityEmail: "bot@example.com",
			GitServiceURL: "http://git",
			CallbackURL:   "http://platform",
		},
	})
	if err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	if runName != "ca-run1" {
		t.Fatalf("runName = %q, want ca-run1", runName)
	}
	if len(esBodies) != 2 {
		t.Fatalf("expected 2 ExternalSecret applies (anthropic+github), got %d", len(esBodies))
	}
	for i, obj := range esBodies {
		if kind, _ := obj["kind"].(string); kind != "ExternalSecret" {
			t.Errorf("es[%d] kind = %v, want ExternalSecret", i, obj["kind"])
		}
		spec, _ := obj["spec"].(map[string]any)
		if spec == nil {
			t.Fatalf("es[%d] missing spec", i)
		}
		data, _ := spec["data"].([]any)
		if len(data) == 0 {
			t.Errorf("es[%d] expected non-empty data entries", i)
		}
	}
	joined := ""
	for _, obj := range esBodies {
		b, _ := json.Marshal(obj)
		joined += string(b)
	}
	if !strings.Contains(joined, "user-app-secrets/org/anthropic") {
		t.Error("anthropic ExternalSecret must reference AnthropicSR.KVPath")
	}
	if !strings.Contains(joined, "user-app-secrets/org/github-pat") {
		t.Error("github ExternalSecret must reference GitHubSR.KVPath")
	}
}

// The env var an ExternalSecret materialises the Anthropic credential under is
// what decides which credential Claude Code actually uses. Claude Code ranks
// ANTHROPIC_API_KEY above CLAUDE_CODE_OAUTH_TOKEN, so mounting the wrong name
// (or both) means a subscription token is ignored and the org's default key is
// billed instead — silently, with a green run. That makes this string the one
// worth pinning.
func TestDispatcher_AnthropicEnvVar_ChosenByCredentialKind(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name  string
		given SecretRef
		want  string
	}{
		{
			name:  "reuse / API key defaults to ANTHROPIC_API_KEY",
			given: SecretRef{SecretRefName: "sr", KVPath: "kv", Property: "api-key"},
			want:  "ANTHROPIC_API_KEY",
		},
		{
			name:  "an explicit API-key mount stays ANTHROPIC_API_KEY",
			given: SecretRef{SecretRefName: "sr", KVPath: "kv", Property: "api-key", EnvVar: "ANTHROPIC_API_KEY"},
			want:  "ANTHROPIC_API_KEY",
		},
		{
			name:  "an OAuth token mounts as CLAUDE_CODE_OAUTH_TOKEN",
			given: SecretRef{SecretRefName: "sr", KVPath: "kv", Property: "api-key", EnvVar: "CLAUDE_CODE_OAUTH_TOKEN"},
			want:  "CLAUDE_CODE_OAUTH_TOKEN",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := (Inputs{AnthropicSR: tc.given}).AnthropicEnvVar(); got != tc.want {
				t.Fatalf("AnthropicEnvVar() = %q, want %q", got, tc.want)
			}
		})
	}
}

// End-to-end through the real manifest builder: an OAuth-token credential must
// produce an ExternalSecret whose secretKey is CLAUDE_CODE_OAUTH_TOKEN, and the
// manifest must carry NO ANTHROPIC_API_KEY entry at all.
func TestDispatcher_OAuthTokenExternalSecret_OmitsApiKeyVar(t *testing.T) {
	t.Parallel()
	manifest, err := BuildExternalSecret(ExternalSecretInputs{
		Name:                   "ca-run1-anthropic-es",
		Namespace:              "ns",
		TargetSecretName:       "ca-run1-anthropic",
		ClusterSecretStoreName: "default",
		LocalKey:               "CLAUDE_CODE_OAUTH_TOKEN",
		RemoteRefKey:           "user-app-secrets/org/anthropic-coding",
		RemoteRefProperty:      "api-key",
	})
	if err != nil {
		t.Fatalf("BuildExternalSecret: %v", err)
	}
	b, _ := json.Marshal(manifest)
	got := string(b)
	if !strings.Contains(got, "CLAUDE_CODE_OAUTH_TOKEN") {
		t.Fatalf("manifest must mount the token variable: %s", got)
	}
	if strings.Contains(got, "ANTHROPIC_API_KEY") {
		t.Fatalf("ANTHROPIC_API_KEY would outrank the token and win: %s", got)
	}
}
