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
	"errors"
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

// SetEnabled is the actual write path for ADR-0014's Disabled flag: it must
// write the manifest ONLY — SKILL.md's bytes (and therefore contentSHA) must
// never move, or the disable would read as a divergence from the platform
// baseline and wrongly surface as a pending update — and it must round-trip
// (disable then re-enable clears the flag), and reject an unknown name with
// the same not-found sentinel the other skill mutations use.
func TestSetEnabled(t *testing.T) {
	t.Parallel()
	svc, host := newTestStoreWithLibrary(t, orgLibKind("demo", "v1"))
	ctx := context.Background()
	if _, err := svc.List(ctx, "org1"); err != nil { // seed
		t.Fatalf("seed: %v", err)
	}
	mut := NewSkillMutationService(svc)

	before, err := svc.Resolve(ctx, "org1", "demo")
	if err != nil || before == nil {
		t.Fatalf("resolve before: %v, %v", before, err)
	}
	if !before.Enabled {
		t.Fatal("freshly seeded skill must start enabled")
	}

	if _, err := mut.SetEnabled(ctx, "org1", "tester", "demo", false); err != nil {
		t.Fatalf("disable: %v", err)
	}

	// 1. manifest entry carries Disabled: true.
	m := parseSkillsManifest([]byte(host.readAtHead("org1", skillsManifestPath)))
	entry, ok := m["demo"]
	if !ok || !entry.Disabled {
		t.Fatalf("manifest entry not disabled: ok=%v entry=%+v", ok, entry)
	}

	// 2. contentSHA (and the SKILL.md bytes behind it) is UNCHANGED.
	after, err := svc.Resolve(ctx, "org1", "demo")
	if err != nil || after == nil {
		t.Fatalf("resolve after: %v, %v", after, err)
	}
	if after.ContentSHA != before.ContentSHA {
		t.Fatalf("disabling must not touch content: before %q after %q", before.ContentSHA, after.ContentSHA)
	}
	if after.SkillMD != before.SkillMD {
		t.Fatal("disabling must not rewrite SKILL.md")
	}
	if after.Enabled {
		t.Fatal("resolved skill still reports enabled after disabling")
	}

	// 3. no divergence surfaces: disabling is not a platform update.
	ups, err := svc.UpdatesAvailable(ctx, "org1")
	if err != nil {
		t.Fatalf("UpdatesAvailable: %v", err)
	}
	if got := stateOf(ups, "demo"); got != "" {
		t.Fatalf("disabling surfaced as an update: state=%q", got)
	}

	// 4. re-enabling clears the flag (round trip).
	if _, err := mut.SetEnabled(ctx, "org1", "tester", "demo", true); err != nil {
		t.Fatalf("re-enable: %v", err)
	}
	m2 := parseSkillsManifest([]byte(host.readAtHead("org1", skillsManifestPath)))
	if m2["demo"].Disabled {
		t.Fatal("re-enable did not clear the disabled flag")
	}
	reenabled, err := svc.Resolve(ctx, "org1", "demo")
	if err != nil || reenabled == nil || !reenabled.Enabled {
		t.Fatalf("resolve after re-enable: %+v, %v", reenabled, err)
	}

	// 5. an unknown name errors with the shared not-found sentinel.
	if _, err := mut.SetEnabled(ctx, "org1", "tester", "no-such-skill", false); !errors.Is(err, ErrSkillNotFound) {
		t.Fatalf("unknown name: got %v, want ErrSkillNotFound", err)
	}
}

// A pre-manifest org repo (skills on disk, no skills-manifest.json) is the
// migration case. Backfill used to stamp the EMBEDDED sha as the baseline of a
// copy the org did not have — a third value matching neither side — so every
// later platform release read as "both moved" and surfaced a conflict on a
// skill nobody had touched. The manifest is created here for the first time, so
// the platform is authoritative: adopt its content and stamp from the same
// bytes. What must NOT change is the post-manifest case, pinned below.
func TestReconcile_PreManifestCopyAdoptsShippedContent(t *testing.T) {
	t.Parallel()
	svc, host := newTestStoreWithLibrary(t, libWith("v2"))
	ctx := context.Background()

	// An org repo as it looked before manifests: a STALE copy, no manifest.
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	host.writeAtHead("org1", skillRepoPath("demo"), demoMD("v1-stale"))
	host.removeAtHead("org1", skillsManifestPath)

	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("backfill reconcile: %v", err)
	}

	// The copy is now the shipped content, and the baseline agrees with it.
	got := host.readAtHead("org1", skillRepoPath("demo"))
	if !strings.Contains(got, "v2") || strings.Contains(got, "v1-stale") {
		t.Fatalf("pre-manifest copy must adopt the shipped content, got:\n%s", got)
	}
	emb, err := loadLibrary(svc.library)
	if err != nil {
		t.Fatalf("load library: %v", err)
	}
	base := parseSkillsManifest([]byte(host.readAtHead("org1", skillsManifestPath)))["demo"].BaseHash
	if want := contentSHAOf(t, emb, "demo"); base != want {
		t.Fatalf("baseline must be stamped from the adopted bytes: got %q want %q", base, want)
	}

	// The whole point: a LATER platform release is a clean update, not a
	// conflict on a skill the org never edited.
	svc.SwapLibrary(libWith("v3"))
	ups, err := svc.UpdatesAvailable(ctx, "org1")
	if err != nil {
		t.Fatalf("UpdatesAvailable: %v", err)
	}
	if st := stateOf(ups, "demo"); st != "update" {
		t.Fatalf("after backfill, a platform move must read as \"update\", got %q", st)
	}
}

// The guard on the change above: adoption applies ONLY to the migration. Once a
// baseline exists, a real org edit is still preserved and reported as an
// override — reconcile must never clobber it.
func TestReconcile_PostManifestEditStillSurvives(t *testing.T) {
	t.Parallel()
	svc, host := newTestStoreWithLibrary(t, libWith("v1"))
	ctx := context.Background()
	if _, err := svc.Reconcile(ctx, "org1"); err != nil { // seeds + stamps a baseline
		t.Fatalf("seed: %v", err)
	}

	// The org edits AFTER the baseline exists — a genuine override.
	host.writeAtHead("org1", skillRepoPath("demo"), demoMD("my own words"))

	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if got := host.readAtHead("org1", skillRepoPath("demo")); !strings.Contains(got, "my own words") {
		t.Fatalf("a post-manifest org edit must survive reconcile, got:\n%s", got)
	}
	ups, err := svc.UpdatesAvailable(ctx, "org1")
	if err != nil {
		t.Fatalf("UpdatesAvailable: %v", err)
	}
	if st := stateOf(ups, "demo"); st != "overridden" {
		t.Fatalf("a post-manifest org edit must read as \"overridden\", got %q", st)
	}
}
