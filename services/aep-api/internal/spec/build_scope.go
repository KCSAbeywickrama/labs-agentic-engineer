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

// build_scope.go — the PHASE SCOPE of one build (spec-agent redesign #370/
// #369): a v<N> tag snapshots the PRD + design of exactly ONE PRD phase, so
// the milestone is the PHASE's ledger and task planning covers the phase's
// stories. Computed here (the cell declares the phase and per-component
// citations; the PRD's Phasing section declares the phase's story set) and
// consumed by delivery/build (milestone identity) and delivery/task (delta
// planning + the Serves-stories stamp).

import (
	"context"
	"fmt"
	"regexp"
	"strings"
)

// BuildScope is one tag's phase scope. A zero Phase means the snapshot
// declares none (legacy or gate-bypassed content); consumers fall back to
// tag-scoped behavior.
type BuildScope struct {
	// Tag is the spec version this scope was computed at (e.g. "v3").
	Tag string
	// Phase is the PRD phase the design declares; 0 when undeclared.
	Phase int
	// InScope is the declared phase's story set, ascending.
	InScope []int
	// StoryTitles maps an in-scope story number to its PRD story line (the
	// text after "N. ").
	StoryTitles map[int]string
	// ComponentStories maps a deployable component id to the IN-SCOPE stories
	// it cites (cell citations ∩ InScope), ascending.
	ComponentStories map[string][]int
}

// PhaseTitle is the milestone title a scope claims: "Phase <N>", or the tag
// itself when no phase is declared (legacy fallback — one milestone per
// version, as before phases existed).
func (s BuildScope) PhaseTitle() string {
	if s.Phase <= 0 {
		return s.Tag
	}
	return fmt.Sprintf("Phase %d", s.Phase)
}

// storyLinePattern matches one numbered PRD story line: "7. As a member, ...".
var storyLinePattern = regexp.MustCompile(`(?m)^(\d+)\.\s+(.+)$`)

// BuildScopeAtTag computes the tag's phase scope from the tagged snapshot. A
// snapshot without a cell or a declared phase yields a zero-Phase scope (the
// legacy one-milestone-per-version behavior); the build gate normally makes
// that impossible for freshly-cut tags.
func (s *artifactService) BuildScopeAtTag(ctx context.Context, orgID, projectID, tag string) (BuildScope, error) {
	scope := BuildScope{Tag: tag}
	_, ref, err := s.readyRef(ctx, orgID, projectID)
	if err != nil {
		return scope, err
	}
	reqFiles, err := s.readBundleAtTag(ctx, ref, tag, requirementsPrefix, requirementsBundleFilter)
	if err != nil {
		return scope, fmt.Errorf("read requirements at %s: %w", tag, err)
	}
	designFiles, err := s.readBundleAtTag(ctx, ref, tag, designPrefix, designBundleFilter)
	if err != nil {
		return scope, fmt.Errorf("read design at %s: %w", tag, err)
	}
	facts, err := parseCellFacts(designFiles[designCellFile])
	if err != nil || facts.Phase == 0 {
		return scope, nil
	}
	scope.Phase = facts.Phase
	inScope := parsePRDPhasing(reqFiles[requirementsMainFile])[facts.Phase]
	scope.InScope = sortedStorySet(inScope)
	scope.StoryTitles = map[int]string{}
	for _, m := range storyLinePattern.FindAllStringSubmatch(markdownSection(reqFiles[requirementsMainFile], "User Stories"), -1) {
		var n int
		fmt.Sscanf(m[1], "%d", &n)
		if inScope[n] {
			scope.StoryTitles[n] = strings.TrimSpace(m[2])
		}
	}
	scope.ComponentStories = map[string][]int{}
	for _, c := range facts.Components {
		var served []int
		for _, n := range c.Stories {
			if inScope[n] {
				served = append(served, n)
			}
		}
		if len(served) > 0 {
			scope.ComponentStories[c.ID] = served
		}
	}
	return scope, nil
}
