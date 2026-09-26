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
// oauth_token only — ADR-0036). What is pinned here:
//
//   - the two are independent rows with independent secret bytes, so rotating
//     the key cannot touch the token;
//   - the schema itself refuses a role paired with the wrong kind;
//   - a replaced credential drops its SM-API triplet until the mirror re-stamps it.
//
// Which of the two a reader gets (ModelConnectionService) is pinned in
// model_connection_dbtest_test.go.

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/organization"
	"github.com/wso2/aep/aep-api/internal/platform/orgconfig"
	"github.com/wso2/aep/aep-api/internal/platform/patch"
)

// anthropicDBOAuthToken is shaped like a `claude setup-token` result. The probe
// is faked at the HTTP boundary, so only the SHAPE has to be realistic.
const anthropicDBOAuthToken = "sk-ant-oat01-SubscriptionTokenForCodingRuns-9f2c"

// stampTriplet fakes what the SM-API mirror would have written, so the
// resolution tests can exercise ResolveCodingCredential against real rows.
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

// Replacing a credential clears its SM-API triplet in the same save. The vault
// path is fixed per (org, role), so a triplet kept across a failed mirror would
// resolve to the PREVIOUS credential's copy; cleared, dispatch fails closed
// until the mirror re-stamps it. A save that touches no credential keeps it.
func TestAnthropicReplace_ClearsTheStaleTriplet_DB(t *testing.T) {
	t.Parallel()
	c := newCardDB(t, http.StatusOK) // no SM-API writer: the mirror never re-stamps
	ctx := context.Background()
	keyAndSubscription(t, c)

	c.patch(t, "acme", orgconfig.ConfigPatch{Agents: agentsModelPatch("claude-haiku-4-5")})
	if cred, err := c.conns.ResolveCodingCredential(ctx, "acme", orgconfig.AgentRuntimeClaudeCode); err != nil || cred.Ref.Name != "acme-anthropic-coding" {
		t.Fatalf("a model-only save must keep the triplet: ref=%+v err=%v", cred.Ref, err)
	}

	const token2 = "sk-ant-oat01-SubscriptionTokenForCodingRuns-second"
	c.patch(t, "acme", subscriptionPatch(token2))
	if _, err := c.conns.ResolveCodingCredential(ctx, "acme", orgconfig.AgentRuntimeClaudeCode); err == nil ||
		!strings.Contains(err.Error(), "secret_ref_name is not populated") {
		t.Fatalf("a replaced token with no fresh mirror must fail closed, got %v", err)
	}
	if _, ref, err := c.conns.KeyRef(ctx, "acme"); err != nil || ref.Name != "acme-anthropic" {
		t.Fatalf("replacing the token must not touch the key's triplet: ref=%+v err=%v", ref, err)
	}

	c.connect(t, "acme", anthropicDBKey2)
	if _, _, err := c.conns.KeyRef(ctx, "acme"); err == nil || !strings.Contains(err.Error(), "not populated") {
		t.Fatalf("a replaced key with no fresh mirror must not resolve, got %v", err)
	}
}

func agentsModelPatch(model string) patch.Field[orgconfig.AgentsWrite] {
	return patch.Field[orgconfig.AgentsWrite]{Sent: true, Value: orgconfig.AgentsWrite{Model: model}}
}
