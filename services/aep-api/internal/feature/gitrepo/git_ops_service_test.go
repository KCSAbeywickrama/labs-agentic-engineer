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

package gitrepo_test

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/platform/gittest"
	"github.com/wso2/aep/aep-api/models"
)

// gitClone clones url into dest (used by tests that need a pre-existing clone
// on disk without going through the service under test).
func gitClone(t *testing.T, url, dest string) {
	t.Helper()
	cmd := exec.Command("git", "clone", url, dest)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("git clone %s -> %s: %v: %s", url, dest, err, stderr.String())
	}
}

// gitOut runs a git command in dir and returns trimmed stdout.
func gitOut(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("git %s in %s: %v", strings.Join(args, " "), dir, err)
	}
	return strings.TrimSpace(string(out))
}

func TestEnsureCloneReady_FreshCloneHappyPath(t *testing.T) {
	t.Parallel()
	remote := gittest.NewRemote(t, gittest.WithSeed(map[string]string{"README.md": "hello"}, "seed"))
	repo := newFakeRepoRepo()
	base := t.TempDir()
	svc := gitrepo.NewGitOpsService(repo, fakeResolver{}, base, nil)

	rec := &models.GitRepository{OrgID: "org1", ProjectID: "proj1", RepoURL: remote.URL()}
	if err := svc.EnsureCloneReady(testContext(), rec); err != nil {
		t.Fatalf("EnsureCloneReady: %v", err)
	}

	expected := filepath.Join(base, "org1", "proj1")
	if rec.ClonePath != expected {
		t.Fatalf("ClonePath = %q, want %q", rec.ClonePath, expected)
	}
	if _, err := os.Stat(filepath.Join(expected, ".git")); err != nil {
		t.Fatalf(".git missing at cloned path: %v", err)
	}
	if rec.Status != "ready" || rec.DefaultBranch != "main" || rec.ErrorMessage != "" {
		t.Fatalf("record after clone = {status:%q branch:%q err:%q}, want {ready main \"\"}", rec.Status, rec.DefaultBranch, rec.ErrorMessage)
	}
	if got := repo.updateCount(); got != 1 {
		t.Fatalf("repo.Update called %d times, want 1 (status persisted)", got)
	}
	if b, _ := os.ReadFile(filepath.Join(expected, "README.md")); string(b) != "hello" {
		t.Fatalf("cloned README.md = %q, want %q", b, "hello")
	}
}

func TestEnsureCloneReady_StalePathUpdatedAndReused(t *testing.T) {
	t.Parallel()
	remote := gittest.NewRemote(t, gittest.WithSeed(map[string]string{"README.md": "hello"}, "seed"))
	repo := newFakeRepoRepo()
	base := t.TempDir()
	svc := gitrepo.NewGitOpsService(repo, fakeResolver{}, base, nil)

	// A valid clone already lives at the expected path.
	expected := filepath.Join(base, "org1", "proj1")
	gitClone(t, remote.URL(), expected)

	// The stored record points somewhere stale (e.g. REPO_BASE_PATH changed).
	rec := &models.GitRepository{OrgID: "org1", ProjectID: "proj1", RepoURL: remote.URL(), ClonePath: "/tmp/stale-nonexistent-path"}
	if err := svc.EnsureCloneReady(testContext(), rec); err != nil {
		t.Fatalf("EnsureCloneReady: %v", err)
	}
	if rec.ClonePath != expected {
		t.Fatalf("ClonePath = %q, want updated to %q", rec.ClonePath, expected)
	}
	// The existing clone was reused (valid .git found), not re-cloned: no status
	// write happens on the reuse path.
	if got := repo.updateCount(); got != 0 {
		t.Fatalf("repo.Update called %d times, want 0 (existing clone reused, not re-cloned)", got)
	}
}

func TestEnsureCloneReady_DataLossGuard_ContentWithoutGit(t *testing.T) {
	t.Parallel()
	remote := gittest.NewRemote(t, gittest.WithSeed(map[string]string{"README.md": "hello"}, "seed"))
	repo := newFakeRepoRepo()
	base := t.TempDir()
	svc := gitrepo.NewGitOpsService(repo, fakeResolver{}, base, nil)

	// The clone dir exists with content but no .git — the corruption case. A
	// destructive re-clone here would silently lose unsaved spec/design drafts.
	expected := filepath.Join(base, "org1", "proj1")
	if err := os.MkdirAll(expected, 0o755); err != nil {
		t.Fatal(err)
	}
	draft := filepath.Join(expected, "draft.md")
	if err := os.WriteFile(draft, []byte("precious unsaved draft"), 0o644); err != nil {
		t.Fatal(err)
	}

	rec := &models.GitRepository{OrgID: "org1", ProjectID: "proj1", RepoURL: remote.URL(), ClonePath: expected}
	err := svc.EnsureCloneReady(testContext(), rec)
	if !errors.Is(err, gitrepo.ErrCloneCorrupt) {
		t.Fatalf("err = %v, want ErrCloneCorrupt", err)
	}
	// The directory and its content MUST survive — the guard's whole point.
	if b, rerr := os.ReadFile(draft); rerr != nil || string(b) != "precious unsaved draft" {
		t.Fatalf("draft after guard = %q (err %v), want content preserved", b, rerr)
	}
	if got := repo.updateCount(); got != 0 {
		t.Fatalf("repo.Update called %d times, want 0 (no status write on corrupt)", got)
	}
}

func TestEnsureCloneReady_EmptyDirReclones(t *testing.T) {
	t.Parallel()
	remote := gittest.NewRemote(t, gittest.WithSeed(map[string]string{"README.md": "hello"}, "seed"))
	repo := newFakeRepoRepo()
	base := t.TempDir()
	svc := gitrepo.NewGitOpsService(repo, fakeResolver{}, base, nil)

	// An EMPTY directory at the path is "no content to lose" — the re-clone
	// renames over it.
	expected := filepath.Join(base, "org1", "proj1")
	if err := os.MkdirAll(expected, 0o755); err != nil {
		t.Fatal(err)
	}

	rec := &models.GitRepository{OrgID: "org1", ProjectID: "proj1", RepoURL: remote.URL(), ClonePath: expected}
	if err := svc.EnsureCloneReady(testContext(), rec); err != nil {
		t.Fatalf("EnsureCloneReady: %v", err)
	}
	if _, err := os.Stat(filepath.Join(expected, ".git")); err != nil {
		t.Fatalf(".git missing after re-clone into empty dir: %v", err)
	}
	if rec.Status != "ready" {
		t.Fatalf("status = %q, want ready", rec.Status)
	}
}

func TestCleanupOrphanTmpClones(t *testing.T) {
	t.Parallel()
	base := t.TempDir()
	orgDir := filepath.Join(base, "org1")

	// An orphaned tmpclone from a crashed mid-clone, plus a real clone.
	orphan := filepath.Join(orgDir, ".tmpclone-proj1-abc123")
	if err := os.MkdirAll(orphan, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(orphan, "partial"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	real := filepath.Join(orgDir, "proj1", ".git")
	if err := os.MkdirAll(real, 0o755); err != nil {
		t.Fatal(err)
	}

	svc := gitrepo.NewGitOpsService(newFakeRepoRepo(), fakeResolver{}, base, nil)
	svc.CleanupOrphanTmpClones()

	if _, err := os.Stat(orphan); !os.IsNotExist(err) {
		t.Fatalf("orphan tmpclone still present (err=%v), want removed", err)
	}
	if _, err := os.Stat(filepath.Join(orgDir, "proj1")); err != nil {
		t.Fatalf("real clone dir was removed: %v", err)
	}
}

func TestPreWarmClones_WarmsReadySkipsSentinelCountsFailures(t *testing.T) {
	t.Parallel()
	remote := gittest.NewRemote(t, gittest.WithSeed(map[string]string{"README.md": "hello"}, "seed"))
	repo := newFakeRepoRepo()
	base := t.TempDir()
	svc := gitrepo.NewGitOpsService(repo, fakeResolver{}, base, nil)

	repo.preload(
		&models.GitRepository{OrgID: "org1", ProjectID: "projA", RepoURL: remote.URL(), Status: "ready"},
		// The per-org skills repo is API-only — never cloned. Skipped by sentinel.
		&models.GitRepository{OrgID: "org1", ProjectID: models.SkillsRepoSentinelProjectID, RepoURL: remote.URL(), Status: "ready"},
		// A ready repo whose remote can't be cloned → counted as failed.
		&models.GitRepository{OrgID: "org1", ProjectID: "projD", RepoURL: "file:///nonexistent-remote-xyz.git", Status: "ready"},
	)

	warmed, failed := svc.PreWarmClones(testContext(), 3)
	if warmed != 1 || failed != 1 {
		t.Fatalf("PreWarmClones = (warmed %d, failed %d), want (1, 1)", warmed, failed)
	}
	if _, err := os.Stat(filepath.Join(base, "org1", "projA", ".git")); err != nil {
		t.Fatalf("projA clone missing after pre-warm: %v", err)
	}
	// The sentinel repo was never cloned.
	if _, err := os.Stat(filepath.Join(base, "org1", models.SkillsRepoSentinelProjectID)); !os.IsNotExist(err) {
		t.Fatalf("skills sentinel was cloned (err=%v), want skipped", err)
	}
}

func TestBestEffortPullDefaultBranch_AdvancesRefRefreshesIndexLeavesDraftsAlone(t *testing.T) {
	t.Parallel()
	remote := gittest.NewRemote(t, gittest.WithSeed(map[string]string{"README.md": "root"}, "seed"))
	repo := newFakeRepoRepo()
	svc := gitrepo.NewGitOpsService(repo, fakeResolver{}, t.TempDir(), nil)

	clonePath := remote.Clone(t)

	// saved.md mirrors a draft the save flow just committed to the remote; the
	// working-tree copy is byte-identical to what's on the new remote HEAD.
	if err := os.WriteFile(filepath.Join(clonePath, "saved.md"), []byte("saved content"), 0o644); err != nil {
		t.Fatal(err)
	}
	// pure-draft.md is an untracked local draft NOT on the remote — it must be
	// left completely alone by the pull.
	if err := os.WriteFile(filepath.Join(clonePath, "pure-draft.md"), []byte("pure draft"), 0o644); err != nil {
		t.Fatal(err)
	}

	// The remote advances to include saved.md (the save's commit).
	remote.Seed(t, map[string]string{"saved.md": "saved content"}, "save commit")

	rec := &models.GitRepository{OrgID: "org1", ProjectID: "proj1", RepoURL: remote.URL(), ClonePath: clonePath, DefaultBranch: "main"}
	if err := svc.BestEffortPullDefaultBranch(testContext(), rec); err != nil {
		t.Fatalf("BestEffortPullDefaultBranch: %v", err)
	}

	// 1. Local branch ref advanced to the remote tip.
	if got, want := gitOut(t, clonePath, "rev-parse", "refs/heads/main"), remote.HeadSHA(t); got != want {
		t.Fatalf("local main = %s, want remote head %s (ref not advanced)", got, want)
	}

	status := gitOut(t, clonePath, "status", "--porcelain")

	// 2. Index refreshed to HEAD: the just-saved file matches HEAD and the
	//    working tree, so it is CLEAN — not reported as modified/added. (This is
	//    the read-tree step; without it, saved.md shows up here.)
	if strings.Contains(status, "saved.md") {
		t.Fatalf("git status = %q, want saved.md absent (index not refreshed to HEAD)", status)
	}
	// 3. The untracked local draft is left alone — still on disk, still its
	//    content, still untracked.
	if b, err := os.ReadFile(filepath.Join(clonePath, "pure-draft.md")); err != nil || string(b) != "pure draft" {
		t.Fatalf("pure-draft.md = %q (err %v), want left untouched", b, err)
	}
	if !strings.Contains(status, "pure-draft.md") {
		t.Fatalf("git status = %q, want pure-draft.md listed as untracked", status)
	}
}

func TestRepoLock_SamePerProjectDistinctAcrossProjects(t *testing.T) {
	t.Parallel()
	svc := gitrepo.NewGitOpsService(newFakeRepoRepo(), fakeResolver{}, t.TempDir(), nil)

	p1a := svc.RepoLock("p1")
	p1b := svc.RepoLock("p1")
	p2 := svc.RepoLock("p2")
	if p1a != p1b {
		t.Fatal("RepoLock(p1) returned different mutexes across calls")
	}
	if p1a == p2 {
		t.Fatal("RepoLock(p1) and RepoLock(p2) returned the same mutex")
	}
}
