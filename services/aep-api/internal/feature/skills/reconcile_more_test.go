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

// UNIT tier: the reconcile.go branches repo_store_test.go doesn't reach. That
// file proves seed-on-first-read (built-ins + flow), rewrite-of-a-missing
// skill, and the no-op. This file adds: version-bump overwrite (embed.version
// > repo.version), the purge of a retired built-in the embed no longer ships,
// the UpdatesAvailable rows (stale + absent), the embedded loaders for both
// kinds, and the EnsureProvisioned guards.
package skills

import (
	"context"
	"testing"
)

// goBuiltinAtVersion is a minimal valid `go` SKILL.md pinned to a chosen
// version — used to plant a repo copy BEHIND the embedded built-in (embed go is
// version 2) so the version-based branches fire.
func goBuiltinAtVersion(v string) string {
	return "---\nname: go\ndescription: Minimal go built-in for the reconcile tests.\nmetadata:\n  aep.version: \"" + v + "\"\n---\n\n# Go\n\nbody\n"
}

func versionOf(t *testing.T, skills []Skill, name string) int {
	t.Helper()
	for _, sk := range skills {
		if sk.Name == name {
			return sk.Version
		}
	}
	t.Fatalf("skill %q not present in %v", name, keysOf(nameSet(skills)))
	return 0
}

func TestReconcile_OverwritesStaleBuiltin(t *testing.T) {
	t.Parallel()
	svc, host := newTestStore(t)
	ctx := context.Background()
	if _, err := svc.List(ctx, "org1"); err != nil { // seed at embed versions (go=2)
		t.Fatalf("seed: %v", err)
	}
	// Plant an older `go` (v1) in the repo, then reconcile — embed (v2) is newer.
	host.writeAtHead("org1", skillRepoPath("builtin", "go"), goBuiltinAtVersion("1"))

	n, err := svc.Reconcile(ctx, "org1")
	if err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	if n != 1 {
		t.Fatalf("Reconcile wrote %d, want 1 (only stale `go`)", n)
	}
	got, _ := svc.List(ctx, "org1")
	if v := versionOf(t, got, "go"); v != 2 {
		t.Fatalf("after overwrite go version = %d, want the embedded 2", v)
	}
}

func TestReconcile_PurgesRetiredBuiltin(t *testing.T) {
	t.Parallel()
	svc, host := newTestStore(t)
	ctx := context.Background()
	if _, err := svc.List(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	// A built-in the embed no longer ships lingers in the repo — reconcile must
	// delete it, or it would keep getting inlined into agent prompts forever.
	host.writeAtHead("org1", skillRepoPath("builtin", "retired-legacy"),
		"---\nname: retired-legacy\ndescription: No longer shipped.\nmetadata:\n  aep.version: \"1\"\n---\n\ngone\n")

	n, err := svc.Reconcile(ctx, "org1")
	if err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	if n != 1 {
		t.Fatalf("Reconcile changed %d, want 1 (the retired purge)", n)
	}
	got, _ := svc.List(ctx, "org1")
	if _, present := nameSet(got)["retired-legacy"]; present {
		t.Fatalf("retired built-in should be purged, still present: %v", keysOf(nameSet(got)))
	}
	// The real built-ins survive the purge.
	if _, ok := nameSet(got)["go"]; !ok {
		t.Fatalf("purge removed a live built-in")
	}
}

func TestUpdatesAvailable_ReportsStaleAndAbsent(t *testing.T) {
	t.Parallel()

	t.Run("stale built-in surfaces repo vs embed versions", func(t *testing.T) {
		t.Parallel()
		svc, host := newTestStore(t)
		ctx := context.Background()
		if _, err := svc.List(ctx, "org1"); err != nil {
			t.Fatalf("seed: %v", err)
		}
		host.writeAtHead("org1", skillRepoPath("builtin", "go"), goBuiltinAtVersion("1"))

		ups, err := svc.UpdatesAvailable(ctx, "org1")
		if err != nil {
			t.Fatalf("UpdatesAvailable: %v", err)
		}
		if len(ups) != 1 || ups[0].Name != "go" || ups[0].RepoVersion != 1 || ups[0].EmbeddedVersion != 2 {
			t.Fatalf("updates = %+v, want one {go, repo 1, embed 2}", ups)
		}
	})

	t.Run("absent built-in reports repoVersion -1", func(t *testing.T) {
		t.Parallel()
		svc, host := newTestStore(t)
		ctx := context.Background()
		if _, err := svc.List(ctx, "org1"); err != nil {
			t.Fatalf("seed: %v", err)
		}
		host.removeAtHead("org1", skillRepoPath("builtin", "go"))

		ups, err := svc.UpdatesAvailable(ctx, "org1")
		if err != nil {
			t.Fatalf("UpdatesAvailable: %v", err)
		}
		var goUpdate *SkillUpdate
		for i := range ups {
			if ups[i].Name == "go" {
				goUpdate = &ups[i]
			}
		}
		if goUpdate == nil || goUpdate.RepoVersion != -1 || goUpdate.EmbeddedVersion != 2 {
			t.Fatalf("absent-go update = %+v, want {repo -1, embed 2}", goUpdate)
		}
	})

	t.Run("a missing flow skill never surfaces on the badge", func(t *testing.T) {
		t.Parallel()
		svc, host := newTestStore(t)
		ctx := context.Background()
		if _, err := svc.List(ctx, "org1"); err != nil {
			t.Fatalf("seed: %v", err)
		}
		// Flow skills re-reconcile via Reconcile, but the user-facing badge is
		// built-ins only — the skills page hides flow skills entirely.
		host.removeAtHead("org1", skillRepoPath("flow", "task-planning"))

		ups, err := svc.UpdatesAvailable(ctx, "org1")
		if err != nil {
			t.Fatalf("UpdatesAvailable: %v", err)
		}
		if len(ups) != 0 {
			t.Fatalf("badge must ignore flow skills, got %+v", ups)
		}
	})
}

func TestLoadEmbeddedBuiltins(t *testing.T) {
	t.Parallel()
	got, err := loadEmbeddedBuiltins()
	if err != nil {
		t.Fatalf("loadEmbeddedBuiltins: %v", err)
	}
	by := nameSet(got)
	// The four shipped built-ins, all kind=builtin. `go` is v2 (the
	// connections[]→dependencies[] migration). `api-management` is v3 (the
	// thunder-app dependency rewrite, 2e25858/6b03d34). `react-webapp` and
	// `thunder-authentication` are v4: the generic `<DEP>_<OUTPUT>` runtime-key
	// rewrite (metadata-driven resource consumption) replaced the THUNDER_*
	// keys in both bodies, bumping each past its v3 — see
	// shipped_versions_test.go for the invariant this protects.
	wantVersions := map[string]int{
		"api-management":         3,
		"go":                     2,
		"react-webapp":           4,
		"thunder-authentication": 4,
	}
	for name, wantV := range wantVersions {
		sk, ok := by[name]
		if !ok {
			t.Fatalf("embedded built-in %q missing; got %v", name, keysOf(by))
		}
		if sk.Kind != "builtin" {
			t.Fatalf("%q kind = %q, want builtin", name, sk.Kind)
		}
		if sk.Version != wantV {
			t.Fatalf("%q version = %d, want %d", name, sk.Version, wantV)
		}
		if sk.ContentSHA == "" || sk.SkillMD == "" {
			t.Fatalf("%q has empty body/sha", name)
		}
	}
}

func TestLoadEmbeddedFlow(t *testing.T) {
	t.Parallel()
	got, err := loadEmbeddedFlow()
	if err != nil {
		t.Fatalf("loadEmbeddedFlow: %v", err)
	}
	by := nameSet(got)
	// The four vendored flow skills (go:generate-copied from repo-root skills/).
	for _, name := range []string{"high-level-architecture", "excalidraw-wireframes", "openapi-conventions", "task-planning"} {
		sk, ok := by[name]
		if !ok {
			t.Fatalf("embedded flow skill %q missing; got %v", name, keysOf(by))
		}
		if sk.Kind != "flow" {
			t.Fatalf("%q kind = %q, want flow", name, sk.Kind)
		}
		if sk.ContentSHA == "" || sk.SkillMD == "" || sk.Description == "" {
			t.Fatalf("%q has empty body/sha/description", name)
		}
	}
	// References ride along where the source tree has them.
	if got := by["openapi-conventions"].References["references/wso2-rest-api-design-guidelines.md"]; got == "" {
		t.Fatalf("openapi-conventions reference missing: %v", keysOfStr(by["openapi-conventions"].References))
	}
	if got := by["excalidraw-wireframes"].References["references/wireframes-dsl-example.md"]; got == "" {
		t.Fatalf("excalidraw-wireframes reference missing: %v", keysOfStr(by["excalidraw-wireframes"].References))
	}
}

func TestEnsureProvisioned_Guards(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	// nil service, nil repos, and empty org are all no-op successes — never a
	// panic, never a spurious repo creation.
	var nilSvc *SkillService
	if err := nilSvc.EnsureProvisioned(ctx, "org1"); err != nil {
		t.Fatalf("nil service: %v", err)
	}
	if err := NewSkillService(nil, nil).EnsureProvisioned(ctx, "org1"); err != nil {
		t.Fatalf("nil repos: %v", err)
	}
	svc, _ := newTestStore(t)
	if err := svc.EnsureProvisioned(ctx, ""); err != nil {
		t.Fatalf("empty org: %v", err)
	}

	// A real provision seeds the built-ins and is idempotent on a second call.
	if err := svc.EnsureProvisioned(ctx, "org1"); err != nil {
		t.Fatalf("provision: %v", err)
	}
	if err := svc.EnsureProvisioned(ctx, "org1"); err != nil {
		t.Fatalf("re-provision: %v", err)
	}
	got, _ := svc.List(ctx, "org1")
	if _, ok := nameSet(got)["go"]; !ok {
		t.Fatalf("provision did not seed built-ins: %v", keysOf(nameSet(got)))
	}
}
