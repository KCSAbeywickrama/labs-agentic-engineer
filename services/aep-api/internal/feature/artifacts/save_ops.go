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

// The Workspace-port write primitives behind Save (annotated tag at the pinned
// commit) and Discard (one revert Mutate rewriting a subtree back to its last
// tag). Save creates no commit — the accepted draft is already on `main` — and
// discard is the only commit either flow makes. Push-CAS on origin arbitrates
// concurrent writers; Mutate owns the bounded fast-forward retry (design D5 —
// the retired REST path's org-keyed leaky bucket is not ported).
// See docs/design/shared-volume-clone-architecture.md §6, §10.

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"sort"
	"strings"
	"time"

	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
)

// tagRetryAttempts is the bounded backoff schedule for tag-name collisions
// (an external pusher claimed the same name between the tag-list read and the
// push): 50ms / 200ms / 800ms, each with ±50% jitter. Collisions can only come
// from external pushers, so plain bounded attempts suffice (design §10).
var tagRetryAttempts = []time.Duration{
	50 * time.Millisecond,
	200 * time.Millisecond,
	800 * time.Millisecond,
}

// createAnnotatedTag creates an annotated tag pointing at commitSHA via
// Workspace.Tag, under the collision-recompute loop (design §10): on
// ErrTagAlreadyExists it re-lists the tags (the engine fetches --tags),
// recomputes the next name in-place via the unchanged
// nextDesignTag/nextRequirementsTag, and retries — bounded by
// tagRetryAttempts.
//
// `kind` is "design" or "requirements" — selects nextDesignTag vs
// nextRequirementsTag. For design, `parentN` is the parent requirements
// version; for requirements it is ignored.
func (s *artifactService) createAnnotatedTag(
	ctx context.Context,
	ref gitrepo.RepoRef,
	tags *[]gitrepo.TagInfo,
	nextN *int,
	tagName *string,
	tagBody, commitSHA string,
	parentN int,
	kind string,
) error {
	tagger, _ := s.git.ResolveSaveIdentities(ref.Cred)
	attempt := func() error {
		// Recompute the target name on each attempt so collisions push us forward.
		if refreshed, ferr := s.listVersionTags(ctx, ref); ferr == nil {
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
		return s.git.Workspace().Tag(ctx, ref, gitrepo.TagSpec{
			Name:    *tagName,
			Target:  commitSHA,
			Message: tagBody,
			Tagger:  tagger,
		})
	}
	err := attempt()
	for _, delay := range tagRetryAttempts {
		if !errors.Is(err, gitrepo.ErrTagAlreadyExists) {
			return err
		}
		if jerr := jitterSleep(ctx, delay); jerr != nil {
			return jerr
		}
		err = attempt()
	}
	return err
}

// revertSubtreeToTag rewrites the `prefix` subtree on the default branch to
// match its content at `tag` via one Mutate (the target files are staged as
// writes; HEAD-subtree paths absent from the target are staged as deletes).
// An empty `tag` reverts the subtree to empty (nothing approved). When the
// subtree already matches the target the staged tree equals the base tree and
// Mutate commits nothing. Returns the reverted bundle.
func (s *artifactService) revertSubtreeToTag(
	ctx context.Context,
	ref gitrepo.RepoRef,
	prefix string,
	keep bundleFilter,
	tag, message string,
) (map[string]string, error) {
	// Target subtree content at the tag — read once BEFORE the Mutate and
	// treated as fixed input: the tag is immutable, so fn re-runs on a CAS
	// retry stay correct. Every blob under prefix participates (no extension
	// filter — the revert restores the subtree wholesale). Empty when there is
	// no tag yet (revert-to-empty).
	target := map[string]string{}
	if tag != "" {
		files, _, err := s.git.Workspace().ReadBundle(ctx, ref, "tags/"+tag, func(path string) bool {
			return strings.HasPrefix(path, prefix)
		})
		if err != nil {
			if errors.Is(err, gitrepo.ErrRefNotFound) {
				return nil, fmt.Errorf("resolve tag %s: %w", tag, ErrArtifactNotFound)
			}
			return nil, fmt.Errorf("read bundle at tag %s: %w", tag, err)
		}
		target = files
	}
	// Deterministic staging order (map iteration is random; the resulting
	// tree is identical either way, but ordered ops keep runs reproducible).
	targetPaths := make([]string, 0, len(target))
	for path := range target {
		targetPaths = append(targetPaths, path)
	}
	sort.Strings(targetPaths)

	author, committer := s.git.ResolveSaveIdentities(ref.Cred)
	_, err := s.git.Workspace().Mutate(ctx, ref, func(tx gitrepo.Tx) error {
		for _, path := range targetPaths {
			tx.Write(path, []byte(target[path]))
		}
		// HEAD-subtree paths absent from the target are tombstoned.
		return tx.Base().Walk(prefix, func(rel, _ string) error {
			if _, keepIt := target[rel]; !keepIt {
				tx.Delete(rel)
			}
			return nil
		})
	}, gitrepo.CommitOpts{Message: message, Author: author, Committer: committer})
	if err != nil {
		return nil, fmt.Errorf("revert commit: %w", err)
	}

	// Read the reverted bundle back through the workspace mount — the read
	// fetches origin first, so the just-pushed revert is always visible.
	return s.readBundleAtHead(ctx, ref, prefix, keep)
}

// jitterSleep waits for `base` with ±50% uniform jitter, respecting ctx
// cancellation. Returns ctx.Err() if the context is cancelled mid-sleep.
func jitterSleep(ctx context.Context, base time.Duration) error {
	delay := base/2 + rand.N(base) // uniform in [base/2, base*3/2)
	select {
	case <-time.After(delay):
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
