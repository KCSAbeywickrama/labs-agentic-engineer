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

// UNIT tier: ManifestEntry.Disabled (ADR-0014) — org-admin intent to withhold
// a skill from the agents without touching content. Covers the field's
// UnmarshalJSON round trip (the custom decoder silently drops any field not
// listed in its local `raw` struct) and reconcile's obligation to carry the
// flag through a platform refresh rather than zero-value it.
package spec

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestManifestEntry_DisabledRoundTrips(t *testing.T) {
	t.Parallel()
	// Absent → enabled, so no manifest written before this field changes meaning.
	var e ManifestEntry
	if err := json.Unmarshal([]byte(`{"origin":"platform","baseHash":"abc"}`), &e); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if e.Disabled {
		t.Fatalf("absent disabled must mean enabled")
	}
	// Present → must survive the custom UnmarshalJSON.
	if err := json.Unmarshal([]byte(`{"origin":"platform","baseHash":"abc","disabled":true}`), &e); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !e.Disabled {
		t.Fatalf("disabled:true must survive UnmarshalJSON")
	}
	// An enabled entry must not write the key at all.
	b, err := json.Marshal(ManifestEntry{Origin: "platform", BaseHash: "abc"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(b), "disabled") {
		t.Fatalf("an enabled entry must not write the key: %s", b)
	}
}

// A platform refresh (baseHash advances, content may change) must never
// re-enable a skill an org admin disabled — the flag is org intent, not
// baseline state.
func TestReconcile_DisabledSurvivesPlatformRefresh(t *testing.T) {
	t.Parallel()
	svc, host := newTestStoreWithLibrary(t, libWith("v1"))
	ctx := context.Background()
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Org admin disables "demo" — write the flag back onto the org repo head.
	m := parseSkillsManifest([]byte(host.readAtHead("org1", skillsManifestPath)))
	entry := m["demo"]
	entry.Disabled = true
	m["demo"] = entry
	host.writeAtHead("org1", skillsManifestPath, string(renderSkillsManifest(m)))

	// Platform releases v2; reconcile refreshes the clean copy.
	svc.SwapLibrary(libWith("v2"))
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("refresh: %v", err)
	}

	after := parseSkillsManifest([]byte(host.readAtHead("org1", skillsManifestPath)))
	got, ok := after["demo"]
	if !ok {
		t.Fatal("manifest entry dropped by refresh")
	}
	if !got.Disabled {
		t.Fatal("platform refresh cleared the org's disabled flag")
	}
	if got.BaseHash == entry.BaseHash || got.BaseHash == "" {
		t.Fatalf("baseHash did not advance to v2: %q", got.BaseHash)
	}
}

// Availability is org intent, independent of the baseline a write happens to be
// recording. writeSkillFiles UPSERTS a whole manifest entry (`m[name] = e`), so
// every caller that hands it a freshly built entry — the converging console
// edit here, and re-import — would otherwise silently re-enable a skill the org
// had switched off. The flag is carried inside that upsert, so no caller has to
// remember.
func TestUpdate_ConvergingEditPreservesDisabled(t *testing.T) {
	t.Parallel()
	svc, host := newTestStoreWithLibrary(t, orgLibKind("demo", "v1"))
	ctx := context.Background()
	if _, err := svc.List(ctx, "org1"); err != nil { // seed at v1, stamp baseline
		t.Fatalf("seed: %v", err)
	}

	// Org admin disables demo.
	m := parseSkillsManifest([]byte(host.readAtHead("org1", skillsManifestPath)))
	entry := m["demo"]
	entry.Disabled = true
	m["demo"] = entry
	host.writeAtHead("org1", skillsManifestPath, string(renderSkillsManifest(m)))

	// Platform ships v2; the user then edits demo in-console to exactly that
	// content, which advances the baseline (the convergence-persist path).
	svc.SwapLibrary(orgLibKind("demo", "v2"))
	emb, err := loadLibrary(svc.library)
	if err != nil {
		t.Fatalf("load library: %v", err)
	}
	v2SHA := contentSHAOf(t, emb, "demo")
	mut := NewSkillMutationService(svc)
	if _, err := mut.Update(ctx, "org1", "tester", "demo", UpdateSkillInput{SkillMD: orgKindMD("demo", "v2")}); err != nil {
		t.Fatalf("Update: %v", err)
	}

	after := parseSkillsManifest([]byte(host.readAtHead("org1", skillsManifestPath)))["demo"]
	if after.BaseHash != v2SHA {
		t.Fatalf("converging edit must still advance baseHash: got %q want %q", after.BaseHash, v2SHA)
	}
	if !after.Disabled {
		t.Fatal("a converging edit cleared the org's disabled flag")
	}
}
