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

package artifacts

// Shared harness for the git-backed artifact tests. The whole point of the
// gittest tier (docs/design/aep-api-target-structure.md — "Git testing") is to
// run the REAL code paths, not mock git behind an interface:
//
//   - a real bare-repo file:// origin (gittest.NewRemote),
//   - the REAL GitHub client (clients/github) pointed at a real Git-Data-API
//     fake backed by that same bare repo (gittest.GitDataServer + WithAPIBase),
//   - the REAL gitrepo.gitOpsService as the GitWorkspace (real per-project
//     locks, real EnsureCloneReady clone-on-first-use, real post-save pull),
//   - the REAL artifacts.ArtifactService over all of the above.
//
// Only the two edges the flow doesn't own are faked: the RepoRepository row
// (a single in-memory GitRepository) and the credential Resolver (a static
// token + identity). save→tag→pull→read-at-tag→discard therefore runs
// end-to-end over genuine git object-store semantics, offline.

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	githubclient "github.com/wso2/aep/aep-api/internal/clients/github"
	"github.com/wso2/aep/aep-api/internal/credentials"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/platform/gittest"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// ----- faked edges: RepoRepository row + credential resolver -----

// stubRepoRepo returns one fixed GitRepository row. The pointer is stable, so
// mutations EnsureCloneReady makes (ClonePath, DefaultBranch) persist across
// calls — matching how the DB-backed repo would hand back the same row state.
type stubRepoRepo struct{ rec *models.GitRepository }

var _ repositories.RepoRepository = (*stubRepoRepo)(nil)

func (s *stubRepoRepo) GetByOrgAndProjectID(context.Context, string, string) (*models.GitRepository, error) {
	return s.rec, nil
}
func (s *stubRepoRepo) GetByOrgAndSlug(context.Context, string, string) (*models.GitRepository, error) {
	return nil, gitrepo.ErrRepoNotFound
}
func (s *stubRepoRepo) ListAllReady(context.Context) ([]models.GitRepository, error) {
	return nil, nil
}
func (s *stubRepoRepo) Create(context.Context, *models.GitRepository) error { return nil }
func (s *stubRepoRepo) Update(context.Context, *models.GitRepository) error { return nil }
func (s *stubRepoRepo) DeleteByOrgAndProjectID(context.Context, string, string) error {
	return nil
}

// stubCred / stubResolver hand the save flow a static token + committer
// identity. ResolveSaveIdentities reads Identity(); file:// remotes never
// invoke GIT_ASKPASS, so the token is only ever accepted, never checked.
type stubCred struct{}

func (stubCred) Token(context.Context) (string, time.Time, error) {
	return "test-token", time.Time{}, nil
}
func (stubCred) Identity() credentials.Identity {
	return credentials.Identity{Name: "Bot", Email: "bot@aep.dev", Login: "bot"}
}
func (stubCred) RepoOwner() string                            { return "acme" }
func (stubCred) WebhookStrategy() credentials.WebhookStrategy { return credentials.WebhookPlatform }

type stubResolver struct{}

func (stubResolver) Resolve(context.Context, string) (credentials.Credential, error) {
	return stubCred{}, nil
}

// ----- rig -----

type rig struct {
	t         *testing.T
	svc       ArtifactService
	gitOps    gitrepo.GitOpsService
	remote    *gittest.Remote
	gd        *gittest.GitData
	rec       *models.GitRepository
	clonePath string
	org       string
	proj      string
}

var idSanitize = regexp.MustCompile(`[^A-Za-z0-9_-]`)

// idsFor derives a unique (orgID, projectID) from the test name so the
// package-global CAS leaky bucket (keyed "<org>:<proj>") is never shared
// between parallel tests, and each test's clone lives under its own dir.
func idsFor(t *testing.T) (string, string) {
	safe := idSanitize.ReplaceAllString(t.Name(), "-")
	return "org-" + safe, "proj-" + safe
}

// newRig seeds a bare origin with `seed` (repo-relative path → content), stands
// up the Git-Data-API fake over it, wires the real gitOps + artifact service,
// and eagerly clones so tests can arrange the working tree via r.clonePath.
func newRig(t *testing.T, seed map[string]string) *rig {
	t.Helper()
	org, proj := idsFor(t)
	remote := gittest.NewRemote(t, gittest.WithSeed(seed, "seed"))
	gd := gittest.GitDataServer(t, remote)
	gh := githubclient.NewClient(githubclient.WithAPIBase(gd.URL))

	rec := &models.GitRepository{
		OrgID:         org,
		ProjectID:     proj,
		RepoURL:       remote.URL(),
		DefaultBranch: "main",
		Status:        "ready",
	}
	repoRepo := &stubRepoRepo{rec: rec}
	gitOps := gitrepo.NewGitOpsService(repoRepo, stubResolver{}, t.TempDir(), gh)
	svc := NewArtifactService(repoRepo, gitOps)

	if err := gitOps.EnsureCloneReady(context.Background(), rec); err != nil {
		t.Fatalf("ensure clone: %v", err)
	}
	// The clone is done and its `origin` remote is baked in to the file:// URL,
	// so post-save pulls keep working. The save flow, however, addresses the
	// repo over the Git Data API and derives owner/repo from RepoURL via
	// models.OwnerRepoFromURL, which only parses github.com URLs. Swap RepoURL
	// to a github.com form now: EnsureCloneReady won't re-clone (the .git dir
	// exists) and the GitDataServer ignores the owner/repo path segments, so
	// the fake serves the same bare repo regardless.
	rec.RepoURL = "https://github.com/acme/widgets.git"
	return &rig{
		t: t, svc: svc, gitOps: gitOps, remote: remote, gd: gd,
		rec: rec, clonePath: rec.ClonePath, org: org, proj: proj,
	}
}

// ----- working-tree arrange/assert helpers -----

func (r *rig) writeWT(relPath, content string) {
	r.t.Helper()
	abs := filepath.Join(r.clonePath, relPath)
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		r.t.Fatalf("mkdir %s: %v", relPath, err)
	}
	if err := os.WriteFile(abs, []byte(content), 0o644); err != nil {
		r.t.Fatalf("write %s: %v", relPath, err)
	}
}

func (r *rig) rmWT(relPath string) {
	r.t.Helper()
	if err := os.Remove(filepath.Join(r.clonePath, relPath)); err != nil {
		r.t.Fatalf("remove %s: %v", relPath, err)
	}
}

func (r *rig) readWT(relPath string) (string, bool) {
	r.t.Helper()
	data, err := os.ReadFile(filepath.Join(r.clonePath, relPath))
	if os.IsNotExist(err) {
		return "", false
	}
	if err != nil {
		r.t.Fatalf("read %s: %v", relPath, err)
	}
	return string(data), true
}

// git runs a plumbing command in the clone with a hermetic identity so local
// arrange-commits (e.g. building a local-HEAD-only file) are deterministic and
// independent of the developer's ~/.gitconfig.
func (r *rig) git(args ...string) {
	r.t.Helper()
	cmd := exec.Command("git", append([]string{"-C", r.clonePath}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_CONFIG_GLOBAL="+os.DevNull,
		"GIT_CONFIG_SYSTEM="+os.DevNull,
		"GIT_AUTHOR_NAME=arrange", "GIT_AUTHOR_EMAIL=arrange@aep.test",
		"GIT_COMMITTER_NAME=arrange", "GIT_COMMITTER_EMAIL=arrange@aep.test",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		r.t.Fatalf("git %s: %v: %s", strings.Join(args, " "), err, out)
	}
}

// fetchTags mirrors what fetchAndListAllTags does internally: pulls remote tags
// into the local clone. Read-at-tag paths (GetRequirementsAtTag/GetDesignAtTag)
// do NOT fetch, so tests that tag the remote after cloning call this to make
// the tag locally visible.
func (r *rig) fetchTags() {
	r.t.Helper()
	r.git("fetch", "--tags", "origin")
}

// localHEAD returns the clone's current HEAD commit SHA.
func (r *rig) localHEAD() string {
	r.t.Helper()
	out, err := runGitOutput(context.Background(), r.clonePath, "rev-parse", "HEAD")
	if err != nil {
		r.t.Fatalf("rev-parse HEAD: %v", err)
	}
	return strings.TrimSpace(out)
}

// blobExistsAt reports whether ref:path resolves to a blob in the bare repo.
// An error from `cat-file -e` means the path is absent at ref.
func (r *rig) blobExistsAt(ref, path string) bool {
	r.t.Helper()
	c := exec.Command("git", "--git-dir="+r.remote.Dir(), "cat-file", "-e", ref+":"+path)
	c.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL="+os.DevNull, "GIT_CONFIG_SYSTEM="+os.DevNull)
	return c.Run() == nil
}
