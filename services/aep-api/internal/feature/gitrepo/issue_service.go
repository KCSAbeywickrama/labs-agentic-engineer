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
	"strings"
	"sync"

	"github.com/wso2/aep/aep-api/internal/credentials"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// IssueService creates and lists GitHub issues on project repositories.
type IssueService interface {
	CreateIssue(ctx context.Context, orgID, projectID string, req CreateIssueRequest) (*IssueResult, error)
	ListIssues(ctx context.Context, orgID, projectID string, labels []string) ([]IssueInfo, error)
	// CloseIssue closes the issue, optionally posting a closing comment first.
	CloseIssue(ctx context.Context, orgID, projectID string, number int, comment string) error
	// CommentIssue posts a comment on the issue.
	CommentIssue(ctx context.Context, orgID, projectID string, number int, body string) error
	// EditIssueBody replaces the issue's body. Used by the tech-lead detail
	// phase to write the LLM-authored body after the placeholder issue was
	// created.
	EditIssueBody(ctx context.Context, orgID, projectID string, number int, body string) error
}

type issueService struct {
	repo     repositories.RepoRepository
	github   GitHubClient
	githubV2 GitHubV2Client
	resolver credentials.Resolver
	// createLocks serializes dedupe-checked creation per "owner/repo" so two
	// concurrent CreateIssue calls with the same DedupeKey can't both pass the
	// existing-issue check before either creates — the exact race that produced
	// duplicate SRE/RCA issues when multiple alert rules fired for one incident.
	// In-process: correct within this aep-api instance (the deployment runs
	// one). Across replicas the check-then-create window shrinks from the
	// caller's whole run to a single list+create roundtrip, not zero — a DB
	// unique constraint would be needed for cross-replica atomicity.
	createLocks sync.Map // map[string]*sync.Mutex
}

func NewIssueService(repo repositories.RepoRepository, github GitHubClient, githubV2 GitHubV2Client, resolver credentials.Resolver) IssueService {
	return &issueService{
		repo:     repo,
		github:   github,
		githubV2: githubV2,
		resolver: resolver,
	}
}

func (s *issueService) CreateIssue(ctx context.Context, orgID, projectID string, req CreateIssueRequest) (*IssueResult, error) {
	if strings.TrimSpace(req.Title) == "" {
		return nil, fmt.Errorf("title is required")
	}

	owner, repoName, cred, err := s.resolveRepoAndCredential(ctx, orgID, projectID)
	if err != nil {
		return nil, err
	}

	if key := strings.TrimSpace(req.DedupeKey); key != "" {
		req.DedupeKey = "" // aep-api-only field; must not reach GitHub
		label := dedupeLabelFor(key)

		unlock := s.lockRepoCreates(owner, repoName)
		defer unlock()

		existing, listErr := s.github.ListIssues(ctx, owner, repoName, cred, []string{label})
		if listErr != nil {
			// Best-effort: a failed lookup must not block filing the issue; at
			// worst we regress to a possible duplicate.
			slog.WarnContext(ctx, "dedupe lookup failed, creating without dedup check",
				"project", projectID, "label", label, "error", listErr)
		} else {
			for _, iss := range existing {
				if strings.EqualFold(iss.State, "open") {
					slog.InfoContext(ctx, "issue create deduped to existing open issue",
						"project", projectID, "label", label, "issue", iss.Number)
					return &IssueResult{Number: iss.Number, URL: iss.URL, Deduped: true}, nil
				}
			}
		}
		req.Labels = append(req.Labels, label)
	}

	// Ensure all requested labels exist in the repo before creating the issue.
	// GitHub silently drops labels that don't exist, so we create them up-front.
	for _, label := range req.Labels {
		color := labelColor(label)
		if ensureErr := s.github.EnsureLabel(ctx, owner, repoName, cred, label, color); ensureErr != nil {
			// Non-fatal: log and continue; the issue will be created without the missing label.
			slog.WarnContext(ctx, "ensure github label failed", "label", label, "error", ensureErr)
		}
	}

	issue, err := s.github.CreateIssue(ctx, owner, repoName, cred, req)
	if err != nil {
		return nil, err
	}

	gitRepo, repoErr := s.repo.GetByOrgAndProjectID(ctx, orgID, projectID)
	if repoErr == nil && gitRepo != nil {
		// Mint the V2 (GraphQL) bearer once and reuse for the up-to-three
		// sequential ensureBoard + addIssueToProject calls. App-installation
		// tokens are 1h-TTL but the per-call latency we'd add by re-resolving
		// is wasted work.
		token, _, tokenErr := cred.Token(ctx)
		if tokenErr != nil {
			slog.WarnContext(ctx, "fetch credential token for board ops failed", "project", projectID, "error", tokenErr)
		} else {
			if gitRepo.GithubProjectID == "" {
				if boardID, err := s.ensureBoard(ctx, gitRepo, owner, repoName, token); err == nil {
					gitRepo.GithubProjectID = boardID
					if updateErr := s.repo.Update(ctx, gitRepo); updateErr != nil {
						slog.WarnContext(ctx, "failed to persist github project id after lazy creation", "project", projectID, "error", updateErr)
					}
				}
			}
			s.addIssueToProject(ctx, gitRepo.GithubProjectID, issue, token)
		}
	}

	return issue, nil
}

// lockRepoCreates acquires the per-repo creation lock and returns its release
// func. See the createLocks field doc for why this exists.
func (s *issueService) lockRepoCreates(owner, repo string) func() {
	v, _ := s.createLocks.LoadOrStore(owner+"/"+repo, &sync.Mutex{})
	mu := v.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

// dedupeLabelFor turns a caller-supplied dedupe key into the GitHub label that
// marks issues created with that key. Whitespace collapses to "-" and the
// result is capped at GitHub's 50-char label limit — the cap is deterministic
// (same key → same label), so we truncate rather than hash.
func dedupeLabelFor(key string) string {
	label := "dedupe:" + strings.ToLower(strings.Join(strings.Fields(key), "-"))
	if len(label) > 50 {
		label = label[:50]
	}
	return label
}

func (s *issueService) ensureBoard(ctx context.Context, gitRepo *models.GitRepository, owner, repoName, token string) (string, error) {
	orgNodeID, err := s.githubV2.GetOrgID(ctx, owner, token)
	if err != nil {
		return "", fmt.Errorf("resolve org id during lazy board create: %w", err)
	}

	githubProjectID, err := s.githubV2.CreateGitHubV2Project(ctx, orgNodeID, token, gitRepo.ProjectID)
	if err != nil {
		return "", fmt.Errorf("create github project board: %w", err)
	}

	if linkErr := s.githubV2.LinkProjectToRepository(ctx, githubProjectID, owner, repoName, token); linkErr != nil {
		slog.WarnContext(ctx, "failed to link lazy-created board to repository", "project", gitRepo.ProjectID, "error", linkErr)
	}

	slog.InfoContext(ctx, "lazy-created github project board", "project", gitRepo.ProjectID, "boardId", githubProjectID)
	return githubProjectID, nil
}

func (s *issueService) addIssueToProject(ctx context.Context, githubProjectID string, issue *IssueResult, token string) {
	if issue.NodeID == "" || s.githubV2 == nil || githubProjectID == "" {
		slog.WarnContext(ctx, "skipping board add: missing project id or issue node id", "issue", issue.URL)
		return
	}
	if err := s.githubV2.AddIssueToProject(ctx, githubProjectID, issue.NodeID, token); err != nil {
		slog.WarnContext(ctx, "failed to add issue to GitHub project board", "issue", issue.URL, "error", err)
	}
}

func (s *issueService) ListIssues(ctx context.Context, orgID, projectID string, labels []string) ([]IssueInfo, error) {
	owner, repoName, cred, err := s.resolveRepoAndCredential(ctx, orgID, projectID)
	if err != nil {
		return nil, err
	}
	return s.github.ListIssues(ctx, owner, repoName, cred, labels)
}

func (s *issueService) CloseIssue(ctx context.Context, orgID, projectID string, number int, comment string) error {
	owner, repoName, cred, err := s.resolveRepoAndCredential(ctx, orgID, projectID)
	if err != nil {
		return err
	}

	// Post the closing comment first (best-effort: log and continue on failure).
	if strings.TrimSpace(comment) != "" {
		if commentErr := s.github.CommentIssue(ctx, owner, repoName, cred, number, comment); commentErr != nil {
			slog.WarnContext(ctx, "failed to post closing comment", "project", projectID, "issue", number, "error", commentErr)
		}
	}

	return s.github.CloseIssue(ctx, owner, repoName, cred, number)
}

func (s *issueService) CommentIssue(ctx context.Context, orgID, projectID string, number int, body string) error {
	if strings.TrimSpace(body) == "" {
		return fmt.Errorf("comment body is required")
	}

	owner, repoName, cred, err := s.resolveRepoAndCredential(ctx, orgID, projectID)
	if err != nil {
		return err
	}

	return s.github.CommentIssue(ctx, owner, repoName, cred, number, body)
}

func (s *issueService) EditIssueBody(ctx context.Context, orgID, projectID string, number int, body string) error {
	if strings.TrimSpace(body) == "" {
		return fmt.Errorf("body is required")
	}
	owner, repoName, cred, err := s.resolveRepoAndCredential(ctx, orgID, projectID)
	if err != nil {
		return err
	}
	return s.github.EditIssueBody(ctx, owner, repoName, cred, number, body)
}

// resolveRepoAndCredential looks up the project's git repository, parses its
// owner/repo from the clone URL, and resolves the org's credential. Every
// GitHub-bound op routes through here — the multi-tenant invariant
// (operations parametrised by ocOrgID) is enforced at one place.
func (s *issueService) resolveRepoAndCredential(ctx context.Context, orgID, projectID string) (owner, repo string, cred credentials.Credential, err error) {
	gitRepo, err := s.repo.GetByOrgAndProjectID(ctx, orgID, projectID)
	if err != nil {
		return "", "", nil, fmt.Errorf("get repo: %w", err)
	}
	if gitRepo == nil {
		return "", "", nil, ErrRepoNotFound
	}

	owner, repo, err = ParseOwnerRepo(gitRepo.RepoURL)
	if err != nil {
		return "", "", nil, fmt.Errorf("parse repo url %q: %w", gitRepo.RepoURL, err)
	}

	cred, err = s.resolver.Resolve(ctx, gitRepo.OrgID)
	if err != nil {
		return "", "", nil, fmt.Errorf("resolve credential for org %q: %w", gitRepo.OrgID, err)
	}
	return owner, repo, cred, nil
}

// ParseOwnerRepo extracts the "owner" and "repo" segments from a GitHub clone URL.
// Supports https://github.com/owner/repo.git and https://github.com/owner/repo forms.
func ParseOwnerRepo(cloneURL string) (owner, repo string, err error) {
	u := strings.TrimSpace(cloneURL)
	for _, prefix := range []string{"https://github.com/", "http://github.com/", "git@github.com:"} {
		if strings.HasPrefix(u, prefix) {
			u = strings.TrimPrefix(u, prefix)
			break
		}
	}
	u = strings.TrimSuffix(u, ".git")
	u = strings.Trim(u, "/")

	parts := strings.SplitN(u, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", fmt.Errorf("not a github repo url")
	}
	return parts[0], parts[1], nil
}

// labelColor returns a hex color (without #) for well-known AEP labels,
// falling back to a neutral grey for anything else (e.g. phase-N labels).
func labelColor(name string) string {
	switch name {
	case "aep":
		return "0075ca" // blue
	case "implementation":
		return "7057ff" // purple
	case "pending":
		return "e4e669" // yellow
	default:
		return "ededed" // light grey for phase-N and other dynamic labels
	}
}
