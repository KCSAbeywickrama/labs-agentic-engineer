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

package gitrepo

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"regexp"
	"strings"

	"github.com/wso2/aep/aep-api/internal/credentials"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// RepoService manages git repository lifecycle (create, get, delete).
type RepoService interface {
	// CreateRepo provisions the project's GitHub repo. repoName == "" derives
	// the name from projectName plus a random suffix (retrying on conflict);
	// a non-empty repoName is user-chosen and used VERBATIM — a name conflict
	// fails with ErrRepoNameConflict instead of being suffixed away.
	CreateRepo(ctx context.Context, orgID, projectID, projectName, repoName string) (*models.GitRepository, error)
	// EnsureBareRepo idempotently provisions a private repo with a STABLE name
	// (no random suffix) and NO local clone — used for the per-org skills repo
	// (sentinel projectID, e.g. "_skills"). AutoInit gives it a `main` branch +
	// base tree so the first API commit has a parent. If the GitHub repo already
	// exists (name conflict), it is adopted (cloneURL derived from owner+name)
	// so the call stays idempotent across a lost DB row.
	// See docs/design/skills-repo-storage.md §10.
	EnsureBareRepo(ctx context.Context, orgID, projectID, repoName string) (*models.GitRepository, error)
	GetRepo(ctx context.Context, orgID, projectID string) (*models.GitRepository, error)
	// SetWebhookID is called by the webhook registration service after a hook
	// is provisioned for the repo on GitHub. Stored alongside the repo record
	// so cleanup can deregister.
	SetWebhookID(ctx context.Context, orgID, projectID string, hookID int64) error
	DeleteRepo(ctx context.Context, orgID, projectID string) error
}

type repoService struct {
	repo     repositories.RepoRepository
	github   RepoAdmin
	resolver credentials.Resolver
	repoVis  string
	// workspaceTrash, when set (from the composition root), renames the
	// repo's on-disk workspace subtree into trash after the DB row is
	// deleted — phase 1 of the two-phase disk delete (design §14/D12).
	// Best-effort by contract: it returns nothing and must never fail the
	// caller; the reaper's orphan pass is the correctness backstop.
	workspaceTrash func(ctx context.Context, orgID, projectID, repoSlug string)
}

// RepoServiceOption customizes NewRepoService wiring without churning its
// positional signature.
type RepoServiceOption func(*repoService)

// WithWorkspaceTrash installs the best-effort disk-trash hook DeleteRepo
// fires after a successful DB delete. nil-safe (a nil fn leaves the hook
// unset).
func WithWorkspaceTrash(fn func(ctx context.Context, orgID, projectID, repoSlug string)) RepoServiceOption {
	return func(s *repoService) { s.workspaceTrash = fn }
}

func NewRepoService(
	repo repositories.RepoRepository,
	github RepoAdmin,
	resolver credentials.Resolver,
	repoVisibility string,
	opts ...RepoServiceOption,
) RepoService {
	s := &repoService{
		repo:     repo,
		github:   github,
		resolver: resolver,
		repoVis:  repoVisibility,
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

func (s *repoService) CreateRepo(ctx context.Context, orgID, projectID, projectName, repoName string) (*models.GitRepository, error) {
	slog.InfoContext(ctx, "creating repository", "org", orgID, "project", projectID, "name", projectName, "repoName", repoName)
	if orgID == "" {
		return nil, fmt.Errorf("orgID is required")
	}

	// Idempotent on (ocOrgId, project): a repeat-create returns the existing
	// row instead of erroring. Repo provisioning is the entry-point for many
	// flows (project creation, retry, drift fix), all of which should be safe
	// to retry. See evolution-doc §7.1 and phase0 §1.11.
	existing, err := s.repo.GetByOrgAndProjectID(ctx, orgID, projectID)
	if err != nil {
		return nil, fmt.Errorf("check existing repo: %w", err)
	}
	if existing != nil {
		slog.InfoContext(ctx, "repo already provisioned for project; returning existing row",
			"projectId", projectID, "orgId", orgID)
		return existing, nil
	}

	cred, err := s.resolver.Resolve(ctx, orgID)
	if err != nil {
		return nil, fmt.Errorf("resolve credential for org %q: %w", orgID, err)
	}

	description := fmt.Sprintf("WSO2 Labs Agentic Engineer project %s", projectName)

	var cloneURL string
	if repoName != "" {
		// User-chosen name: create it VERBATIM. A conflict propagates
		// (ErrRepoNameConflict survives the wrap) — suffixing a name the user
		// picked would silently betray it.
		cloneURL, err = s.github.CreateOrgRepo(ctx, cred, CreateOrgRepoRequest{
			Name:        repoName,
			Private:     strings.EqualFold(s.repoVis, "private"),
			AutoInit:    true,
			Description: description,
		})
	} else {
		repoName, cloneURL, err = s.createGitHubRepoWithRetry(ctx, cred, slugifyProjectName(projectName), description)
	}
	if err != nil {
		return nil, fmt.Errorf("create github repo: %w", err)
	}

	// Compute the per-repo slug from the GitHub clone URL — used by
	// StageBuildSecret to validate (ocOrgId, repoSlug) ownership. The
	// build credential itself is now pre-staged per WorkflowRun directly
	// as a K8s Secret in workflows-<ocOrgID> (see
	// docs/design/build-credential-injection.md), so no SecretReference
	// name is computed here; OcSecretRefName is left nil on new rows.
	repoSlug := models.SlugForURL(cloneURL)

	// The repo is ready the moment GitHub has it: reads/writes/tags go through
	// the Git Data API (docs/design/agents-generation-migration.md §5), so there
	// is no local clone to warm and no "cloning" state to wait through.
	gitRepo := &models.GitRepository{
		OrgID:         orgID,
		ProjectID:     projectID,
		RepoURL:       cloneURL,
		DefaultBranch: "main", // AutoInit gives the repo a main branch + base tree
		Status:        "ready",
		RepoSlug:      repoSlug,
	}

	if err := s.repo.Create(ctx, gitRepo); err != nil {
		return nil, fmt.Errorf("create repo record: %w", err)
	}

	slog.InfoContext(ctx, "created platform repo",
		"owner", cred.RepoOwner(), "name", repoName, "project", projectID, "org", orgID)

	return gitRepo, nil
}

// createGitHubRepoWithRetry rolls a fresh 3-digit suffix per attempt. Up to 5 retries on name conflict.
func (s *repoService) createGitHubRepoWithRetry(ctx context.Context, cred credentials.Credential, slug, description string) (repoName, cloneURL string, err error) {
	for attempt := 1; attempt <= 5; attempt++ {
		name := fmt.Sprintf("%s%03d", slug, rand.IntN(1000))
		cloneURL, err = s.github.CreateOrgRepo(ctx, cred, CreateOrgRepoRequest{
			Name:        name,
			Private:     strings.EqualFold(s.repoVis, "private"),
			AutoInit:    true,
			Description: description,
		})
		if err == nil {
			return name, cloneURL, nil
		}
		if !IsRepoNameConflict(err) {
			return "", "", err
		}
	}
	return "", "", fmt.Errorf("repo name for %q unavailable after 5 attempts: %w", slug, err)
}

func (s *repoService) EnsureBareRepo(ctx context.Context, orgID, projectID, repoName string) (*models.GitRepository, error) {
	if orgID == "" || projectID == "" || repoName == "" {
		return nil, fmt.Errorf("orgID, projectID and repoName are required")
	}
	// Idempotent on (ocOrgId, projectID): a repeat-create returns the existing row.
	existing, err := s.repo.GetByOrgAndProjectID(ctx, orgID, projectID)
	if err != nil {
		return nil, fmt.Errorf("check existing repo: %w", err)
	}
	if existing != nil {
		return existing, nil
	}

	cred, err := s.resolver.Resolve(ctx, orgID)
	if err != nil {
		return nil, fmt.Errorf("resolve credential for org %q: %w", orgID, err)
	}

	cloneURL, err := s.github.CreateOrgRepo(ctx, cred, CreateOrgRepoRequest{
		Name:        repoName,
		Private:     true,
		AutoInit:    true,
		Description: "WSO2 Labs Agentic Engineer — org skills (single source of truth)",
	})
	if err != nil {
		if !IsRepoNameConflict(err) {
			return nil, fmt.Errorf("create github skills repo: %w", err)
		}
		// Adopt a pre-existing repo of the same name under this owner.
		cloneURL = fmt.Sprintf("https://github.com/%s/%s", cred.RepoOwner(), repoName)
		slog.InfoContext(ctx, "adopting pre-existing skills repo", "owner", cred.RepoOwner(), "name", repoName, "org", orgID)
	}

	gitRepo := &models.GitRepository{
		OrgID:         orgID,
		ProjectID:     projectID,
		RepoURL:       cloneURL,
		DefaultBranch: "main",
		Status:        "ready", // no clone — the BFF reads/writes via the GitHub API
		RepoSlug:      models.SlugForURL(cloneURL),
	}
	if err := s.repo.Create(ctx, gitRepo); err != nil {
		// A concurrent caller (e.g. the skills list + updates-badge requests
		// firing together on page load) may have inserted the (org, projectID)
		// row first — the unique constraint rejects ours. Adopt the winner's
		// row so EnsureBareRepo stays idempotent under concurrency.
		if winner, gerr := s.repo.GetByOrgAndProjectID(ctx, orgID, projectID); gerr == nil && winner != nil {
			slog.InfoContext(ctx, "skills repo row created concurrently; adopting existing", "org", orgID, "project", projectID)
			return winner, nil
		}
		return nil, fmt.Errorf("create skills repo record: %w", err)
	}
	slog.InfoContext(ctx, "provisioned bare skills repo",
		"owner", cred.RepoOwner(), "name", repoName, "org", orgID)
	return gitRepo, nil
}

func (s *repoService) GetRepo(ctx context.Context, orgID, projectID string) (*models.GitRepository, error) {
	repo, err := s.repo.GetByOrgAndProjectID(ctx, orgID, projectID)
	if err != nil {
		return nil, fmt.Errorf("get repo: %w", err)
	}
	if repo == nil {
		return nil, ErrRepoNotFound
	}
	return repo, nil
}

func (s *repoService) SetWebhookID(ctx context.Context, orgID, projectID string, hookID int64) error {
	repo, err := s.repo.GetByOrgAndProjectID(ctx, orgID, projectID)
	if err != nil {
		return fmt.Errorf("get repo: %w", err)
	}
	if repo == nil {
		return ErrRepoNotFound
	}
	id := hookID
	repo.WebhookID = &id
	return s.repo.Update(ctx, repo)
}

func (s *repoService) DeleteRepo(ctx context.Context, orgID, projectID string) error {
	repo, err := s.repo.GetByOrgAndProjectID(ctx, orgID, projectID)
	if err != nil {
		return fmt.Errorf("get repo: %w", err)
	}
	if repo == nil {
		return ErrRepoNotFound
	}

	if err := s.repo.DeleteByOrgAndProjectID(ctx, orgID, projectID); err != nil {
		return fmt.Errorf("delete repo record: %w", err)
	}

	// Best-effort disk cleanup AFTER the DB delete succeeded: rename the
	// workspace subtree into trash (O(1); open fds keep working — design
	// §14). The hook logs its own failures and never fails this call.
	if s.workspaceTrash != nil {
		s.workspaceTrash(ctx, orgID, projectID, repo.WorkspaceSlug())
	}
	return nil
}

var repoSlugInvalid = regexp.MustCompile(`[^a-z0-9-]+`)

// slugifyProjectName produces the slug portion of a repo name. The 3-digit suffix is added by the caller.
func slugifyProjectName(projectName string) string {
	slug := strings.ToLower(projectName)
	slug = repoSlugInvalid.ReplaceAllString(slug, "-")
	slug = strings.Trim(slug, "-")
	for strings.Contains(slug, "--") {
		slug = strings.ReplaceAll(slug, "--", "-")
	}
	if len(slug) > 40 {
		slug = strings.TrimRight(slug[:40], "-")
	}
	if slug == "" {
		return "project"
	}
	return slug
}
