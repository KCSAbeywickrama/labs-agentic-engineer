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

// GitHub-direct bundle reads (docs/design/agents-generation-migration.md §5).
// The per-project local clone is gone: the "working tree" is now the untagged
// tip of `main`, and every read walks the repo tree via the Git Data API — at
// HEAD for the live draft, or at a `v*` tag for an approved version (peeling the
// annotated tag object to its commit, mirroring genai_reads.go and the skills
// store's HEAD walk). Downstream consumers key on tags, so intermediate commits
// on main are harmless by construction.

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"golang.org/x/sync/errgroup"

	"github.com/wso2/aep/aep-api/internal/credentials"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/models"
)

// GitGateway is the git-object surface + credential resolver + save identities
// the GitHub-direct artifact store drives. It is capability-sliced to exactly
// what reads (GitData + Resolver) and save/discard commits (ResolveSaveIdentities)
// need — the concrete *gitrepo.gitOpsService satisfies it structurally, the same
// port the files + genai features consume. No clone primitives.
type GitGateway interface {
	GitData() gitrepo.GitData
	Resolver() credentials.Resolver
	ResolveSaveIdentities(cred credentials.Credential) (*gitrepo.GitIdentity, *gitrepo.GitIdentity)
}

// The repo-relative directory prefixes the two bundles live under (trailing
// slash so a prefix match never straddles a sibling like `specs/designs/`).
const (
	requirementsPrefix = RequirementsDir + "/"
	designPrefix       = DesignDir + "/"
)

// bundleFilter decides whether a path RELATIVE to the read prefix belongs to the
// artifact bundle. Requirements are flat (top-level markdown / dsl / excalidraw);
// design is a recursive tree (markdown / yaml at any depth).
type bundleFilter func(rel string) bool

func requirementsBundleFilter(rel string) bool {
	return !strings.Contains(rel, "/") && hasAllowedRequirementExt(rel)
}

func designBundleFilter(rel string) bool {
	return hasAllowedDesignExt(rel)
}

// repoCoords is the resolved GitHub coordinates + credential for one project —
// the shared gitrepo resolution (owner/name from URL, org credential, "main"
// fallback).
type repoCoords = gitrepo.RepoCoords

func (s *artifactService) resolveCoords(ctx context.Context, repo *models.GitRepository) (repoCoords, error) {
	return gitrepo.ResolveRepoCoords(ctx, s.git.Resolver(), repo.OrgID, repo)
}

// headCommit returns the tip commit SHA of the default branch.
func (s *artifactService) headCommit(ctx context.Context, rc repoCoords) (string, error) {
	return s.git.GitData().GetRef(ctx, rc.Owner, rc.Name, rc.Cred, "heads/"+rc.Branch)
}

// blobFetchConcurrency bounds the parallel GetBlob fan-out per bundle read.
const blobFetchConcurrency = 8

// readBundleAtCommit reads every blob under prefix at the given commit,
// returning path→content keyed RELATIVE to prefix, filtered by keep. Blobs are
// fetched with a bounded concurrent fan-out; assembly stays deterministic (the
// result is keyed by path, and any fetch error fails the whole read).
func (s *artifactService) readBundleAtCommit(ctx context.Context, rc repoCoords, commitSHA, prefix string, keep bundleFilter) (map[string]string, error) {
	gh := s.git.GitData()
	commit, err := gh.GetCommit(ctx, rc.Owner, rc.Name, rc.Cred, commitSHA)
	if err != nil {
		return nil, fmt.Errorf("get commit %s: %w", commitSHA, err)
	}
	tree, err := gh.GetTree(ctx, rc.Owner, rc.Name, rc.Cred, commit.TreeSHA, true)
	if err != nil {
		return nil, fmt.Errorf("get tree %s: %w", commit.TreeSHA, err)
	}
	var targets []gitrepo.TreeEntryResult
	var rels []string
	for _, e := range tree.Entries {
		if e.Type != "blob" || !strings.HasPrefix(e.Path, prefix) {
			continue
		}
		rel := strings.TrimPrefix(e.Path, prefix)
		if rel == "" || !keep(rel) {
			continue
		}
		targets = append(targets, e)
		rels = append(rels, rel)
	}
	contents := make([]string, len(targets))
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(blobFetchConcurrency)
	for i, e := range targets {
		g.Go(func() error {
			data, err := gh.GetBlob(gctx, rc.Owner, rc.Name, rc.Cred, e.SHA)
			if err != nil {
				return fmt.Errorf("get blob %s: %w", e.Path, err)
			}
			contents[i] = string(data)
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}
	out := map[string]string{}
	for i, rel := range rels {
		out[rel] = contents[i]
	}
	return out, nil
}

// readBundleAtHead reads the artifact bundle at the default branch's HEAD.
func (s *artifactService) readBundleAtHead(ctx context.Context, rc repoCoords, prefix string, keep bundleFilter) (map[string]string, error) {
	head, err := s.headCommit(ctx, rc)
	if err != nil {
		return nil, fmt.Errorf("get head ref: %w", err)
	}
	files, err := s.readBundleAtCommit(ctx, rc, head, prefix, keep)
	if err != nil {
		return nil, err
	}
	// The HEAD each at-HEAD read resolved. A read that lands right after a
	// files-apply but logs the PRE-apply commit is a stale GetRef caught in the
	// act (compare with the apply's "files apply committed" line).
	slog.DebugContext(ctx, "bundle read at head",
		"repo", rc.Owner+"/"+rc.Name, "prefix", prefix, "commit", head, "files", len(files))
	return files, nil
}

// readBundleAtTag reads the artifact bundle at a `v*` tag. The tag ref's object
// is peeled to its commit (GetTagObject; a lightweight tag already points at a
// commit, so a 404 peel falls back to the ref sha). Returns ErrArtifactNotFound
// when the tag ref itself is absent.
func (s *artifactService) readBundleAtTag(ctx context.Context, rc repoCoords, tag, prefix string, keep bundleFilter) (map[string]string, error) {
	commitSHA, err := s.tagCommit(ctx, rc, tag)
	if err != nil {
		return nil, err
	}
	return s.readBundleAtCommit(ctx, rc, commitSHA, prefix, keep)
}

// tagCommit resolves a `v*` tag ref to the commit it points at. Returns
// ErrArtifactNotFound when the ref is absent.
func (s *artifactService) tagCommit(ctx context.Context, rc repoCoords, tag string) (string, error) {
	gh := s.git.GitData()
	tagSHA, err := gh.GetRef(ctx, rc.Owner, rc.Name, rc.Cred, "tags/"+tag)
	if err != nil {
		if gitrepo.IsHTTPStatus(err, 404) {
			return "", ErrArtifactNotFound
		}
		return "", fmt.Errorf("get tag ref %s: %w", tag, err)
	}
	return gitrepo.PeelTagToCommit(ctx, gh, rc.Owner, rc.Name, rc.Cred, tagSHA), nil
}

// listVersionTags returns every `v*` tag with its Name + resolved commit SHA
// (the annotated tag object peeled to its commit). Message is not exposed by the
// Git Data refs API, so it is left empty — the version list is name + commit.
func (s *artifactService) listVersionTags(ctx context.Context, rc repoCoords) ([]gitrepo.TagInfo, error) {
	refs, err := s.git.GitData().ListMatchingRefs(ctx, rc.Owner, rc.Name, rc.Cred, "tags/v")
	if err != nil {
		return nil, err
	}
	out := make([]gitrepo.TagInfo, 0, len(refs))
	for _, r := range refs {
		name := strings.TrimPrefix(r.Ref, "refs/tags/")
		if name == "" || name == r.Ref {
			continue
		}
		commit := gitrepo.PeelTagToCommit(ctx, s.git.GitData(), rc.Owner, rc.Name, rc.Cred, r.SHA)
		out = append(out, gitrepo.TagInfo{Name: name, CommitHash: commit})
	}
	return out, nil
}
