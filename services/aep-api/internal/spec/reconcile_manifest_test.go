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

// UNIT tier: the three-way reconcile behaviors that reconcile_more_test.go's
// two-way expectations cannot express — override preservation, conflict
// hold-off, backfill stamping, clean-only purge, and the
// manifest-in-same-commit invariant. Uses fstest.MapFS libraries so the
// "platform side" can move between reconciles.
package spec

import (
	"context"
	"strings"
	"testing"
	"testing/fstest"
)

// libWith returns a one-skill platform library whose `demo` body is body.
func libWith(body string) fstest.MapFS {
	md := "---\nname: demo\ndescription: Three-way reconcile fixture.\n---\n\n# Demo\n\n" + body + "\n"
	return fstest.MapFS{"demo/SKILL.md": &fstest.MapFile{Data: []byte(md)}}
}

func demoMD(body string) string {
	return "---\nname: demo\ndescription: Three-way reconcile fixture.\n---\n\n# Demo\n\n" + body + "\n"
}

// orgLib returns a one-skill ORG-kind library (no metadata.aep.kind ->
// frontmatterKind defaults to org).
func orgLib(name, body string) fstest.MapFS {
	md := "---\nname: " + name + "\ndescription: Kind-split fixture.\n---\n\n# " + name + "\n\n" + body + "\n"
	return fstest.MapFS{name + "/SKILL.md": &fstest.MapFile{Data: []byte(md)}}
}

// orgLib2 returns a two-skill ORG-kind library.
func orgLib2(name1, body1, name2, body2 string) fstest.MapFS {
	out := fstest.MapFS{}
	for k, v := range orgLib(name1, body1) {
		out[k] = v
	}
	for k, v := range orgLib(name2, body2) {
		out[k] = v
	}
	return out
}

// platformLib returns a one-skill PLATFORM-kind library (metadata.aep.kind:
// platform stamped into frontmatter) — always managed, never opt-in.
func platformLib(name, body string) fstest.MapFS {
	md := "---\nname: " + name + "\ndescription: Kind-split fixture.\nmetadata:\n  aep:\n    kind: platform\n---\n\n# " +
		name + "\n\n" + body + "\n"
	return fstest.MapFS{name + "/SKILL.md": &fstest.MapFile{Data: []byte(md)}}
}

func TestReconcile_SeedWritesManifestSameCommit(t *testing.T) {
	t.Parallel()
	svc, host := newTestStoreWithLibrary(t, libWith("v1"))
	ctx := context.Background()
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	raw := host.readAtHead("org1", skillsManifestPath)
	m := parseSkillsManifest([]byte(raw))
	if m["demo"].Origin != ManifestOriginPlatform || m["demo"].BaseHash == "" {
		t.Fatalf("seed manifest entry missing/wrong: %q -> %#v", raw, m)
	}
}

func TestReconcile_OverrideNeverClobbered(t *testing.T) {
	t.Parallel()
	svc, host := newTestStoreWithLibrary(t, libWith("v1"))
	ctx := context.Background()
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	// Org customizes its copy, platform does NOT move.
	host.writeAtHead("org1", skillRepoPath("demo"), demoMD("org custom"))
	n, err := svc.Reconcile(ctx, "org1")
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if n != 0 {
		t.Fatalf("override must not be rewritten: n=%d", n)
	}
	if got := host.readAtHead("org1", skillRepoPath("demo")); !strings.Contains(got, "org custom") {
		t.Fatalf("org edit clobbered: %q", got)
	}
}

func TestReconcile_CleanCopyRefreshesOnPlatformMove(t *testing.T) {
	t.Parallel()
	svc, host := newTestStoreWithLibrary(t, libWith("v1"))
	ctx := context.Background()
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	svc.SwapLibrary(libWith("v2")) // platform release
	n, err := svc.Reconcile(ctx, "org1")
	if err != nil || n != 1 {
		t.Fatalf("refresh: n=%d err=%v", n, err)
	}
	if got := host.readAtHead("org1", skillRepoPath("demo")); !strings.Contains(got, "v2") {
		t.Fatalf("clean copy not refreshed: %q", got)
	}
	// baseHash advanced with it: a further no-move reconcile is a no-op.
	if n, _ := svc.Reconcile(ctx, "org1"); n != 0 {
		t.Fatalf("baseHash did not advance: second reconcile n=%d", n)
	}
}

func TestReconcile_ConflictLeftAlone(t *testing.T) {
	t.Parallel()
	svc, host := newTestStoreWithLibrary(t, libWith("v1"))
	ctx := context.Background()
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	host.writeAtHead("org1", skillRepoPath("demo"), demoMD("org custom")) // org moves
	svc.SwapLibrary(libWith("v2"))                                        // platform moves too
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if got := host.readAtHead("org1", skillRepoPath("demo")); !strings.Contains(got, "org custom") {
		t.Fatalf("conflict copy was overwritten: %q", got)
	}
}

func TestReconcile_BackfillStampsPreManifestRepo(t *testing.T) {
	t.Parallel()
	// Pre-manifest state: seed under the OLD code shape = repo has the skill
	// but no manifest. Model it by seeding, then deleting the manifest file.
	svc, host := newTestStoreWithLibrary(t, libWith("v1"))
	ctx := context.Background()
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	host.writeAtHead("org1", skillsManifestPath, "") // simulate pre-manifest repo (empty file parses as empty)
	// Clean copy → backfill stamps the baseline without rewriting files.
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	m := parseSkillsManifest([]byte(host.readAtHead("org1", skillsManifestPath)))
	if m["demo"].BaseHash == "" {
		t.Fatal("backfill did not stamp baseHash")
	}
	// Divergent pre-manifest copy → ADOPTS the shipped content. This reverses
	// the original "never clobbered during migration" rule: the platform could
	// not tell a pre-manifest edit from a merely stale copy, and recording the
	// embedded sha as the baseline of a copy the org did not have fabricated a
	// third value matching neither side — every later release then read as
	// "both moved" and surfaced an unresolvable conflict on untouched skills.
	// A post-manifest edit is still preserved; see
	// TestReconcile_PostManifestEditStillSurvives.
	host.writeAtHead("org1", skillsManifestPath, "")
	host.writeAtHead("org1", skillRepoPath("demo"), demoMD("org custom"))
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("backfill divergent: %v", err)
	}
	got := host.readAtHead("org1", skillRepoPath("demo"))
	if strings.Contains(got, "org custom") {
		t.Fatalf("a pre-manifest copy must adopt the shipped content, still diverged: %q", got)
	}
	after := parseSkillsManifest([]byte(host.readAtHead("org1", skillsManifestPath)))["demo"].BaseHash
	if after == "" || !strings.Contains(got, "v1") {
		t.Fatalf("adoption must leave copy and baseline agreeing: base=%q copy=%q", after, got)
	}
}

func TestReconcile_PurgeOnlyCleanCopies(t *testing.T) {
	t.Parallel()
	twoSkills := fstest.MapFS{
		"demo/SKILL.md":  &fstest.MapFile{Data: []byte(demoMD("v1"))},
		"other/SKILL.md": &fstest.MapFile{Data: []byte("---\nname: other\ndescription: Retiree.\n---\n\n# Other\n\nv1\n")},
	}
	svc, host := newTestStoreWithLibrary(t, twoSkills)
	ctx := context.Background()
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	// Platform retires `other`; org1's copy is clean → purged, entry dropped.
	svc.SwapLibrary(libWith("v1"))
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("retire: %v", err)
	}
	if got := host.readAtHead("org1", skillRepoPath("other")); got != "" {
		t.Fatalf("clean retired copy not purged: %q", got)
	}
	m := parseSkillsManifest([]byte(host.readAtHead("org1", skillsManifestPath)))
	if _, ok := m["other"]; ok {
		t.Fatal("retired entry not dropped from manifest")
	}

	// Second org overrides `other` BEFORE retirement → files stay, entry drops
	// (divergence = ownership; it becomes a plain org skill).
	svc.SwapLibrary(twoSkills)
	if _, err := svc.Reconcile(ctx, "org2"); err != nil {
		t.Fatalf("seed org2: %v", err)
	}
	host.writeAtHead("org2", skillRepoPath("other"), "---\nname: other\ndescription: Retiree.\n---\n\n# Other\n\nmine now\n")
	svc.SwapLibrary(libWith("v1"))
	if _, err := svc.Reconcile(ctx, "org2"); err != nil {
		t.Fatalf("retire org2: %v", err)
	}
	if got := host.readAtHead("org2", skillRepoPath("other")); !strings.Contains(got, "mine now") {
		t.Fatalf("overridden retired copy was deleted: %q", got)
	}
	m2 := parseSkillsManifest([]byte(host.readAtHead("org2", skillsManifestPath)))
	if _, ok := m2["other"]; ok {
		t.Fatal("overridden retiree should lose its manifest entry (released to org)")
	}
}

// A user-authored org skill (no manifest entry, non-embedded name) is NEVER
// touched by reconcile — the fold must not make reconcile clobber it.
func TestReconcile_UserAuthoredOrgSkillUntouched(t *testing.T) {
	t.Parallel()
	svc, host := newTestStoreWithLibrary(t, libWith("v1")) // library ships only "demo"
	ctx := context.Background()
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	// Org authors "acme" (org kind, not in the library, no manifest entry).
	host.writeAtHead("org1", skillRepoPath("acme"),
		"---\nname: acme\ndescription: mine\nmetadata:\n  aep:\n    kind: org\n---\n\nmine\n")
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if got := host.readAtHead("org1", skillRepoPath("acme")); !strings.Contains(got, "mine") {
		t.Fatalf("user-authored org skill was clobbered/removed: %q", got)
	}
	// And it never gets a manifest entry.
	m := parseSkillsManifest([]byte(host.readAtHead("org1", skillsManifestPath)))
	if _, ok := m["acme"]; ok {
		t.Fatal("user-authored org skill must have no manifest entry")
	}
}

// A NEW org-kind default — one shipped after this org's repo was created — IS
// added on ongoing Sync. Without this, the org-kind half of the library is
// frozen for every existing org and a newly shipped stack skill only ever
// reaches brand-new orgs.
func TestReconcile_OngoingSync_AddsNewOrgDefault(t *testing.T) {
	t.Parallel()
	// library v1 ships only "demo" (org kind). Seed a repo with it.
	svc, host := newTestStoreWithLibrary(t, orgLib("demo", "v1"))
	ctx := context.Background()
	if _, err := svc.List(ctx, "org1"); err != nil { // first-creation seed
		t.Fatalf("seed: %v", err)
	}
	// Platform now also ships "rust" (org kind). Ongoing Sync must add it.
	svc.SwapLibrary(orgLib2("demo", "v1", "rust", "v1"))
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("sync: %v", err)
	}
	if got := host.readAtHead("org1", skillRepoPath("rust")); got == "" {
		t.Fatal("ongoing sync did not add a newly shipped org default")
	}
	// ...and it is stamped, so the next sync compares rather than re-seeds.
	if e := parseSkillsManifest([]byte(host.readAtHead("org1", skillsManifestPath)))["rust"]; e.BaseHash == "" || e.Removed {
		t.Fatalf("newly seeded org default has no clean baseline: %#v", e)
	}
}

// A DELETED org default stays gone across ongoing Sync. The delete goes
// through the real mutation path so the tombstone it writes is what the
// reconcile actually reads — hand-forging the repo state would test the
// fixture rather than the mechanism.
func TestReconcile_OngoingSync_DoesNotReAddDeletedOrgSkill(t *testing.T) {
	t.Parallel()
	svc, host := newTestStoreWithLibrary(t, orgLib("demo", "v1"))
	ctx := context.Background()
	if _, err := svc.List(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := NewSkillMutationService(svc).Delete(ctx, "org1", "tester", "demo"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("sync: %v", err)
	}
	if got := host.readAtHead("org1", skillRepoPath("demo")); got != "" {
		t.Fatalf("ongoing sync resurrected a deleted org skill: %q", got)
	}
}

// First-creation DOES seed org defaults (new orgs get the starter set).
func TestReconcile_FirstCreation_SeedsOrgDefaults(t *testing.T) {
	t.Parallel()
	svc, host := newTestStoreWithLibrary(t, orgLib("demo", "v1"))
	ctx := context.Background()
	if _, err := svc.List(ctx, "org1"); err != nil { // triggers ensureSkillsRepo first-seed
		t.Fatalf("seed: %v", err)
	}
	if got := host.readAtHead("org1", skillRepoPath("demo")); got == "" {
		t.Fatal("first-creation did not seed the org default")
	}
}

// A PLATFORM-kind skill is always ensured present, even on ongoing sync
// (needed for flow). Guard against the kind-split accidentally skipping it.
func TestReconcile_OngoingSync_StillManagesPlatformSkill(t *testing.T) {
	t.Parallel()
	svc, host := newTestStoreWithLibrary(t, platformLib("flow-guide", "v1"))
	ctx := context.Background()
	if _, err := svc.List(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	// Delete the platform skill's file, then ongoing sync must restore it.
	host.removeAtHead("org1", skillRepoPath("flow-guide"))
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("sync: %v", err)
	}
	if got := host.readAtHead("org1", skillRepoPath("flow-guide")); got == "" {
		t.Fatal("ongoing sync failed to restore a platform-kind skill")
	}
}

func TestUpdatesAvailable_ThreeWayStates(t *testing.T) {
	t.Parallel()
	svc, host := newTestStoreWithLibrary(t, libWith("v1"))
	ctx := context.Background()
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Clean + platform moved → "update".
	svc.SwapLibrary(libWith("v2"))
	rows, err := svc.UpdatesAvailable(ctx, "org1")
	if err != nil || len(rows) != 1 || rows[0].State != "update" {
		t.Fatalf("want one 'update' row, got %v err=%v", rows, err)
	}

	// Org moved too → "conflict".
	host.writeAtHead("org1", skillRepoPath("demo"), demoMD("org custom"))
	rows, err = svc.UpdatesAvailable(ctx, "org1")
	if err != nil || len(rows) != 1 || rows[0].State != "conflict" {
		t.Fatalf("want one 'conflict' row, got %v err=%v", rows, err)
	}

	// Platform back at base, org still moved → "overridden".
	svc.SwapLibrary(libWith("v1"))
	rows, err = svc.UpdatesAvailable(ctx, "org1")
	if err != nil || len(rows) != 1 || rows[0].State != "overridden" {
		t.Fatalf("want one 'overridden' row, got %v err=%v", rows, err)
	}
}
