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

package spec

import (
	"context"
	"path"
	"regexp"
	"slices"
	"strings"

	"github.com/wso2/aep/aep-api/internal/platform/designspec"
)

// A design run's feature scope in the finished-turn ledger (#878 E1). The pod
// reports the IDs a `/design F1 F2` turn named (record-turn-usage
// designFeatures); the ledger keeps them, and nothing else, space-joined in a
// design turn's agent_turns.Summary. The build gate's staleness check and
// GET /spec/state read them back as DesignRun.Features.

// FlowDesign is the flow of a design turn (AgentTurn.Flow): the only flow
// whose Summary holds feature IDs.
const FlowDesign = "design"

// FlowAddressComments is the flow of an Address comments turn (L18): the
// design review's comments, addressed in the design's own order. It counts as
// a design run for the features its own requirement edits reached (DesignRun).
const FlowAddressComments = "address-comments"

// FlowRecreate is the flow of the first design of a product recreated from
// its code (ADR-0053): the `design` lineup over a seeded tree, every feature
// at once. It counts as a design run for every feature, like a bare /design.
const FlowRecreate = "recreate"

// DesignRunFlows are the flows whose completed runs are design runs.
var DesignRunFlows = []string{FlowDesign, FlowAddressComments, FlowRecreate}

// designFeatureID matches one feature ID inside a stored Summary.
var designFeatureID = regexp.MustCompile(`\bF[0-9]+\b`)

// designSummary is what a turn's Summary stores: a design turn's feature IDs,
// space-joined and deduplicated in the order named; "" for any other flow, or
// a design turn that named none (every feature).
func designSummary(flow string, ids []string) string {
	if flow != FlowDesign {
		return ""
	}
	var kept []string
	for _, id := range ids {
		if !slices.Contains(kept, id) {
			kept = append(kept, id)
		}
	}
	return strings.Join(kept, " ")
}

// DesignedFeatures reads which features a design run designed from its ledger
// Summary: "F1 F2" names them. Rows the in-process engine wrote hold the
// `/design F1 F2` line instead, which reads the same. None (an empty Summary,
// a bare `/design`) is nil, which means every feature designable at the run's
// commit.
func DesignedFeatures(summary string) []string {
	var ids []string
	for _, id := range designFeatureID.FindAllString(summary, -1) {
		if !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	return ids
}

// designRunsConsidered bounds how far back the build gate looks for the run
// that last designed each feature: the latest-finished runs, newest first. A
// feature last designed further back than this many runs reads as never
// designed, which the coverage check reports instead of a stale verdict.
const designRunsConsidered = 50

// DesignLedger is what the artifact service reads from the finished-turn
// ledger (TurnRepository): the design runs, for the staleness check (#575,
// E1, L30), and each design artifact's revision number (L18).
type DesignLedger interface {
	// DesignRuns lists the project's completed design runs, the
	// latest-finished first.
	DesignRuns(ctx context.Context, orgID, projectID string) ([]DesignRun, error)
	// ArtifactRevisions maps each design artifact a completed turn changed to
	// how many did (artifactRevisions).
	ArtifactRevisions(ctx context.Context, orgID, projectID string) (map[string]int, error)
}

// artifactRevisions counts, per design artifact, the turns that changed it:
// its revision number, so the first design that writes it makes revision 1
// and each later run that changes it the next. A design artifact is a file
// under specs/design/ as the review file keys it: a prototype by its manifest,
// so a change to its screens (prototype.tsx) is a change to the prototype.
// The review file is not an artifact. changed holds each turn's changed paths;
// a turn counts once per artifact however many of its files it changed.
func artifactRevisions(changed [][]string) map[string]int {
	out := map[string]int{}
	for _, paths := range changed {
		seen := map[string]bool{}
		for _, p := range paths {
			key, ok := designArtifact(p)
			if !ok || seen[key] {
				continue
			}
			seen[key] = true
			out[key]++
		}
	}
	return out
}

// designArtifact is the review file's key for the design artifact path
// belongs to, and whether it belongs to one.
func designArtifact(p string) (string, bool) {
	if !strings.HasPrefix(p, "specs/design/") || p == designspec.ReviewPath {
		return "", false
	}
	if path.Base(p) == "prototype.tsx" {
		return path.Join(path.Dir(p), "prototype.json"), true
	}
	return p, true
}
