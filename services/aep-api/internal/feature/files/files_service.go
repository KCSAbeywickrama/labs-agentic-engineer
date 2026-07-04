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

// Package files is the generic, specs/-scoped, GitHub-at-HEAD backed Files API
// (docs/design/agents-generation-migration.md §4, §12.2). It replaces the
// per-project local working tree: reads are served from GitHub at HEAD (with a
// HEAD-SHA-revalidated tree cache, the skills-store pattern) and the single
// write is an atomic, all-or-nothing `apply` that commits straight to `main`
// via the Git Data API under a bounded CAS retry.
//
// Draft state lives on the frontend; committed truth is GitHub. `apply` carries
// per-file baseSha optimistic-concurrency: a stale baseSha (or a baseSha-omitted
// write to a path that already exists) fails the whole batch with 409 and
// nothing is applied. There are no individual PUT/DELETE routes.
package files

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/wso2/aep/aep-api/internal/credentials"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/platform/designspec"
	"github.com/wso2/aep/aep-api/models"
)

// ---- errors ----------------------------------------------------------------

var (
	// ErrProjectRepoNotFound — no git repo for (org, project); maps to 404.
	ErrProjectRepoNotFound = errors.New("project repository not found")
	// ErrPathInvalid — a path escapes specs/, is non-canonical, or is oversized;
	// maps to 400.
	ErrPathInvalid = errors.New("invalid file path")
	// ErrFileNotFound — a read for a path absent at HEAD; maps to 404.
	ErrFileNotFound = errors.New("file not found")
	// ErrApplyConflict — one or more baseSha preconditions failed; the caller
	// reads Conflicts and returns 409. Nothing was applied.
	ErrApplyConflict = errors.New("apply conflict: stale baseSha")
	// errConflictSentinel short-circuits the CAS retry loop on a precondition
	// failure (distinct from a transient non-fast-forward, which retries).
	errConflictSentinel = errors.New("precondition conflict")
)

// ---- wire shapes -----------------------------------------------------------

// FileMeta is one entry of the list response / the per-file result of apply.
type FileMeta struct {
	Path string `json:"path"`
	SHA  string `json:"sha"`
	Size int64  `json:"size,omitempty"`
}

// FileContent is the read response. SHA doubles as the draft's baseSha.
type FileContent struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	SHA     string `json:"sha"`
}

// WriteOp is one file write. BaseSHA omitted (empty) means "must not exist yet".
type WriteOp struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	BaseSHA string `json:"baseSha,omitempty"`
}

// DeleteOp is one file delete keyed on its current blob sha.
type DeleteOp struct {
	Path    string `json:"path"`
	BaseSHA string `json:"baseSha,omitempty"`
}

// ApplyRequest is the atomic accept payload.
type ApplyRequest struct {
	Writes  []WriteOp  `json:"writes,omitempty"`
	Deletes []DeleteOp `json:"deletes,omitempty"`
	Message string     `json:"message,omitempty"`
}

// Warning is a non-blocking soft-validation note attached to an applied file.
type Warning struct {
	Path    string `json:"path"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ApplyResult is the 200 response of a successful apply.
type ApplyResult struct {
	CommitSHA string     `json:"commitSha"`
	Files     []FileMeta `json:"files"`
	Warnings  []Warning  `json:"warnings,omitempty"`
}

// Conflict is one failed baseSha precondition (the 409 body carries a list).
type Conflict struct {
	Path       string `json:"path"`
	BaseSHA    string `json:"baseSha"`
	CurrentSHA string `json:"currentSha"`
}

// ---- ports (consumer-side; concrete gitrepo services satisfy them) ---------

// RepoResolver looks up the project's git repo row. *gitrepo.repoService
// satisfies it via GetRepo (which returns gitrepo.ErrRepoNotFound when absent).
type RepoResolver interface {
	GetRepo(ctx context.Context, orgID, projectID string) (*models.GitRepository, error)
}

// GitGateway is the narrow git-object surface + credential resolver + save
// identities. *gitrepo.gitOpsService satisfies it structurally.
type GitGateway interface {
	GitData() gitrepo.GitData
	Resolver() credentials.Resolver
	ResolveSaveIdentities(cred credentials.Credential) (*gitrepo.GitIdentity, *gitrepo.GitIdentity)
}

// ---- service ---------------------------------------------------------------

// FilesService is the typed entry point for the Files API.
type FilesService interface {
	List(ctx context.Context, orgID, projectID, prefix string) ([]FileMeta, error)
	Read(ctx context.Context, orgID, projectID, path string) (*FileContent, error)
	Apply(ctx context.Context, orgID, projectID string, req ApplyRequest) (*ApplyResult, []Conflict, error)
}

type service struct {
	repos RepoResolver
	git   GitGateway
	cache *treeCache
}

// NewService wires the Files API. Either dep may be nil in degraded boot; the
// operations then surface ErrProjectRepoNotFound.
func NewService(repos RepoResolver, git GitGateway) FilesService {
	return &service{repos: repos, git: git, cache: newTreeCache()}
}

// repoContext bundles the resolved GitHub coordinates for one project.
type repoContext struct {
	owner  string
	name   string
	branch string
	cred   credentials.Credential
}

func (s *service) resolve(ctx context.Context, orgID, projectID string) (*repoContext, error) {
	if s == nil || s.repos == nil || s.git == nil {
		return nil, ErrProjectRepoNotFound
	}
	repo, err := s.repos.GetRepo(ctx, orgID, projectID)
	if err != nil {
		if errors.Is(err, gitrepo.ErrRepoNotFound) {
			return nil, ErrProjectRepoNotFound
		}
		return nil, fmt.Errorf("resolve project repo: %w", err)
	}
	if repo == nil {
		return nil, ErrProjectRepoNotFound
	}
	owner, name := models.OwnerRepoFromURL(repo.RepoURL)
	if owner == "" || name == "" {
		return nil, fmt.Errorf("cannot derive owner/repo from %q", repo.RepoURL)
	}
	cred, err := s.git.Resolver().Resolve(ctx, orgID)
	if err != nil {
		return nil, fmt.Errorf("resolve credential: %w", err)
	}
	branch := "main"
	if repo.DefaultBranch != "" {
		branch = repo.DefaultBranch
	}
	return &repoContext{owner: owner, name: name, branch: branch, cred: cred}, nil
}

// List returns every blob at HEAD, filtered to those whose path has the given
// prefix (empty prefix ⇒ all), sorted by path.
func (s *service) List(ctx context.Context, orgID, projectID, prefix string) ([]FileMeta, error) {
	rc, err := s.resolve(ctx, orgID, projectID)
	if err != nil {
		return nil, err
	}
	blobs, err := s.blobsAtHead(ctx, orgID, projectID, rc)
	if err != nil {
		return nil, err
	}
	out := make([]FileMeta, 0, len(blobs))
	for path, e := range blobs {
		if prefix != "" && !strings.HasPrefix(path, prefix) {
			continue
		}
		out = append(out, FileMeta{Path: path, SHA: e.SHA, Size: e.Size})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

// Read returns the content + blob sha of a single file at HEAD.
func (s *service) Read(ctx context.Context, orgID, projectID, path string) (*FileContent, error) {
	if err := validatePath(path); err != nil {
		return nil, err
	}
	rc, err := s.resolve(ctx, orgID, projectID)
	if err != nil {
		return nil, err
	}
	blobs, err := s.blobsAtHead(ctx, orgID, projectID, rc)
	if err != nil {
		return nil, err
	}
	entry, ok := blobs[path]
	if !ok {
		return nil, ErrFileNotFound
	}
	data, err := s.git.GitData().GetBlob(ctx, rc.owner, rc.name, rc.cred, entry.SHA)
	if err != nil {
		return nil, fmt.Errorf("get blob %s: %w", path, err)
	}
	return &FileContent{Path: path, Content: string(data), SHA: entry.SHA}, nil
}

// blobsAtHead returns path → blob entry at the current HEAD, reusing the cached
// tree when HEAD is unchanged (HEAD-SHA-revalidated, one GetRef per read).
func (s *service) blobsAtHead(ctx context.Context, orgID, projectID string, rc *repoContext) (map[string]gitrepo.TreeEntryResult, error) {
	gh := s.git.GitData()
	headSHA, err := gh.GetRef(ctx, rc.owner, rc.name, rc.cred, "heads/"+rc.branch)
	if err != nil {
		return nil, fmt.Errorf("get head ref: %w", err)
	}
	key := orgID + "/" + projectID
	if blobs, ok := s.cache.matching(key, headSHA); ok {
		return blobs, nil
	}
	commit, err := gh.GetCommit(ctx, rc.owner, rc.name, rc.cred, headSHA)
	if err != nil {
		return nil, fmt.Errorf("get head commit: %w", err)
	}
	tree, err := gh.GetTree(ctx, rc.owner, rc.name, rc.cred, commit.TreeSHA, true)
	if err != nil {
		return nil, fmt.Errorf("get head tree: %w", err)
	}
	blobs := map[string]gitrepo.TreeEntryResult{}
	for _, e := range tree.Entries {
		if e.Type == "blob" {
			blobs[e.Path] = e
		}
	}
	s.cache.put(key, headSHA, blobs)
	return blobs, nil
}

// Apply validates + commits a batch atomically. On a baseSha precondition
// failure it returns (nil, conflicts, ErrApplyConflict) with nothing applied.
func (s *service) Apply(ctx context.Context, orgID, projectID string, req ApplyRequest) (*ApplyResult, []Conflict, error) {
	if len(req.Writes) == 0 && len(req.Deletes) == 0 {
		return nil, nil, fmt.Errorf("%w: empty apply (no writes or deletes)", ErrPathInvalid)
	}
	// Path + size validation happens once, before any GitHub call: a bad path
	// is a 400, never a partial commit.
	seen := map[string]bool{}
	for _, w := range req.Writes {
		if err := validatePath(w.Path); err != nil {
			return nil, nil, err
		}
		if len(w.Content) > maxFileBytes {
			return nil, nil, fmt.Errorf("%w: %s exceeds %d bytes", ErrPathInvalid, w.Path, maxFileBytes)
		}
		if seen[w.Path] {
			return nil, nil, fmt.Errorf("%w: %s appears more than once", ErrPathInvalid, w.Path)
		}
		seen[w.Path] = true
	}
	for _, d := range req.Deletes {
		if err := validatePath(d.Path); err != nil {
			return nil, nil, err
		}
		if seen[d.Path] {
			return nil, nil, fmt.Errorf("%w: %s is both written and deleted", ErrPathInvalid, d.Path)
		}
		seen[d.Path] = true
	}

	rc, err := s.resolve(ctx, orgID, projectID)
	if err != nil {
		return nil, nil, err
	}

	var result *ApplyResult
	var conflicts []Conflict
	err = retryCAS(ctx, casAttempts, func() error {
		gh := s.git.GitData()
		headSHA, ferr := gh.GetRef(ctx, rc.owner, rc.name, rc.cred, "heads/"+rc.branch)
		if ferr != nil {
			return fmt.Errorf("get ref: %w", ferr)
		}
		commit, ferr := gh.GetCommit(ctx, rc.owner, rc.name, rc.cred, headSHA)
		if ferr != nil {
			return fmt.Errorf("get commit: %w", ferr)
		}
		tree, ferr := gh.GetTree(ctx, rc.owner, rc.name, rc.cred, commit.TreeSHA, true)
		if ferr != nil {
			return fmt.Errorf("get tree: %w", ferr)
		}
		current := map[string]string{}
		for _, e := range tree.Entries {
			if e.Type == "blob" {
				current[e.Path] = e.SHA
			}
		}

		conflicts = checkPreconditions(req, current)
		if len(conflicts) > 0 {
			return errConflictSentinel
		}

		var entries []gitrepo.TreeEntry
		var files []FileMeta
		var warnings []Warning
		for _, w := range req.Writes {
			blobSHA, berr := gh.CreateBlob(ctx, rc.owner, rc.name, rc.cred, []byte(w.Content))
			if berr != nil {
				return fmt.Errorf("create blob %s: %w", w.Path, berr)
			}
			entries = append(entries, gitrepo.TreeEntry{Path: w.Path, Mode: "100644", Type: "blob", SHA: blobSHA})
			files = append(files, FileMeta{Path: w.Path, SHA: blobSHA})
			warnings = append(warnings, softValidate(w.Path, w.Content)...)
		}
		for _, d := range req.Deletes {
			// Empty SHA → sha:null on the wire → deletion.
			entries = append(entries, gitrepo.TreeEntry{Path: d.Path, Mode: "100644", Type: "blob"})
		}

		treeSHA, terr := gh.CreateTree(ctx, rc.owner, rc.name, rc.cred, commit.TreeSHA, entries)
		if terr != nil {
			return fmt.Errorf("create tree: %w", terr)
		}
		author, committer := s.git.ResolveSaveIdentities(rc.cred)
		newSHA, cerr := gh.CreateCommit(ctx, rc.owner, rc.name, rc.cred, gitrepo.CreateCommitRequest{
			Message:   applyMessage(req.Message),
			TreeSHA:   treeSHA,
			Parents:   []string{headSHA},
			Author:    author,
			Committer: committer,
		})
		if cerr != nil {
			return fmt.Errorf("create commit: %w", cerr)
		}
		if uerr := gh.UpdateRef(ctx, rc.owner, rc.name, rc.cred, "heads/"+rc.branch, newSHA, false); uerr != nil {
			return uerr
		}
		result = &ApplyResult{CommitSHA: newSHA, Files: files, Warnings: warnings}
		return nil
	})
	if errors.Is(err, errConflictSentinel) {
		return nil, conflicts, ErrApplyConflict
	}
	if err != nil {
		return nil, nil, err
	}
	s.cache.evict(orgID + "/" + projectID)
	return result, nil, nil
}

// checkPreconditions compares each op's baseSha against the current tree.
// baseSha == "" on a write means "must not exist"; on a delete it means
// "delete whatever is there" but the path must still exist.
func checkPreconditions(req ApplyRequest, current map[string]string) []Conflict {
	var conflicts []Conflict
	for _, w := range req.Writes {
		cur, exists := current[w.Path]
		if w.BaseSHA == "" {
			if exists {
				conflicts = append(conflicts, Conflict{Path: w.Path, BaseSHA: "", CurrentSHA: cur})
			}
			continue
		}
		if !exists || cur != w.BaseSHA {
			conflicts = append(conflicts, Conflict{Path: w.Path, BaseSHA: w.BaseSHA, CurrentSHA: cur})
		}
	}
	for _, d := range req.Deletes {
		cur, exists := current[d.Path]
		if !exists {
			conflicts = append(conflicts, Conflict{Path: d.Path, BaseSHA: d.BaseSHA, CurrentSHA: ""})
			continue
		}
		if d.BaseSHA != "" && cur != d.BaseSHA {
			conflicts = append(conflicts, Conflict{Path: d.Path, BaseSHA: d.BaseSHA, CurrentSHA: cur})
		}
	}
	return conflicts
}

// softValidate returns non-blocking warnings for a written file (§8's soft tier
// — the hard semantic gate stays at save/tag). A component design.json is
// validated against the published schema (the same definition the agent's write
// gate uses) plus the name==dir rule; any other .json gets a cheap parseability
// check. Warnings never block the commit.
func softValidate(path, content string) []Warning {
	if dir, ok := componentDesignDir(path); ok {
		if err := designspec.ValidateComponentDesignInDir([]byte(content), dir); err != nil {
			var ve *designspec.ValidationError
			if errors.As(err, &ve) {
				return []Warning{{Path: path, Code: ve.Code, Message: ve.Message}}
			}
		}
		return nil
	}
	if strings.HasSuffix(path, ".json") && !json.Valid([]byte(content)) {
		return []Warning{{Path: path, Code: designspec.CodeInvalidJSON, Message: "content is not valid JSON"}}
	}
	return nil
}

// componentDesignDir returns the <name> directory of a component design.json
// path (specs/design/components/<name>/design.json), and whether path is one.
func componentDesignDir(path string) (string, bool) {
	const prefix = "specs/design/components/"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, "/design.json") {
		return "", false
	}
	parts := strings.Split(strings.TrimPrefix(path, prefix), "/")
	if len(parts) != 2 {
		return "", false
	}
	return parts[0], true
}

func applyMessage(suffix string) string {
	base := "aep: apply file changes"
	if strings.TrimSpace(suffix) != "" {
		return base + ": " + suffix
	}
	return base
}
