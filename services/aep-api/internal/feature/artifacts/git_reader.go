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
	"strings"

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

// repoCoords is the resolved GitHub coordinates + credential for one project.
type repoCoords struct {
	owner  string
	name   string
	branch string
	cred   credentials.Credential
}

func (s *artifactService) resolveCoords(ctx context.Context, repo *models.GitRepository) (repoCoords, error) {
	owner, name := models.OwnerRepoFromURL(repo.RepoURL)
	if owner == "" || name == "" {
		return repoCoords{}, fmt.Errorf("cannot derive owner/repo from %q", repo.RepoURL)
	}
	cred, err := s.git.Resolver().Resolve(ctx, repo.OrgID)
	if err != nil {
		return repoCoords{}, fmt.Errorf("resolve credential: %w", err)
	}
	branch := repo.DefaultBranch
	if branch == "" {
		branch = "main"
	}
	return repoCoords{owner: owner, name: name, branch: branch, cred: cred}, nil
}

// headCommit returns the tip commit SHA of the default branch.
func (s *artifactService) headCommit(ctx context.Context, rc repoCoords) (string, error) {
	return s.git.GitData().GetRef(ctx, rc.owner, rc.name, rc.cred, "heads/"+rc.branch)
}

// readBundleAtCommit reads every blob under prefix at the given commit,
// returning path→content keyed RELATIVE to prefix, filtered by keep.
func (s *artifactService) readBundleAtCommit(ctx context.Context, rc repoCoords, commitSHA, prefix string, keep bundleFilter) (map[string]string, error) {
	gh := s.git.GitData()
	commit, err := gh.GetCommit(ctx, rc.owner, rc.name, rc.cred, commitSHA)
	if err != nil {
		return nil, fmt.Errorf("get commit %s: %w", commitSHA, err)
	}
	tree, err := gh.GetTree(ctx, rc.owner, rc.name, rc.cred, commit.TreeSHA, true)
	if err != nil {
		return nil, fmt.Errorf("get tree %s: %w", commit.TreeSHA, err)
	}
	out := map[string]string{}
	for _, e := range tree.Entries {
		if e.Type != "blob" || !strings.HasPrefix(e.Path, prefix) {
			continue
		}
		rel := strings.TrimPrefix(e.Path, prefix)
		if rel == "" || !keep(rel) {
			continue
		}
		data, err := gh.GetBlob(ctx, rc.owner, rc.name, rc.cred, e.SHA)
		if err != nil {
			return nil, fmt.Errorf("get blob %s: %w", e.Path, err)
		}
		out[rel] = string(data)
	}
	return out, nil
}

// readBundleAtHead reads the artifact bundle at the default branch's HEAD.
func (s *artifactService) readBundleAtHead(ctx context.Context, rc repoCoords, prefix string, keep bundleFilter) (map[string]string, error) {
	head, err := s.headCommit(ctx, rc)
	if err != nil {
		return nil, fmt.Errorf("get head ref: %w", err)
	}
	return s.readBundleAtCommit(ctx, rc, head, prefix, keep)
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
	tagSHA, err := gh.GetRef(ctx, rc.owner, rc.name, rc.cred, "tags/"+tag)
	if err != nil {
		if gitrepo.IsHTTPStatus(err, 404) {
			return "", ErrArtifactNotFound
		}
		return "", fmt.Errorf("get tag ref %s: %w", tag, err)
	}
	commitSHA, perr := gh.GetTagObject(ctx, rc.owner, rc.name, rc.cred, tagSHA)
	if perr != nil {
		return tagSHA, nil // lightweight tag: ref already points at the commit
	}
	return commitSHA, nil
}

// listVersionTags returns every `v*` tag with its Name + resolved commit SHA
// (the annotated tag object peeled to its commit). Message is not exposed by the
// Git Data refs API, so it is left empty — the version list is name + commit.
func (s *artifactService) listVersionTags(ctx context.Context, rc repoCoords) ([]gitrepo.TagInfo, error) {
	refs, err := s.git.GitData().ListMatchingRefs(ctx, rc.owner, rc.name, rc.cred, "tags/v")
	if err != nil {
		return nil, err
	}
	out := make([]gitrepo.TagInfo, 0, len(refs))
	for _, r := range refs {
		name := strings.TrimPrefix(r.Ref, "refs/tags/")
		if name == "" || name == r.Ref {
			continue
		}
		commit := r.SHA
		if peeled, perr := s.git.GitData().GetTagObject(ctx, rc.owner, rc.name, rc.cred, r.SHA); perr == nil {
			commit = peeled
		}
		out = append(out, gitrepo.TagInfo{Name: name, CommitHash: commit})
	}
	return out, nil
}
