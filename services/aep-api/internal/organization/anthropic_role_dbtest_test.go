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

package organization_test

// DBTEST tier — the two credential roles over the same real Postgres + real
// AES-GCM store as anthropic_dbtest_test.go: the org's API key (default) and
// the Claude subscription the coding agent may bill instead (coding, an
// oauth_token only — ADR-0034). What is pinned here:
//
//   - the two are independent rows with independent secret bytes, so rotating
//     the key cannot touch the token;
//   - the schema itself refuses a role paired with the wrong kind;
//   - ResolveCodingSecretRef — the subscription only on Claude Code, the API
//     key otherwise, and failing closed on a broken subscription;
//   - EffectiveKey — the spec agents' reader — stays default-only.

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/organization"
	"github.com/wso2/aep/aep-api/internal/platform/orgconfig"
)

// anthropicDBOAuthToken is shaped like a `claude setup-token` result. The probe
// is faked at the HTTP boundary, so only the SHAPE has to be realistic.
const anthropicDBOAuthToken = "sk-ant-oat01-SubscriptionTokenForCodingRuns-9f2c"

// stampTriplet fakes what the SM-API mirror would have written, so the
// resolution tests can exercise ResolveCodingSecretRef against real rows.
func stampTriplet(t *testing.T, repo organization.OrgAnthropicRepository, org string, role organization.AnthropicRole, name, kvPath, property string) {
	t.Helper()
	cols := map[string]any{
		"secret_ref_name":     name,
		"secret_ref_kv_path":  kvPath,
		"secret_ref_property": property,
	}
	if err := repo.UpdateColumns(context.Background(), org, role, cols); err != nil {
		t.Fatalf("stamp triplet %s/%s: %v", org, role, err)
	}
}

// keyAndSubscription connects the key and a subscription, both mirrored.
func keyAndSubscription(t *testing.T, c *cardDB) {
	t.Helper()
	c.connect(t, "acme", anthropicUnitKey)
	stampTriplet(t, c.repo, "acme", organization.AnthropicRoleDefault,
		"acme-anthropic", "user-app-secrets/wc-acme/acme-anthropic", "api-key")
	c.patch(t, "acme", subscriptionPatch(anthropicDBOAuthToken))
	stampTriplet(t, c.repo, "acme", organization.AnthropicRoleCoding,
		"acme-anthropic-coding", "user-app-secrets/wc-acme/acme-anthropic-coding", "api-key")
}

func TestAnthropicRoles_KeyAndSubscriptionAreIndependent_DB(t *testing.T) {
	t.Parallel()
	c := newCardDB(t, http.StatusOK)
	ctx := context.Background()

	c.connect(t, "acme", anthropicUnitKey)
	c.patch(t, "acme", subscriptionPatch(anthropicDBOAuthToken))
	before, err := c.svc.Status(ctx, "acme", organization.AnthropicRoleCoding)
	if err != nil || before.CredentialKind != organization.AnthropicCredentialOAuth {
		t.Fatalf("subscription row: %+v (%v), want an oauth_token", before, err)
	}

	// Rotating the key must not disturb the subscription.
	c.connect(t, "acme", anthropicDBKey2)
	after, err := c.svc.Status(ctx, "acme", organization.AnthropicRoleCoding)
	if err != nil || after.KeyLast4 != before.KeyLast4 || !after.ConnectedAt.Equal(before.ConnectedAt) {
		t.Fatalf("key rotation mutated the subscription row: before %+v, after %+v (%v)", before, after, err)
	}
	if got, err := c.store.Get(ctx, "acme", "anthropic/coding-key"); err != nil || string(got) != anthropicDBOAuthToken {
		t.Fatalf("key rotation clobbered the token bytes: %q (%v)", string(got), err)
	}
	if got, err := c.store.Get(ctx, "acme", "anthropic/key"); err != nil || string(got) != anthropicDBKey2 {
		t.Fatalf("key did not rotate: %q (%v)", string(got), err)
	}
}

// The CHECK is the last line: default holds an api_key, coding an oauth_token,
// and nothing else lands whatever path wrote it.
func TestAnthropicRoles_SchemaRefusesARoleWithTheWrongKind_DB(t *testing.T) {
	t.Parallel()
	c := newCardDB(t, http.StatusOK)
	for _, tc := range []struct{ role, kind string }{{"coding", "api_key"}, {"default", "oauth_token"}} {
		err := c.db.Exec(`
			INSERT INTO org_anthropic_credentials (oc_org_id, role, credential_kind, key_prefix, key_last4, status)
			VALUES ('acme', ?, ?, 'sk-ant-x', 'wxyz', 'active')`, tc.role, tc.kind).Error
		if err == nil || !strings.Contains(err.Error(), "role_kind") {
			t.Errorf("%s/%s: want the role_kind CHECK to refuse it, got %v", tc.role, tc.kind, err)
		}
	}
}

func TestAnthropicRoles_EffectiveKeyIsDefaultOnly_DB(t *testing.T) {
	t.Parallel()
	c := newCardDB(t, http.StatusOK)
	c.connect(t, "acme", anthropicUnitKey)
	c.patch(t, "acme", subscriptionPatch(anthropicDBOAuthToken))

	res, err := c.svc.EffectiveKey(context.Background(), "acme")
	if err != nil || res.Source != "org" || res.Key != anthropicUnitKey {
		t.Fatalf("the spec agents must keep billing the API key, got %+v (%v)", res, err)
	}
}

// --- ResolveCodingSecretRef ---------------------------------------------------

func TestResolveCodingSecretRef_NoSubscription_UsesTheKey_DB(t *testing.T) {
	t.Parallel()
	c := newCardDB(t, http.StatusOK)
	c.connect(t, "acme", anthropicUnitKey)
	stampTriplet(t, c.repo, "acme", organization.AnthropicRoleDefault,
		"acme-anthropic", "user-app-secrets/wc-acme/acme-anthropic", "api-key")

	ref, err := c.svc.ResolveCodingSecretRef(context.Background(), "acme", orgconfig.AgentRuntimeClaudeCode)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if ref.KVPath != "user-app-secrets/wc-acme/acme-anthropic" || ref.EnvVar != "ANTHROPIC_API_KEY" {
		t.Fatalf("no subscription must resolve to the API key, got %+v", ref)
	}
}

// The whole reason the kind is persisted: dispatch reads the row, never the
// bytes, so this is the only thing that can tell it which variable to mount.
// Getting it wrong means Claude Code ignores the token (ANTHROPIC_API_KEY
// outranks CLAUDE_CODE_OAUTH_TOKEN) and bills the API key in silence.
func TestResolveCodingSecretRef_SubscriptionOnClaudeCode_DB(t *testing.T) {
	t.Parallel()
	c := newCardDB(t, http.StatusOK)
	keyAndSubscription(t, c)

	ref, err := c.svc.ResolveCodingSecretRef(context.Background(), "acme", orgconfig.AgentRuntimeClaudeCode)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if ref.EnvVar != "CLAUDE_CODE_OAUTH_TOKEN" || ref.KVPath != "user-app-secrets/wc-acme/acme-anthropic-coding" {
		t.Fatalf("a Claude Code run must mount the subscription, got %+v", ref)
	}
}

// OpenCode cannot present a token, so a subscription row — which the save rule
// never leaves beside OpenCode — is not even consulted.
func TestResolveCodingSecretRef_OpenCodeNeverGetsTheSubscription_DB(t *testing.T) {
	t.Parallel()
	c := newCardDB(t, http.StatusOK)
	keyAndSubscription(t, c)

	ref, err := c.svc.ResolveCodingSecretRef(context.Background(), "acme", orgconfig.AgentRuntimeOpenCode)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if ref.EnvVar != "ANTHROPIC_API_KEY" || ref.KVPath != "user-app-secrets/wc-acme/acme-anthropic" {
		t.Fatalf("an OpenCode run must mount the API key, got %+v", ref)
	}
}

// An org that chose to bill its plan must never have a run quietly billed to
// API credits instead: a subscription whose mirror never landed is an ERROR.
func TestResolveCodingSecretRef_BrokenSubscriptionFailsClosed_DB(t *testing.T) {
	t.Parallel()
	c := newCardDB(t, http.StatusOK)
	keyAndSubscription(t, c)
	stampTriplet(t, c.repo, "acme", organization.AnthropicRoleCoding, "acme-anthropic-coding", "", "")

	ref, err := c.svc.ResolveCodingSecretRef(context.Background(), "acme", orgconfig.AgentRuntimeClaudeCode)
	if err == nil {
		t.Fatalf("a broken subscription triplet must fail closed, got %+v", ref)
	}
	if !strings.Contains(err.Error(), "secret_ref_kv_path") {
		t.Fatalf("the error must name what is missing, got: %v", err)
	}
}

func TestResolveCodingSecretRef_NoRowsAtAll_Errors_DB(t *testing.T) {
	t.Parallel()
	c := newCardDB(t, http.StatusOK)
	if _, err := c.svc.ResolveCodingSecretRef(context.Background(), "ghost", orgconfig.AgentRuntimeClaudeCode); err == nil {
		t.Fatal("an org with no Anthropic key at all must not resolve a secret ref")
	}
}
