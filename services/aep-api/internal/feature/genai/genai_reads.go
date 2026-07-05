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

package genai

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
	"strings"

	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/models"
)

// requirementsDir is the source-of-truth directory for the approved
// requirements bundle merged into a design-generate turn.
const requirementsDir = "specs/requirements/"

// requirementsTagPattern matches a requirements version tag `v<N>` (design tags
// are `v<N>-<M>` and are deliberately excluded — approval is the requirements
// version, not a design revision).
var requirementsTagPattern = regexp.MustCompile(`^v(\d+)$`)

// mergeApprovedRequirements enforces the design-generate gate — an approved
// (tagged) requirements version must exist — and merges that version's bundle,
// read server-side at its tag, into the snapshot. Returns ErrRequirementsNotApproved
// when no requirements tag exists. The FE never owns this context, so it is
// pulled at the tag (not HEAD) to pin the approved version.
func (s *service) mergeApprovedRequirements(ctx context.Context, orgID string, repo *models.GitRepository, snapshot map[string]string) (map[string]string, error) {
	rc, err := gitrepo.ResolveRepoCoords(ctx, s.git.Resolver(), orgID, repo)
	if err != nil {
		return nil, err
	}
	owner, name, cred := rc.Owner, rc.Name, rc.Cred
	gh := s.git.GitData()

	refs, err := gh.ListMatchingRefs(ctx, owner, name, cred, "tags/v")
	if err != nil {
		return nil, fmt.Errorf("list requirement tags: %w", err)
	}
	tagSHA, ok := latestRequirementsTag(refs)
	if !ok {
		slog.WarnContext(ctx, "design gate: no approved requirements tag — rejecting turn",
			"repo", owner+"/"+name, "matchingRefs", len(refs))
		return nil, ErrRequirementsNotApproved
	}
	slog.InfoContext(ctx, "design gate: pinned requirements tag",
		"repo", owner+"/"+name, "tagSha", tagSHA)

	// Peel the annotated tag object to its commit (a lightweight tag ref already
	// points at a commit — the peel helper falls back to the ref sha on a 404).
	commitSHA := gitrepo.PeelTagToCommit(ctx, gh, owner, name, cred, tagSHA)
	commit, err := gh.GetCommit(ctx, owner, name, cred, commitSHA)
	if err != nil {
		return nil, fmt.Errorf("get requirements tag commit: %w", err)
	}
	tree, err := gh.GetTree(ctx, owner, name, cred, commit.TreeSHA, true)
	if err != nil {
		return nil, fmt.Errorf("get requirements tag tree: %w", err)
	}

	merged := make(map[string]string, len(snapshot))
	for p, c := range snapshot {
		merged[p] = c
	}
	for _, e := range tree.Entries {
		if e.Type != "blob" || !strings.HasPrefix(e.Path, requirementsDir) || !keepInSnapshot(e.Path) {
			continue
		}
		if _, exists := merged[e.Path]; exists {
			continue // the FE draft (if any) wins for a colliding path
		}
		data, gerr := gh.GetBlob(ctx, owner, name, cred, e.SHA)
		if gerr != nil {
			return nil, fmt.Errorf("get requirements blob %s: %w", e.Path, gerr)
		}
		merged[e.Path] = string(data)
	}
	return merged, nil
}

// latestRequirementsTag returns the tag-object SHA of the highest `v<N>`
// requirements tag among the refs, and whether any exists.
func latestRequirementsTag(refs []gitrepo.MatchingRef) (string, bool) {
	bestN := -1
	bestSHA := ""
	for _, r := range refs {
		name := strings.TrimPrefix(r.Ref, "refs/tags/")
		m := requirementsTagPattern.FindStringSubmatch(name)
		if m == nil {
			continue
		}
		n, err := strconv.Atoi(m[1])
		if err != nil {
			continue
		}
		if n > bestN {
			bestN, bestSHA = n, r.SHA
		}
	}
	return bestSHA, bestN >= 0
}
