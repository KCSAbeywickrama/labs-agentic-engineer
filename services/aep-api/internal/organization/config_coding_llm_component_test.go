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

// COMPONENT tier — the `codingLlm` section of GET/PATCH /config, over the same
// real handler chain + real services + real Postgres as
// config_component_test.go (whose harness this reuses).
//
// The section is a three-state peer of `llm`, but its null means something the
// other sections' null does not: not "disconnected" but "the coding agent
// reuses the default key" (ADR-0016). These rows pin that difference where a
// client can actually observe it — on the wire.
package organization_test

import (
	"strings"
	"testing"
)

const goodCodingKey = "sk-ant-api03-CODINGagentOnlyKeyQRSTUVwxyz11"

func codingLlmConnect(key string) string {
	return `{"codingLlm":{"kind":"anthropic","apiKey":"` + key + `"}}`
}

// A fresh org reuses: the section is PRESENT and null, never absent. A client
// must be able to tell "reuse" from "this server predates the section".
func TestConfigComponent_K1_FreshOrgReuses(t *testing.T) {
	t.Parallel()
	c := newConfigHarness(t)

	resp := c.h.AsOrg("acme").Get(configPath)
	if resp.Code != 200 {
		t.Fatalf("get: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	m := decodeCfg(t, resp.Body.Bytes())
	v, present := m["codingLlm"]
	if !present {
		t.Fatal("codingLlm must always be present on the wire; absent is indistinguishable from an old server")
	}
	if v != nil {
		t.Fatalf("a fresh org must read as reuse (null), got %v", v)
	}
}

// The override cannot be set on an org with no default key — there is nothing
// for it to override. It is a section-scoped client fault, so it answers
// exactly like every other probe rejection does under this API's error model:
// 400 validation_failed carrying body.codingLlm, which is what lets the console
// highlight the offending form section.
func TestConfigComponent_K2_CodingWithoutDefaultRejected(t *testing.T) {
	t.Parallel()
	c := newConfigHarness(t)

	resp := c.h.AsOrg("acme").Patch(configPath, codingLlmConnect(goodCodingKey))
	if resp.Code != 400 {
		t.Fatalf("coding key with no default: want 400, got %d body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "body.codingLlm") {
		t.Fatalf("the error must point at the codingLlm section: %s", resp.Body.String())
	}

	// Nothing was written: the org still reads as fresh.
	m := decodeCfg(t, c.h.AsOrg("acme").Get(configPath).Body.Bytes())
	if m["llm"] != nil || m["codingLlm"] != nil {
		t.Fatalf("a rejected coding patch must write nothing: %v", m)
	}
}

func TestConfigComponent_K3_SetRotateAndProject(t *testing.T) {
	t.Parallel()
	c := newConfigHarness(t)
	if r := c.h.AsOrg("acme").Patch(configPath, llmConnect(goodAnthKey)); r.Code != 200 {
		t.Fatalf("default connect: %d %s", r.Code, r.Body.String())
	}

	resp := c.h.AsOrg("acme").Patch(configPath, codingLlmConnect(goodCodingKey))
	if resp.Code != 200 {
		t.Fatalf("coding connect: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	m := decodeCfg(t, resp.Body.Bytes())
	coding, ok := m["codingLlm"].(map[string]any)
	if !ok {
		t.Fatalf("codingLlm must project once set: %v", m["codingLlm"])
	}
	if coding["keyLast4"] != goodCodingKey[len(goodCodingKey)-4:] {
		t.Fatalf("codingLlm previews the wrong key: %v", coding)
	}
	// The two sections are independent, and neither echoes a secret.
	llm := m["llm"].(map[string]any)
	if llm["keyLast4"] == coding["keyLast4"] {
		t.Fatalf("llm and codingLlm must preview DIFFERENT keys: %v vs %v", llm, coding)
	}
	if strings.Contains(resp.Body.String(), goodCodingKey) {
		t.Fatal("the coding apiKey is write-only and must never be echoed")
	}

	// Rotating the coding key alone does not require resending the default key
	// (which the client cannot read back).
	rot := c.h.AsOrg("acme").Patch(configPath, codingLlmConnect(goodAnthKey2))
	if rot.Code != 200 {
		t.Fatalf("coding rotate: %d %s", rot.Code, rot.Body.String())
	}
	rm := decodeCfg(t, rot.Body.Bytes())
	if rm["codingLlm"].(map[string]any)["keyLast4"] != goodAnthKey2[len(goodAnthKey2)-4:] {
		t.Fatalf("coding rotate did not take: %v", rm["codingLlm"])
	}
	if rm["llm"].(map[string]any)["keyLast4"] != goodAnthKey[len(goodAnthKey)-4:] {
		t.Fatalf("rotating the coding key must not touch the default: %v", rm["llm"])
	}
}

// null = back to reuse. Idempotent, and it leaves the default alone — this is
// the console's "Reuse the key above" flip.
func TestConfigComponent_K4_NullRestoresReuse(t *testing.T) {
	t.Parallel()
	c := newConfigHarness(t)
	if r := c.h.AsOrg("acme").Patch(configPath, llmConnect(goodAnthKey)); r.Code != 200 {
		t.Fatalf("default connect: %d %s", r.Code, r.Body.String())
	}
	if r := c.h.AsOrg("acme").Patch(configPath, codingLlmConnect(goodCodingKey)); r.Code != 200 {
		t.Fatalf("coding connect: %d %s", r.Code, r.Body.String())
	}

	resp := c.h.AsOrg("acme").Patch(configPath, `{"codingLlm":null}`)
	if resp.Code != 200 {
		t.Fatalf("coding null: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	m := decodeCfg(t, resp.Body.Bytes())
	if m["codingLlm"] != nil {
		t.Fatalf("null must restore reuse, got %v", m["codingLlm"])
	}
	if m["llm"] == nil {
		t.Fatal("removing the override must not disconnect the default key")
	}

	// Idempotent: an org already reusing can be told to reuse again.
	if again := c.h.AsOrg("acme").Patch(configPath, `{"codingLlm":null}`); again.Code != 200 {
		t.Fatalf("second null: want 200, got %d %s", again.Code, again.Body.String())
	}
}

// Both keys in ONE patch must work: codingLlm's "a default must exist" check
// has to see the default this same request wrote, not the org's prior state.
func TestConfigComponent_K5_BothSectionsInOnePatch(t *testing.T) {
	t.Parallel()
	c := newConfigHarness(t)

	body := `{"llm":{"kind":"anthropic","apiKey":"` + goodAnthKey + `"},` +
		`"codingLlm":{"kind":"anthropic","apiKey":"` + goodCodingKey + `"}}`
	resp := c.h.AsOrg("acme").Patch(configPath, body)
	if resp.Code != 200 {
		t.Fatalf("both sections at once: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	m := decodeCfg(t, resp.Body.Bytes())
	if m["llm"] == nil || m["codingLlm"] == nil {
		t.Fatalf("both sections must be set: %v", m)
	}
}

// Disconnecting the default cascades the override away with it, so the org can
// never reach llm=null + codingLlm=set — a state the projection cannot describe.
func TestConfigComponent_K6_DisconnectingDefaultCascades(t *testing.T) {
	t.Parallel()
	c := newConfigHarness(t)
	body := `{"llm":{"kind":"anthropic","apiKey":"` + goodAnthKey + `"},` +
		`"codingLlm":{"kind":"anthropic","apiKey":"` + goodCodingKey + `"}}`
	if r := c.h.AsOrg("acme").Patch(configPath, body); r.Code != 200 {
		t.Fatalf("setup: %d %s", r.Code, r.Body.String())
	}

	resp := c.h.AsOrg("acme").Patch(configPath, `{"llm":null}`)
	if resp.Code != 200 {
		t.Fatalf("disconnect default: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	m := decodeCfg(t, resp.Body.Bytes())
	if m["llm"] != nil {
		t.Fatalf("llm must be null after disconnect: %v", m["llm"])
	}
	if m["codingLlm"] != nil {
		t.Fatalf("the override must not outlive the key it overrides: %v", m["codingLlm"])
	}
}

// A bad coding key fails the WHOLE patch before anything is written — the same
// probe-before-persist atomicity the other sections have.
func TestConfigComponent_K7_BadCodingKeyIsAtomic(t *testing.T) {
	t.Parallel()
	c := newConfigHarness(t)
	if r := c.h.AsOrg("acme").Patch(configPath, llmConnect(goodAnthKey)); r.Code != 200 {
		t.Fatalf("default connect: %d %s", r.Code, r.Body.String())
	}
	// ONLY the coding key is rejected: the default key in the same body must
	// still probe clean, or the patch would abort on the `llm` section and this
	// test would never reach the path it is named for.
	c.anth.rejectOnly(goodCodingKey)

	body := `{"llm":{"kind":"anthropic","apiKey":"` + goodAnthKey2 + `"},` +
		`"codingLlm":{"kind":"anthropic","apiKey":"` + goodCodingKey + `"}}`
	resp := c.h.AsOrg("acme").Patch(configPath, body)
	if resp.Code != 400 {
		t.Fatalf("a rejected coding key must fail the patch: want 400, got %d body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "body.codingLlm") {
		t.Fatalf("the failure must be attributed to the coding section, not the default: %s", resp.Body.String())
	}

	// The default key must NOT have rotated to goodAnthKey2.
	m := decodeCfg(t, c.h.AsOrg("acme").Get(configPath).Body.Bytes())
	llm := m["llm"].(map[string]any)
	if llm["keyLast4"] != goodAnthKey[len(goodAnthKey)-4:] {
		t.Fatalf("a failed probe must leave the previous default key in place: %v", llm)
	}
	if m["codingLlm"] != nil {
		t.Fatalf("a rejected coding key must not be persisted: %v", m["codingLlm"])
	}
}

// Clearing the default key and setting the override in ONE patch has no
// reachable end state — the cascade would delete the very row the override
// needs. It is the one pair the probe phase cannot see (both sections probe
// clean on their own), so it is rejected up front rather than discovered
// halfway through the writes, which would leave the org with no Anthropic key
// at all AND an error to show for it.
func TestConfigComponent_K8_ClearDefaultAndSetCodingRejected(t *testing.T) {
	t.Parallel()
	c := newConfigHarness(t)
	if r := c.h.AsOrg("acme").Patch(configPath, llmConnect(goodAnthKey)); r.Code != 200 {
		t.Fatalf("default connect: %d %s", r.Code, r.Body.String())
	}

	body := `{"llm":null,"codingLlm":{"kind":"anthropic","apiKey":"` + goodCodingKey + `"}}`
	resp := c.h.AsOrg("acme").Patch(configPath, body)
	if resp.Code != 400 {
		t.Fatalf("clearing the default while setting the override: want 400, got %d body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "body.codingLlm") {
		t.Fatalf("the error must point at the codingLlm section: %s", resp.Body.String())
	}

	// The default key MUST survive: the rejection has to happen before the
	// disconnect, not after it.
	m := decodeCfg(t, c.h.AsOrg("acme").Get(configPath).Body.Bytes())
	llm, ok := m["llm"].(map[string]any)
	if !ok {
		t.Fatalf("a rejected patch must not disconnect the default key: %v", m["llm"])
	}
	if llm["keyLast4"] != goodAnthKey[len(goodAnthKey)-4:] {
		t.Fatalf("the default key must be untouched: %v", llm)
	}
	if m["codingLlm"] != nil {
		t.Fatalf("a rejected override must not be persisted: %v", m["codingLlm"])
	}
}
