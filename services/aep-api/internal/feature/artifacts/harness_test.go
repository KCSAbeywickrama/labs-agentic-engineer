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

// Shared harness for the GitHub-direct artifact tests. The gittest tier
// (docs/design/aep-api-target-structure.md — "Git testing") runs the REAL code
// paths, not mocked git:
//
//   - a real bare repo whose `main` tip IS the draft "working tree"
//     (gittest.NewRemote; arranged with r.seed / r.tag),
//   - the REAL GitHub client (clients/github) pointed at a real Git-Data-API
//     fake backed by that same bare repo (gittest.GitDataServer + WithAPIBase),
//   - the REAL gitrepo.gitOpsService as the GitGateway (GitData + Resolver +
//     ResolveSaveIdentities) — no clone,
//   - the REAL artifacts.ArtifactService over all of the above.
//
// Only the two edges the flow doesn't own are faked: the RepoRepository row (a
// single in-memory GitRepository) and the credential Resolver (a static token +
// identity). save→tag / discard→revert-commit / read-at-HEAD / read-at-tag
// therefore run end-to-end over genuine git object-store semantics, offline.

import (
	"context"
	"os"
	"os/exec"
	"regexp"
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

// stubRepoRepo returns one fixed GitRepository row.
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
// identity. ResolveSaveIdentities reads Identity(); the Git Data API fake
// accepts any Authorization header, so the token is never checked.
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
	t      *testing.T
	svc    ArtifactService
	remote *gittest.Remote
	gd     *gittest.GitData
	rec    *models.GitRepository
	org    string
	proj   string
}

var idSanitize = regexp.MustCompile(`[^A-Za-z0-9_-]`)

// idsFor derives a unique (orgID, projectID) from the test name so the
// package-global CAS leaky bucket (keyed "<org>:<proj>") is never shared between
// parallel tests.
func idsFor(t *testing.T) (string, string) {
	safe := idSanitize.ReplaceAllString(t.Name(), "-")
	return "org-" + safe, "proj-" + safe
}

// newRig seeds a bare origin's `main` with `seed` (repo-relative path → content)
// as the initial draft, stands up the Git Data API fake over it, and wires the
// real gitOps GitGateway + artifact service. No clone.
func newRig(t *testing.T, seed map[string]string) *rig {
	t.Helper()
	org, proj := idsFor(t)
	remote := gittest.NewRemote(t, gittest.WithSeed(seed, "seed"))
	gd := gittest.GitDataServer(t, remote)
	gh := githubclient.NewClient(githubclient.WithAPIBase(gd.URL))

	rec := &models.GitRepository{
		OrgID:         org,
		ProjectID:     proj,
		RepoURL:       "https://github.com/acme/widgets.git",
		DefaultBranch: "main",
		Status:        "ready",
	}
	repoRepo := &stubRepoRepo{rec: rec}
	gitOps := gitrepo.NewGitOpsService(stubResolver{}, gh)
	svc := NewArtifactService(repoRepo, gitOps)

	return &rig{t: t, svc: svc, remote: remote, gd: gd, rec: rec, org: org, proj: proj}
}

// ----- arrange / assert helpers (against the bare origin = the draft) -----

// seed advances `main` with the given files (a new draft commit).
func (r *rig) seed(files map[string]string, msg string) string {
	r.t.Helper()
	return r.remote.Seed(r.t, files, msg)
}

// tag creates an annotated tag on the current `main` tip.
func (r *rig) tag(name, msg string) {
	r.t.Helper()
	r.remote.Tag(r.t, name, msg)
}

func (r *rig) tags() []string              { return r.remote.Tags(r.t) }
func (r *rig) headSHA() string             { return r.remote.HeadSHA(r.t) }
func (r *rig) fileAt(ref, p string) string { return r.remote.FileAt(r.t, ref, p) }

// blobExistsAt reports whether ref:path resolves to a blob in the bare repo
// (a non-fatal probe — `cat-file -e` exits non-zero when the path is absent).
func (r *rig) blobExistsAt(ref, p string) bool {
	r.t.Helper()
	c := exec.Command("git", "--git-dir="+r.remote.Dir(), "cat-file", "-e", ref+":"+p)
	c.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL="+os.DevNull, "GIT_CONFIG_SYSTEM="+os.DevNull)
	return c.Run() == nil
}
