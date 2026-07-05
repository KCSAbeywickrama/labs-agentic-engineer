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
	"errors"
	"fmt"
)

// The request/response DTOs exchanged across the git-provider ports (ports.go).
// They are part of the port contract: any provider implementation
// (clients/github today) marshals its wire format to and from these types, and
// consumers (artifacts, skills, orgcreds) read them. Kept provider-neutral —
// only the fields our code actually consumes.

// ----- Repo / issue -----

// CreateOrgRepoRequest maps to the fields we send to POST /orgs/{org}/repos.
//
// The owning org/user is derived from the Credential's RepoOwner() — the
// caller does not pass it explicitly, which keeps the multi-tenant invariant
// (repo creation is parametrised by the credential, not by ambient config).
type CreateOrgRepoRequest struct {
	Name        string
	Private     bool
	AutoInit    bool
	Description string
}

// CreateIssueRequest maps to the fields we send to POST /repos/{owner}/{repo}/issues.
type CreateIssueRequest struct {
	Title  string   `json:"title"`
	Body   string   `json:"body"`
	Labels []string `json:"labels,omitempty"`
}

// IssueResult is the issue metadata returned after creation.
type IssueResult struct {
	Number int    `json:"number"`
	URL    string `json:"url"`
	NodeID string `json:"nodeId"`
}

// IssueInfo represents an issue returned when listing.
type IssueInfo struct {
	Number int
	Title  string
	Body   string
	URL    string
	State  string
	Labels []string
}

// CompareResult is the subset of GET /repos/{o}/{r}/compare/{base}...{head} the
// lineage diff consumes (§6): the per-file change summary between two refs (tags
// in the plan-turn incremental case). Used to feed the planner the actual
// spec/design delta between a Task's lineage tag and the current tag.
type CompareResult struct {
	// Status is GitHub's overall relationship: "ahead", "behind", "identical",
	// or "diverged".
	Status       string
	AheadBy      int
	BehindBy     int
	TotalCommits int
	Files        []ChangedFile
	// Truncated is true when GitHub capped the files list (the compare endpoint
	// returns at most 300 files and does not page them), so Files is a partial
	// view of the diff. The lineage-diff consumer (§6) must not treat an absent
	// file as unchanged when this is set.
	Truncated bool
}

// ChangedFile is one entry of a compare's files[] list.
type ChangedFile struct {
	Filename  string // current path
	Status    string // added | removed | modified | renamed | copied | changed | unchanged
	Additions int
	Deletions int
	Changes   int
	Patch     string // unified diff hunk; empty for binary or very large files
}

// ----- Account / App installation -----

// GitHubUser is the subset of GET /user we consume.
type GitHubUser struct {
	Login string `json:"login"`
	Name  string `json:"name"`
	Email string `json:"email"`
	ID    int64  `json:"id"`
}

// AppInstallationInfo is the subset of GET /app/installations/{id} we consume.
// account.login is the GitHub org/user the install belongs to; it can drift
// when the org is renamed on GitHub.
type AppInstallationInfo struct {
	ID      int64 `json:"id"`
	Account struct {
		Login string `json:"login"`
		Type  string `json:"type"`
	} `json:"account"`
	Suspended *string `json:"suspended_at,omitempty"`
}

// AppInstallationSummary is the flat projection of /app/installations[i]
// the discover endpoint returns to the BFF and console. Mirrors the wire
// shape used in the response (camelCase). Distinct from
// AppInstallationInfo (which preserves the nested account.* shape used
// by the validator's GetAppInstallation probe).
type AppInstallationSummary struct {
	InstallationID int64  `json:"installationId"`
	AccountLogin   string `json:"accountLogin"`
	AccountType    string `json:"accountType"`
}

// ----- Git data objects -----

// GitIdentity mirrors GitHub's author/committer/tagger object. Date is
// optional; GitHub defaults to the request time when omitted. Named with the
// `Git` prefix to avoid collision with the `Identity` type already declared
// in credential_service.go.
type GitIdentity struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Date  string `json:"date,omitempty"`
}

// CommitObject is the subset of GET /git/commits we consume.
type CommitObject struct {
	SHA     string
	TreeSHA string
	Parents []string
	Message string
}

// TreeEntry is the wire shape for POST /git/trees entries. SHA is empty for
// deletions (we serialise as `sha: null` on the wire).
type TreeEntry struct {
	Path string
	Mode string // "100644" file, "100755" exec, "040000" dir, "160000" submodule, "120000" symlink
	Type string // "blob" | "tree" | "commit"
	SHA  string // empty → deletion (sha:null)
}

// TreeObject is the subset of GET /git/trees we consume.
type TreeObject struct {
	SHA     string
	Entries []TreeEntryResult
}

// TreeEntryResult is one row of a tree listing. Size is only set for blobs.
type TreeEntryResult struct {
	Path string `json:"path"`
	Mode string `json:"mode"`
	Type string `json:"type"`
	SHA  string `json:"sha"`
	Size int64  `json:"size,omitempty"`
}

// CreateCommitRequest is the body of POST /git/commits.
type CreateCommitRequest struct {
	Message   string
	TreeSHA   string
	Parents   []string
	Author    *GitIdentity
	Committer *GitIdentity
}

// CreateTagObjectRequest is the body of POST /git/tags.
type CreateTagObjectRequest struct {
	Tag     string
	Message string
	Object  string // commit SHA
	Type    string // typically "commit"
	Tagger  *GitIdentity
}

// MatchingRef is one row of GET /git/matching-refs/<prefix>.
type MatchingRef struct {
	Ref string `json:"ref"` // e.g. "refs/tags/v1"
	SHA string // pulled out of the nested .object.sha
}

// PullRequestState is the subset of a pull request the sweep's PR-state
// reconciliation reads (§5): open/closed + merged + the merge commit SHA.
type PullRequestState struct {
	State          string // "open" | "closed"
	Merged         bool
	MergeCommitSHA string
}

// ----- Status errors -----

// HTTPStatusError surfaces HTTP status codes from the git host client so the
// validator can branch on 401 / 404 / 410. Wraps the response body for
// debug logging at the call site.
type HTTPStatusError struct {
	StatusCode int
	Body       string
	URL        string
}

func (e *HTTPStatusError) Error() string {
	return fmt.Sprintf("github API %s: status %d: %s", e.URL, e.StatusCode, e.Body)
}

// IsHTTPStatus reports true when err is an HTTPStatusError with the given code.
func IsHTTPStatus(err error, code int) bool {
	var he *HTTPStatusError
	if errors.As(err, &he) {
		return he.StatusCode == code
	}
	return false
}
