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

// build_scope.go — the STORY SCOPE of one build (spec-agent redesign #369). A
// version tag snapshots the requirements + design, so the milestone is the
// version's ledger and task planning covers the requirements' stories.
// Computed here (the feature files declare the story set, read by reqspec;
// each component's design.json claims the stories it serves) and consumed by
// delivery/build (milestone identity) and delivery/task (delta planning + the
// Serves-stories stamp).

import (
	"context"
	"fmt"
	"slices"

	"github.com/wso2/aep/aep-api/internal/platform/reqspec"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// BuildScope is one tag's story scope. An empty InScope means the snapshot
// carries no readable stories (legacy or gate-bypassed content); consumers
// fall back to tag-scoped behavior.
type BuildScope struct {
	// Tag is the spec version this scope was computed at (e.g. "v3").
	Tag string
	// InScope is every story the version builds, by ID ("F2.3"), in ID order:
	// the stories of the features its annotation names, but the held-back
	// ones (B1). A version cut before builds were selections carried every
	// story the requirements define.
	InScope []string
	// StoryTitles maps a story ID to its words (reqspec.Story.Text).
	StoryTitles map[string]string
	// ComponentStories maps a deployable component id to the stories its
	// design.json claims (claims ∩ InScope), in ID order.
	ComponentStories map[string][]string
}

// MilestoneTitle is the title of the milestone this scope claims — the tag,
// so there is one milestone per spec version.
func (s BuildScope) MilestoneTitle() string { return s.Tag }

// BuildScopeAtTag computes the tag's story scope from the tagged snapshot. A
// snapshot without a cell or readable stories yields an empty scope (the
// legacy one-milestone-per-version behavior); the build gate normally makes
// that impossible for freshly-cut tags.
func (s *artifactService) BuildScopeAtTag(ctx context.Context, orgID, projectID, tag string) (BuildScope, error) {
	scope := BuildScope{Tag: tag}
	// The same rule the save applies, for the same reason GetDesignAtTag applies
	// it: this tag becomes `tags/<name>` a few lines down, and a name that could
	// never have been created must not be able to walk out of that namespace.
	if verr := ValidateVersionName(tag); verr != nil {
		return scope, fmt.Errorf("%w: %q: %w", ErrInvalidVersionTag, tag, verr)
	}
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
	facts, err := parseCellFacts(designFiles[DesignRootFile])
	if err != nil {
		return scope, nil
	}
	spec := reqspec.Parse(reqFiles)
	stories := spec.Stories()
	if len(stories) == 0 {
		return scope, nil
	}
	carried := map[string]bool{}
	if plan, ok := s.versionScope(ctx, ref, tag); ok {
		carried = storySet(spec, plan)
	} else {
		for _, st := range stories {
			carried[st.ID] = true
		}
	}
	scope.StoryTitles = map[string]string{}
	for _, st := range stories {
		if !carried[st.ID] {
			continue
		}
		scope.InScope = append(scope.InScope, st.ID)
		scope.StoryTitles[st.ID] = st.Text
	}
	scope.ComponentStories = map[string][]string{}
	for id, claims := range componentStoryClaims(facts, designFiles) {
		var served []string
		for _, sid := range claims {
			if _, ok := scope.StoryTitles[sid]; ok {
				served = append(served, sid)
			}
		}
		if len(served) > 0 {
			slices.SortFunc(served, reqspec.CompareIDs)
			scope.ComponentStories[id] = slices.Compact(served)
		}
	}
	return scope, nil
}

// versionScope is a version's plan, read from its tag's annotation, or false
// when the tag carries none (a version cut before builds were selections) or
// cannot be listed.
func (s *artifactService) versionScope(ctx context.Context, ref sourcecontrol.RepoRef, tag string) (reqspec.BuildPlan, bool) {
	tags, err := s.listVersionTags(ctx, ref)
	if err != nil {
		return reqspec.BuildPlan{}, false
	}
	for _, t := range tags {
		if t.Name == tag {
			return parseScope(t.Body)
		}
	}
	return reqspec.BuildPlan{}, false
}
