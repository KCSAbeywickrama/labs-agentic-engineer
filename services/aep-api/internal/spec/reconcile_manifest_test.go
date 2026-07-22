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

func TestReconcile_SeedWritesManifestSameCommit(t *testing.T) {
	t.Parallel()
	svc, host := newTestStoreWithLibrary(t, libWith("v1"))
	ctx := context.Background()
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	raw := host.readAtHead("org1", skillsManifestPath)
	m := parseSkillsManifest([]byte(raw))
	if m["demo"].Kind != ManifestKindPlatform || m["demo"].BaseHash == "" {
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
	// Divergent pre-manifest copy → stamped but NEVER overwritten.
	host.writeAtHead("org1", skillsManifestPath, "")
	host.writeAtHead("org1", skillRepoPath("demo"), demoMD("org custom"))
	if _, err := svc.Reconcile(ctx, "org1"); err != nil {
		t.Fatalf("backfill divergent: %v", err)
	}
	if got := host.readAtHead("org1", skillRepoPath("demo")); !strings.Contains(got, "org custom") {
		t.Fatalf("divergent pre-manifest copy clobbered during migration: %q", got)
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
