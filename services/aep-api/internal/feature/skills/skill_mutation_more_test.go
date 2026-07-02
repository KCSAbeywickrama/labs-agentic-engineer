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
// ResolveMany (order + missing), the SkillMutationService.Update paths beyond
// the component tier's 403/404 (happy round-trip, NAME_IMMUTABLE, imported ⇒
// not-found), the commit CAS retry-on-non-fast-forward, and the read degrade
// path (a GitHub read error serves cache/empty and never fails the run, §12).
package skills

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/credentials"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/models"
)

func TestResolveMany_PreservesOrderAndOmitsMissing(t *testing.T) {
	t.Parallel()
	svc, _ := newTestStore()
	ctx := context.Background()
	if _, err := svc.List(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	got, err := svc.ResolveMany(ctx, "org1", []string{"react-webapp", "does-not-exist", "go"})
	if err != nil {
		t.Fatalf("ResolveMany: %v", err)
	}
	// Order preserved, the missing name dropped (caller compares lengths).
	if len(got) != 2 || got[0].Name != "react-webapp" || got[1].Name != "go" {
		t.Fatalf("ResolveMany = %v, want [react-webapp go]", namesOf(got))
	}
}

func TestUpdate_HappyAndGuards(t *testing.T) {
	t.Parallel()
	svc, _ := newTestStore()
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
		if sk == nil || sk.Version != 2 || sk.Kind != "custom" {
			t.Fatalf("updated skill = %+v, want version 2 custom", sk)
		}
		got, _ := svc.Resolve(ctx, "org1", "my-skill")
		if got == nil || got.Version != 2 {
			t.Fatalf("read-back after update = %+v, want version 2", got)
		}
	})

	t.Run("rename via update is rejected (NAME_IMMUTABLE)", func(t *testing.T) {
		renamed := "---\nname: renamed-skill\ndescription: d.\nmetadata:\n  aep.version: \"1\"\n---\n\nbody\n"
		_, err := mut.Update(ctx, "org1", "tester", "my-skill", UpdateSkillInput{SkillMD: renamed})
		assertIssueCode(t, err, "NAME_IMMUTABLE")
	})

	t.Run("updating a builtin is forbidden", func(t *testing.T) {
		body := "---\nname: go\ndescription: d.\nmetadata:\n  aep.version: \"1\"\n---\n\nbody\n"
		if _, err := mut.Update(ctx, "org1", "tester", "go", UpdateSkillInput{SkillMD: body}); !errors.Is(err, ErrSkillNotEditable) {
			t.Fatalf("update builtin err = %v, want ErrSkillNotEditable", err)
		}
	})

	t.Run("updating a missing skill is not-found", func(t *testing.T) {
		body := "---\nname: ghost\ndescription: d.\nmetadata:\n  aep.version: \"1\"\n---\n\nbody\n"
		if _, err := mut.Update(ctx, "org1", "tester", "ghost", UpdateSkillInput{SkillMD: body}); !errors.Is(err, ErrSkillNotFound) {
			t.Fatalf("update missing err = %v, want ErrSkillNotFound", err)
		}
	})
}

func TestUpdate_ImportedNotUpdatable(t *testing.T) {
	t.Parallel()
	svc, _ := newTestStore()
	mut := NewSkillMutationService(svc)
	imp := NewSkillImportService(svc)
	ctx := context.Background()
	if _, err := svc.List(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Import a skill, then attempt to PUT it — imported skills are replaced via
	// re-import, not update, so the service reports it as not-found.
	tgz := makeTarGz(t, map[string]string{
		"imp-skill/":         "",
		"imp-skill/SKILL.md": skillMDNamed("imp-skill", ""),
	})
	if _, err := imp.Import(ctx, "org1", "tester", bytes.NewReader(tgz)); err != nil {
		t.Fatalf("Import: %v", err)
	}
	body := skillMDNamed("imp-skill", "")
	if _, err := mut.Update(ctx, "org1", "tester", "imp-skill", UpdateSkillInput{SkillMD: body}); !errors.Is(err, ErrSkillNotFound) {
		t.Fatalf("update imported err = %v, want ErrSkillNotFound", err)
	}
}

func TestCommit_RetriesOnNonFastForward(t *testing.T) {
	t.Parallel()
	flaky := &flakyGit{memGit: newMemGit()}
	repos := &fakeRepoSvc{repos: map[string]*models.GitRepository{}}
	svc := NewSkillService(&flakyGitOps{gh: flaky}, repos)
	mut := NewSkillMutationService(svc)
	ctx := context.Background()
	if _, err := svc.List(ctx, "org1"); err != nil { // seed (consumes no NFF budget yet)
		t.Fatalf("seed: %v", err)
	}

	// The next commit's UpdateRef reports a lost race once; retryCAS must re-run
	// the read-modify-write and succeed on the second attempt.
	flaky.nffOnUpdate = 1
	created, err := mut.Create(ctx, "org1", "tester", CreateSkillInput{
		Name:    "raced-skill",
		SkillMD: skillMDNamed("raced-skill", ""),
	})
	if err != nil {
		t.Fatalf("Create under one lost race: %v", err)
	}
	if created == nil || created.Name != "raced-skill" {
		t.Fatalf("created = %+v", created)
	}
	if flaky.nffOnUpdate != 0 {
		t.Fatalf("expected the NFF to be consumed by a retry, remaining=%d", flaky.nffOnUpdate)
	}
	if got, _ := svc.Resolve(ctx, "org1", "raced-skill"); got == nil {
		t.Fatal("skill not persisted after the CAS retry")
	}
}

func TestCatalog_DegradesOnReadError(t *testing.T) {
	t.Parallel()
	flaky := &flakyGit{memGit: newMemGit()}
	repos := &fakeRepoSvc{repos: map[string]*models.GitRepository{}}
	svc := NewSkillService(&flakyGitOps{gh: flaky}, repos)
	ctx := context.Background()
	if _, err := svc.List(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Simulate a GitHub outage on the read path and drop the fresh cache so the
	// read actually reaches GitHub. The catalog must degrade (serve empty) rather
	// than fail the design/task run (§12).
	svc.cache.evict("org1")
	flaky.failGetRef = 1000

	got, err := svc.List(ctx, "org1")
	if err != nil {
		t.Fatalf("List during outage must not error, got %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("cold-cache degrade should serve empty, got %v", namesOf(got))
	}
}

// ---- flaky GitHub client (fault injection over the memGit fake) -------------

// flakyGit wraps memGit to inject read/commit faults: `failGetRef` GetRef calls
// return a generic error (the outage path), and `nffOnUpdate` UpdateRef calls
// return ErrRefNotFastForward (the lost-race path retryCAS retries).
type flakyGit struct {
	*memGit
	failGetRef  int
	nffOnUpdate int
}

func (f *flakyGit) GetRef(ctx context.Context, owner, repo string, cred credentials.Credential, ref string) (string, error) {
	if f.failGetRef > 0 {
		f.failGetRef--
		return "", errors.New("github: 503 service unavailable")
	}
	return f.memGit.GetRef(ctx, owner, repo, cred, ref)
}

func (f *flakyGit) UpdateRef(ctx context.Context, owner, repo string, cred credentials.Credential, ref, sha string, force bool) error {
	if f.nffOnUpdate > 0 {
		f.nffOnUpdate--
		return gitrepo.ErrRefNotFastForward
	}
	return f.memGit.UpdateRef(ctx, owner, repo, cred, ref, sha, force)
}

type flakyGitOps struct {
	gitrepo.GitOpsService
	gh gitrepo.GitData
}

func (f *flakyGitOps) GitData() gitrepo.GitData       { return f.gh }
func (f *flakyGitOps) Resolver() credentials.Resolver { return fakeResolver{} }
func (f *flakyGitOps) ResolveSaveIdentities(credentials.Credential) (*gitrepo.GitIdentity, *gitrepo.GitIdentity) {
	gi := &gitrepo.GitIdentity{Name: "Bot", Email: "bot@aep.dev"}
	return gi, gi
}

func namesOf(skills []Skill) []string {
	out := make([]string, 0, len(skills))
	for _, sk := range skills {
		out = append(out, sk.Name)
	}
	return out
}

// TestCommit_CASExhaustionSurfacesWrappedError closes the review's retryCAS
// gap: when EVERY attempt loses the ref race, the commit gives up after
// casAttempts and surfaces the wrapped non-fast-forward error (not a hang, not
// a silent success).
func TestCommit_CASExhaustionSurfacesWrappedError(t *testing.T) {
	t.Parallel()
	flaky := &flakyGit{memGit: newMemGit()}
	repos := &fakeRepoSvc{repos: map[string]*models.GitRepository{}}
	svc := NewSkillService(&flakyGitOps{gh: flaky}, repos)
	mut := NewSkillMutationService(svc)
	ctx := context.Background()
	if _, err := svc.List(ctx, "org1"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	flaky.nffOnUpdate = casAttempts + 1 // lose every retry
	_, err := mut.Create(ctx, "org1", "tester", CreateSkillInput{
		Name:    "doomed-skill",
		SkillMD: skillMDNamed("doomed-skill", ""),
	})
	if err == nil {
		t.Fatal("exhausted CAS budget must fail the commit")
	}
	if !errors.Is(err, gitrepo.ErrRefNotFastForward) || !strings.Contains(err.Error(), "after 4 attempts") {
		t.Fatalf("want the wrapped NFF exhaustion error, got %v", err)
	}
}
