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

// Git Data API primitives behind Save (annotate-a-tag-at-HEAD) and Discard
// (revert-commit a subtree back to its last tag). No local clone: save creates
// no commit (the accepted draft is already on `main`), and discard is the only
// commit either flow makes. See docs/design/agents-generation-migration.md §5.

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/models"
)

// fetchTagNames lists the project's `v*` tags via ListMatchingRefs and returns
// them as TagInfo so the version-naming helpers (artifact_versioning.go) can
// consume them. Only Name is meaningful here (tag naming keys off it); the SHA
// is the annotated tag object, unused by the naming logic.
func (s *artifactService) fetchTagNames(ctx context.Context, rc repoCoords) ([]gitrepo.TagInfo, error) {
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
		out = append(out, gitrepo.TagInfo{Name: name, CommitHash: r.SHA})
	}
	return out, nil
}

// createAnnotatedTagViaAPI creates an annotated tag (POST /git/tags → POST
// /git/refs) pointing at commitSHA. On a tag-collision 422 it refreshes the tag
// list and recomputes the next tag name in-place, then retries.
//
// `kind` is "design" or "requirements" — selects nextDesignTag vs
// nextRequirementsTag. For design, `parentN` is the parent requirements
// version; for requirements it is ignored.
func (s *artifactService) createAnnotatedTagViaAPI(
	ctx context.Context,
	rc repoCoords,
	tags *[]gitrepo.TagInfo,
	nextN *int,
	tagName *string,
	tagBody, commitSHA string,
	parentN int,
	kind string,
) error {
	author, _ := s.git.ResolveSaveIdentities(rc.Cred)
	gh := s.git.GitData()
	return retryOnTagCollision(ctx, func() error {
		// Recompute the target name on each attempt so collisions push us forward.
		if refreshed, ferr := s.fetchTagNames(ctx, rc); ferr == nil {
			*tags = refreshed
		}
		switch kind {
		case "design":
			rev, name := nextDesignTag(*tags, parentN)
			*nextN, *tagName = rev, name
		case "requirements":
			ver, name := nextRequirementsTag(*tags)
			*nextN, *tagName = ver, name
		}
		tagObjSHA, err := gh.CreateTagObject(ctx, rc.Owner, rc.Name, rc.Cred, gitrepo.CreateTagObjectRequest{
			Tag:     *tagName,
			Message: tagBody,
			Object:  commitSHA,
			Type:    "commit",
			Tagger:  author,
		})
		if err != nil {
			return fmt.Errorf("create tag object: %w", err)
		}
		if err := gh.CreateTagRef(ctx, rc.Owner, rc.Name, rc.Cred, *tagName, tagObjSHA); err != nil {
			return err // may be wrapped ErrTagAlreadyExists — retried
		}
		return nil
	})
}

// revertSubtreeToTag rewrites the `prefix` subtree on the default branch to
// match its content at `tag` via a single commit (the target blobs are pulled
// from the tag; HEAD paths absent from the target are tombstoned). An empty
// `tag` reverts the subtree to empty (nothing approved). When the subtree
// already matches the target, no commit is made. Returns the reverted bundle.
func (s *artifactService) revertSubtreeToTag(
	ctx context.Context,
	repo *models.GitRepository,
	rc repoCoords,
	prefix string,
	keep bundleFilter,
	tag, message string,
) (map[string]string, error) {
	gh := s.git.GitData()

	// Target blobs from the tag (immutable) — path→blobSHA under prefix. Empty
	// when there is no tag yet (revert-to-empty).
	target := map[string]string{}
	if tag != "" {
		commitSHA, err := s.tagCommit(ctx, rc, tag)
		if err != nil {
			return nil, fmt.Errorf("resolve tag %s: %w", tag, err)
		}
		tcommit, err := gh.GetCommit(ctx, rc.Owner, rc.Name, rc.Cred, commitSHA)
		if err != nil {
			return nil, fmt.Errorf("get tag commit: %w", err)
		}
		ttree, err := gh.GetTree(ctx, rc.Owner, rc.Name, rc.Cred, tcommit.TreeSHA, true)
		if err != nil {
			return nil, fmt.Errorf("get tag tree: %w", err)
		}
		for _, e := range ttree.Entries {
			if e.Type == "blob" && strings.HasPrefix(e.Path, prefix) {
				target[e.Path] = e.SHA
			}
		}
	}

	author, committer := s.git.ResolveSaveIdentities(rc.Cred)
	bucketKey := repo.OrgID + ":" + repo.ProjectID

	err := retryOnCASConflict(ctx, bucketKey, func() error {
		head, ferr := gh.GetRef(ctx, rc.Owner, rc.Name, rc.Cred, "heads/"+rc.Branch)
		if ferr != nil {
			return fmt.Errorf("get ref: %w", ferr)
		}
		hcommit, ferr := gh.GetCommit(ctx, rc.Owner, rc.Name, rc.Cred, head)
		if ferr != nil {
			return fmt.Errorf("get commit: %w", ferr)
		}
		htree, ferr := gh.GetTree(ctx, rc.Owner, rc.Name, rc.Cred, hcommit.TreeSHA, true)
		if ferr != nil {
			return fmt.Errorf("get tree: %w", ferr)
		}
		current := map[string]string{}
		for _, e := range htree.Entries {
			if e.Type == "blob" && strings.HasPrefix(e.Path, prefix) {
				current[e.Path] = e.SHA
			}
		}

		var entries []gitrepo.TreeEntry
		for path, sha := range target {
			if current[path] != sha {
				entries = append(entries, gitrepo.TreeEntry{Path: path, Mode: "100644", Type: "blob", SHA: sha})
			}
		}
		for path := range current {
			if _, keepIt := target[path]; !keepIt {
				// Empty SHA → sha:null on the wire → deletion.
				entries = append(entries, gitrepo.TreeEntry{Path: path, Mode: "100644", Type: "blob"})
			}
		}
		if len(entries) == 0 {
			return nil // already at the target — no commit needed
		}

		newTree, ferr := gh.CreateTree(ctx, rc.Owner, rc.Name, rc.Cred, hcommit.TreeSHA, entries)
		if ferr != nil {
			return fmt.Errorf("create tree: %w", ferr)
		}
		newCommit, ferr := gh.CreateCommit(ctx, rc.Owner, rc.Name, rc.Cred, gitrepo.CreateCommitRequest{
			Message:   message,
			TreeSHA:   newTree,
			Parents:   []string{head},
			Author:    author,
			Committer: committer,
		})
		if ferr != nil {
			return fmt.Errorf("create commit: %w", ferr)
		}
		return gh.UpdateRef(ctx, rc.Owner, rc.Name, rc.Cred, "heads/"+rc.Branch, newCommit, false)
	})
	if err != nil {
		if errors.Is(err, ErrConflictBudgetExhausted) {
			return nil, fmt.Errorf("discard: %w", err)
		}
		return nil, fmt.Errorf("revert commit: %w", err)
	}

	return s.readBundleAtHead(ctx, rc, prefix, keep)
}
