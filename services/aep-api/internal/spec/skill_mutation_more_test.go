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

// UNIT tier: the read/write-surface branches repo_store_test.go leaves open —
// the SkillMutationService.Update paths beyond the component tier's 403/404
// (happy round-trip, NAME_IMMUTABLE, imported ⇒ not-found), and the read
// degrade path (an origin outage serves empty and never fails the run, §12).
// The commit CAS retry/exhaustion behaviour now
// lives in Workspace.Mutate and is pinned at the gitfs tier (plus the
// end-to-end concurrent-commit test in repo_store_test.go), so the old
// fault-injecting git-host fakes are gone with the REST path.
package spec

import (
	"bytes"
	"context"
	"errors"
	"os"
	"testing"
)

func TestUpdate_HappyAndGuards(t *testing.T) {
	t.Parallel()
	svc, _ := newTestStore(t)
	mut := NewSkillMutationService(svc)
	ctx := context.Background()
	if _, err := svc.List(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	create := "---\nname: my-skill\ndescription: initial.\nmetadata:\n  aep.version: \"1\"\n---\n\nv1 body\n"
	if _, err := mut.Create(ctx, "org1", "tester", CreateSkillInput{Name: "my-skill", SkillMD: create}); err != nil {
		t.Fatalf("Create: %v", err)
	}

	t.Run("happy update round-trips new content", func(t *testing.T) {
		updated := "---\nname: my-skill\ndescription: revised.\nmetadata:\n  aep.version: \"2\"\n---\n\nv2 body\n"
		sk, err := mut.Update(ctx, "org1", "tester", "my-skill", UpdateSkillInput{SkillMD: updated})
		if err != nil {
			t.Fatalf("Update: %v", err)
		}
		if sk == nil || sk.Kind != SkillKindOrg || sk.Description != "revised." {
			t.Fatalf("updated skill = %+v, want the revised org-kind content", sk)
		}
		got, _ := svc.Resolve(ctx, "org1", "my-skill")
		if got == nil || got.Description != "revised." {
			t.Fatalf("read-back after update = %+v, want the revised content", got)
		}
	})

	t.Run("rename via update is rejected (NAME_IMMUTABLE)", func(t *testing.T) {
		renamed := "---\nname: renamed-skill\ndescription: d.\nmetadata:\n  aep.version: \"1\"\n---\n\nbody\n"
		_, err := mut.Update(ctx, "org1", "tester", "my-skill", UpdateSkillInput{SkillMD: renamed})
		assertIssueCode(t, err, "NAME_IMMUTABLE")
	})

	t.Run("updating an org skill (platform-seeded) is now allowed", func(t *testing.T) {
		// Editability is decoupled from ownership: "go" is a platform-seeded
		// org skill, and org is editable per SkillEditable — editing it keeps
		// its kind org (an override reconcile will leave alone).
		body := "---\nname: go\ndescription: d.\nmetadata:\n  aep.version: \"1\"\n---\n\nbody\n"
		sk, err := mut.Update(ctx, "org1", "tester", "go", UpdateSkillInput{SkillMD: body})
		if err != nil {
			t.Fatalf("Update go: %v", err)
		}
		if sk.Kind != SkillKindOrg {
			t.Fatalf("updated go kind = %q, want org (kind preserved)", sk.Kind)
		}
	})

	t.Run("updating a platform skill is forbidden", func(t *testing.T) {
		body := "---\nname: task-planning\ndescription: d.\nmetadata:\n  aep.version: \"1\"\n---\n\nbody\n"
		if _, err := mut.Update(ctx, "org1", "tester", "task-planning", UpdateSkillInput{SkillMD: body}); !errors.Is(err, ErrSkillNotEditable) {
			t.Fatalf("update platform skill err = %v, want ErrSkillNotEditable", err)
		}
	})

	t.Run("updating a missing skill is not-found", func(t *testing.T) {
		body := "---\nname: ghost\ndescription: d.\nmetadata:\n  aep.version: \"1\"\n---\n\nbody\n"
		if _, err := mut.Update(ctx, "org1", "tester", "ghost", UpdateSkillInput{SkillMD: body}); !errors.Is(err, ErrSkillNotFound) {
			t.Fatalf("update missing err = %v, want ErrSkillNotFound", err)
		}
	})
}

func TestUpdate_ImportedIsUpdatable(t *testing.T) {
	t.Parallel()
	svc, _ := newTestStore(t)
	mut := NewSkillMutationService(svc)
	imp := NewSkillImportService(svc)
	ctx := context.Background()
	if _, err := svc.List(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Import a skill, then PUT it — imported is editable per SkillEditable, and
	// Update preserves the kind (imported stays imported).
	tgz := makeTarGz(t, map[string]string{
		"imp-skill/":         "",
		"imp-skill/SKILL.md": skillMDNamed("imp-skill", ""),
	})
	if _, err := imp.Import(ctx, "org1", "tester", bytes.NewReader(tgz)); err != nil {
		t.Fatalf("Import: %v", err)
	}
	body := skillMDNamed("imp-skill", "")
	sk, err := mut.Update(ctx, "org1", "tester", "imp-skill", UpdateSkillInput{SkillMD: body})
	if err != nil {
		t.Fatalf("update imported err = %v, want success", err)
	}
	if sk.Kind != SkillKindImported {
		t.Fatalf("updated imported kind = %q, want imported (kind preserved)", sk.Kind)
	}
}

func TestCatalog_DegradesOnReadError(t *testing.T) {
	t.Parallel()
	svc, host := newTestStore(t)
	ctx := context.Background()
	if _, err := svc.List(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Simulate an origin outage: nuke the bare origin so the engine's
	// branch-tip fetch fails. The catalog must degrade (serve empty) rather
	// than fail the design/task run (§12).
	if err := os.RemoveAll(host.origin("org1").Dir()); err != nil {
		t.Fatalf("remove origin: %v", err)
	}

	got, err := svc.List(ctx, "org1")
	if err != nil {
		t.Fatalf("List during outage must not error, got %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("outage degrade should serve empty, got %v", namesOf(got))
	}
}

func namesOf(skills []Skill) []string {
	out := make([]string, 0, len(skills))
	for _, sk := range skills {
		out = append(out, sk.Name)
	}
	return out
}
