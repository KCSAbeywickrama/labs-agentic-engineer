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

	"github.com/wso2/aep/aep-api/internal/credentials"
)

// The git-provider capability ports.
//
// These interfaces are the provider-neutral seam between gitrepo's domain
// services and whatever git host actually serves the requests. The GitHub
// implementation lives in clients/github and is selected by GIT_PROVIDER; a
// GitLab/Gitea impl would be a sibling package satisfying the same ports with
// zero consumer changes. The seam is capability-sliced by CONSUMER need so each
// domain service depends only on the verbs it drives.
//
// Every call takes a credentials.Credential (or an App minter / raw token) —
// the client is the only place that mints Authorization headers, so tokens
// never cross a service boundary. All ports/types are stateless and
// concurrency-safe.
//
// The sentinels the implementations must return (ErrRefNotFastForward,
// ErrTagAlreadyExists, ErrRepoNameConflict, ...) and the wire DTOs
// (TreeEntry, IssueResult, CommitObject, ...) are part of this contract —
// see errors.go and wire.go. conflict_retry.go and the orgcreds validator key
// off the sentinels, so any provider impl MUST reproduce them.

// GitData is the git-object surface (blobs / trees / commits / refs / tags)
// that the artifacts save flow drives. GitLab's Repository/Commits/Refs APIs
// map onto it directly. Consumed via gitOpsService's GitData() accessor by
// feature/artifacts (save_via_api) and feature/skills (repo_store).
type GitData interface {
	// GetRef returns the tip SHA of a ref. `ref` is the ref name without
	// "refs/" prefix (e.g. "heads/main" or "tags/v1").
	GetRef(ctx context.Context, owner, repo string, cred credentials.Credential, ref string) (string, error)

	// GetCommit returns the tree SHA and parents of a commit object.
	GetCommit(ctx context.Context, owner, repo string, cred credentials.Credential, sha string) (*CommitObject, error)

	// GetTree returns the entries of a tree object. `recursive=true` walks
	// nested trees in one call (capped by GitHub at ~100k entries).
	GetTree(ctx context.Context, owner, repo string, cred credentials.Credential, treeSHA string, recursive bool) (*TreeObject, error)

	// GetBlob returns the raw (decoded) content of a blob object by SHA.
	// Returns an HTTPStatusError wrapping 404 when the blob is absent.
	GetBlob(ctx context.Context, owner, repo string, cred credentials.Credential, sha string) ([]byte, error)

	// CreateBlob stores raw content as a blob and returns its SHA.
	CreateBlob(ctx context.Context, owner, repo string, cred credentials.Credential, content []byte) (string, error)

	// CreateTree assembles a tree from `baseTree` plus a partial overlay of
	// entries. Entries with empty SHA represent deletions (sha: null on the
	// wire); GitHub returns 422 if the deleted path is absent in baseTree.
	CreateTree(ctx context.Context, owner, repo string, cred credentials.Credential, baseTree string, entries []TreeEntry) (string, error)

	// CreateCommit creates a commit object pointing at the given tree.
	CreateCommit(ctx context.Context, owner, repo string, cred credentials.Credential, req CreateCommitRequest) (string, error)

	// UpdateRef atomically advances a ref to `sha`. With `force=false` the
	// call is fast-forward-only — non-FF moves return ErrRefNotFastForward.
	UpdateRef(ctx context.Context, owner, repo string, cred credentials.Credential, ref, sha string, force bool) error

	// CreateTagObject creates an annotated tag object pointing at `objectSHA`
	// (typically a commit). Returns the tag object's SHA; the caller still
	// needs CreateTagRef to make the tag visible.
	CreateTagObject(ctx context.Context, owner, repo string, cred credentials.Credential, req CreateTagObjectRequest) (string, error)

	// CreateTagRef creates the refs/tags/<name> ref pointing at the supplied
	// tag-object SHA. Returns ErrTagAlreadyExists if another writer has
	// claimed the name.
	CreateTagRef(ctx context.Context, owner, repo string, cred credentials.Credential, tagName, tagObjectSHA string) error

	// ListMatchingRefs lists all refs under the given prefix (e.g. "tags/v").
	// Returns an empty slice (not 404) when no refs match.
	ListMatchingRefs(ctx context.Context, owner, repo string, cred credentials.Credential, prefix string) ([]MatchingRef, error)

	// GetTagObject dereferences an annotated tag object to the SHA it points at
	// (typically a commit) via GET /git/tags/{sha}. Returns an HTTPStatusError
	// wrapping 404 when the sha is not a tag object (e.g. a lightweight tag ref
	// that already points at a commit). Used to read repository content at a tag
	// — a tag ref's object.sha is the tag object, which must be peeled to the
	// commit before GetCommit/GetTree can walk the tree.
	GetTagObject(ctx context.Context, owner, repo string, cred credentials.Credential, tagSHA string) (string, error)
}

// RepoAdmin is the repository-lifecycle surface. Consumed by repoService
// (CreateRepo / EnsureBareRepo). Repo delete/get are DB operations in
// repoService itself; the host only provisions the remote repo.
type RepoAdmin interface {
	// CreateOrgRepo creates a repo owned by the credential's RepoOwner() (org
	// or, on 404-fallback, user account). Returns ErrRepoNameConflict when the
	// name is taken.
	CreateOrgRepo(ctx context.Context, cred credentials.Credential, req CreateOrgRepoRequest) (cloneURL string, err error)
}

// IssueOps is the issue surface (create / list / close / comment / labels).
// Consumed by issueService.
type IssueOps interface {
	CreateIssue(ctx context.Context, owner, repo string, cred credentials.Credential, req CreateIssueRequest) (*IssueResult, error)
	ListIssues(ctx context.Context, owner, repo string, cred credentials.Credential, labels []string) ([]IssueInfo, error)
	// EnsureLabel creates a label in the repository if it does not already exist.
	// It is idempotent — a 422 Unprocessable Entity response (already exists) is treated as success.
	EnsureLabel(ctx context.Context, owner, repo string, cred credentials.Credential, name, color string) error
	// CloseIssue sets the issue state to closed with reason "completed".
	CloseIssue(ctx context.Context, owner, repo string, cred credentials.Credential, number int) error
	// CommentIssue posts a comment on the issue.
	CommentIssue(ctx context.Context, owner, repo string, cred credentials.Credential, number int, body string) error
	// EditIssueBody replaces the issue body via PATCH /issues/{number}.
	// Used by the tech-lead detail phase to write the LLM-authored body
	// after the placeholder issue was created.
	EditIssueBody(ctx context.Context, owner, repo string, cred credentials.Credential, number int, body string) error
}

// WebhookOps is the repo-webhook surface. Consumed by webhookService.
type WebhookOps interface {
	// RegisterWebhook installs a repository webhook delivering to deliveryURL,
	// signed with hmacSecret. Returns the host-assigned hook ID.
	RegisterWebhook(ctx context.Context, owner, repo string, cred credentials.Credential, deliveryURL, hmacSecret string, events []string) (hookID int64, err error)
}

// BoardOps is the project-board surface (GitHub Projects v2). On GitHub this is
// GraphQL, folded inside the same client as an implementation detail — the
// REST-vs-GraphQL split does not leak past this port. Consumed by issueService
// (lazy board create + add issue) and repoBoardService (read + move).
//
// The `pat` string signatures are preserved from the original v2 client
// (behavior-preserving); the caller mints the token and passes it through.
type BoardOps interface {
	// GetOrgID returns the node ID for a GitHub organization (required for project mutations).
	GetOrgID(ctx context.Context, org, pat string) (nodeID string, err error)
	CreateGitHubV2Project(ctx context.Context, orgID, pat, title string) (projectID string, err error)
	LinkProjectToRepository(ctx context.Context, githubProjectID, owner, repo, pat string) error
	GetProjectBoard(ctx context.Context, githubProjectID, pat string) (*ProjectBoardResult, error)
	AddIssueToProject(ctx context.Context, githubProjectID, issueNodeID, pat string) error
	MoveProjectItemToStatus(ctx context.Context, githubProjectID, issueURL, targetStatus, pat string) error
}

// AppInstallOps is the GitHub-App installation lifecycle + credential-account
// probe surface (GetUser, GetAppInstallation, ListAppInstallations,
// DeleteInstallation, ExchangeOAuthCode, GetUserInstallations). Consumed by
// feature/orgcreds — the validator's PAT/App liveness probes and the
// discover-then-bind connect + disconnect cascade.
//
// Unlike the four ports above, this surface is GitHub-specific by nature (per
// the provider-coupling map in docs/design/aep-api-target-structure.md); it is
// its own future seam if a second provider becomes real. It is grouped here so
// orgcreds holds one narrow port rather than the whole Host.
type AppInstallOps interface {
	// GetUser returns identity from GET /user. Used by the periodic
	// validator to probe a PAT credential for liveness and identity drift.
	// Returns an HTTPStatusError wrapping 401/404 etc. so callers can
	// trigger the disconnect cascade selectively.
	GetUser(ctx context.Context, cred credentials.Credential) (*GitHubUser, error)
	// GetAppInstallation calls GET /app/installations/{id} using the App
	// JWT directly (not an installation token) so it can reach the App-level
	// endpoint. Used by the validator's App-mode probe to refresh
	// account.login on rename and to detect 404/410 (install deleted).
	GetAppInstallation(ctx context.Context, minter *credentials.AppTokenMinter, installationID int64) (*AppInstallationInfo, error)
	// ListAppInstallations calls GET /app/installations using the App JWT.
	// Returns the full list of installations our App has across GitHub.
	// Used by the discover-then-bind path to surface installations the
	// platform has no row for yet.
	ListAppInstallations(ctx context.Context, minter *credentials.AppTokenMinter) ([]AppInstallationSummary, error)
	// ExchangeOAuthCode exchanges a GitHub OAuth code for a user-to-server
	// access token via POST github.com/login/oauth/access_token. Used by
	// the discover-then-bind path to obtain a user token whose
	// /user/installations response proves the user actually administers
	// the installation they're trying to bind.
	ExchangeOAuthCode(ctx context.Context, clientID, clientSecret, code, redirectURI string) (userToken string, err error)
	// GetUserInstallations calls GET /user/installations with a user-token.
	// Returns the list of installation IDs the authenticated user has
	// admin access to (per GitHub's "explicit permission" semantics).
	// Used by BindAppInstallation to verify the user is actually an admin
	// of the installation they're binding.
	GetUserInstallations(ctx context.Context, userToken string) ([]int64, error)
	// DeleteInstallation uninstalls the App from a GitHub account by calling
	// DELETE /app/installations/{id} with the App JWT. 204 means uninstalled,
	// 404 is treated as success (already gone). Used by the disconnect cascade
	// to make platform disconnect symmetric with the GitHub side — without
	// this, disconnects leave orphan installs visible to discover.
	DeleteInstallation(ctx context.Context, minter *credentials.AppTokenMinter, installationID int64) error
}

// Host is the whole git-provider surface: every capability port a single
// provider implementation exposes. The composition root selects one Host by
// GIT_PROVIDER and threads it into each domain service, where it narrows to the
// port that service consumes. clients/github's *Client satisfies Host.
type Host interface {
	GitData
	RepoAdmin
	IssueOps
	WebhookOps
	BoardOps
	AppInstallOps
}
