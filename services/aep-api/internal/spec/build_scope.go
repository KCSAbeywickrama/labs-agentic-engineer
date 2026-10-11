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

// build_scope.go — what one build carries (ADR-0041). A version tag snapshots
// the requirements + design and its annotation names the selection, so the
// milestone is the version's ledger and the plan turn orders what it carries.
// Computed here (the feature files, read by reqspec, and the tag's annotation)
// and consumed by delivery/build (milestone identity) and delivery/task (the
// plan scope and the build issue).

import (
	"context"
	"fmt"
	"slices"

	"github.com/wso2/aep/aep-api/internal/platform/reqspec"
	"github.com/wso2/aep/aep-api/internal/platform/taskplan"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// BuildScope is what one tag carries. No Features means the snapshot carries
// no readable stories (legacy or gate-bypassed content); the plan is then one
// item for the whole spec.
type BuildScope struct {
	// Tag is the spec version this scope was computed at (e.g. "v3").
	Tag string
	// Features are the features the version carries, in ID order: one item
	// each of the build's checklist. A version cut before builds were
	// selections carried every feature with stories.
	Features []ScopeFeature
	// ProductWide are the product-wide items the version carries, in ID
	// order: the build's Foundation item builds them.
	ProductWide []ScopeItem
	// HeldBack are the stories of carried features the version holds back
	// (they wait on a feature it neither built nor carries), in ID order.
	HeldBack []string
}

// ScopeFeature is one feature a version carries.
type ScopeFeature struct {
	ID   string
	Name string
	// Needs are the carried features this one is built after, in ID order;
	// one built by an earlier version is already in the code and is left out.
	// See featureOrder for how a story's own need joins them.
	Needs []string
}

// ScopeItem is one product-wide item a version carries.
type ScopeItem struct {
	ID   string
	Text string
	// AppliesTo is feature IDs, or the single entry "all".
	AppliesTo []string
}

// Issue is the build issue this scope and the planner's checklist state.
func (s BuildScope) Issue(items []taskplan.BuildPlanItem) taskplan.BuildIssue {
	issue := taskplan.BuildIssue{Version: s.Tag, FeatureNames: map[string]string{}, HeldBack: s.HeldBack, Items: items}
	for _, f := range s.Features {
		issue.FeatureNames[f.ID] = f.Name
	}
	for _, it := range s.ProductWide {
		issue.ProductWide = append(issue.ProductWide, it.ID)
	}
	return issue
}

// MilestoneTitle is the title of the milestone this scope claims — the tag,
// so there is one milestone per spec version.
func (s BuildScope) MilestoneTitle() string { return s.Tag }

// BuildScopeAtTag computes what the tag carries from the tagged snapshot and
// its annotation. A snapshot without a cell or readable stories yields an
// empty scope (the legacy one-milestone-per-version behavior); the build gate
// normally makes that impossible for freshly-cut tags.
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
	reqFiles, err := s.readBundleAtTag(ctx, ref, tag, requirementsBundle)
	if err != nil {
		return scope, fmt.Errorf("read requirements at %s: %w", tag, err)
	}
	designFiles, err := s.readBundleAtTag(ctx, ref, tag, designBundle)
	if err != nil {
		return scope, fmt.Errorf("read design at %s: %w", tag, err)
	}
	if _, err := parseCellFacts(designFiles[DesignRootFile]); err != nil {
		return scope, nil
	}
	req := reqspec.Parse(reqFiles)
	if len(req.Stories()) == 0 {
		return scope, nil
	}
	plan, ok := s.versionScope(ctx, ref, tag)
	if !ok {
		plan = everything(req)
	}
	return scopeFor(tag, req, plan), nil
}

// PlanSelection is POST /build's selection without a repository: what a build
// of pick carries over the requirements reqFiles (paths relative to
// specs/requirements/, kept to what the tag's requirements bundle holds) after
// the versions that built `built`, and the scope its plan turn sees, or the
// refusal POST /build answers. A nil pick is every feature that can be
// designed. The playground runs it through cmd/build-plan; an open external
// dependency or an out-of-date design, which need the repository's records,
// refuse nothing here.
func PlanSelection(tag string, reqFiles map[string]string, built reqspec.Built, pick *reqspec.Pick) (reqspec.BuildPlan, BuildScope, error) {
	req := reqspec.Parse(requirementsBundle.of(reqFiles))
	plan, err := planVersion(req, built, pick, nil)
	if err != nil {
		return plan, BuildScope{Tag: tag}, err
	}
	return plan, scopeFor(tag, req, plan), nil
}

// GatedSelection is PlanSelection behind POST /build's hard gate: the
// selection, then the spec gate SaveSpec runs before it cuts a tag (the
// requirements' own rules, the design layout gate, the build gate and the
// acceptance tags) over the three bundles as on-disk folders, each keyed
// relative to its folder and kept to what the tag's bundle would hold. The
// selection's refusals and the gate's failures come back as ONE
// *SpecValidationError, as POST /build answers them.
func GatedSelection(tag string, reqFiles, designFiles, acceptanceFiles map[string]string, built reqspec.Built, pick *reqspec.Pick) (reqspec.BuildPlan, BuildScope, error) {
	reqFiles = requirementsBundle.of(reqFiles)
	req := reqspec.Parse(reqFiles)
	plan, planErr := planVersion(req, built, pick, nil)
	if err := gateVersion(req, plan, planErr, reqFiles, designBundle.of(designFiles), acceptanceBundle.of(acceptanceFiles)); err != nil {
		return plan, BuildScope{Tag: tag}, err
	}
	return plan, scopeFor(tag, req, plan), nil
}

// scopeFor is what plan carries, as the plan turn and the build issue name it.
func scopeFor(tag string, req reqspec.Spec, plan reqspec.BuildPlan) BuildScope {
	scope := BuildScope{Tag: tag, HeldBack: slices.Clone(plan.HeldBack)}
	scope.Features, scope.ProductWide = scopeOf(req, plan)
	slices.SortFunc(scope.HeldBack, reqspec.CompareIDs)
	return scope
}

// everything is the plan of a version cut before builds were selections: it
// carried every feature with stories and every product-wide item.
func everything(spec reqspec.Spec) reqspec.BuildPlan {
	var plan reqspec.BuildPlan
	for _, f := range spec.Features {
		if len(f.Stories) > 0 {
			plan.Features = append(plan.Features, f.ID)
		}
	}
	for _, it := range spec.ProductWide {
		plan.ProductWide = append(plan.ProductWide, it.ID)
	}
	return plan
}

// scopeOf names what a plan carries for the planner: each carried feature
// with the carried features it is built after, and each carried product-wide
// item.
func scopeOf(spec reqspec.Spec, plan reqspec.BuildPlan) ([]ScopeFeature, []ScopeItem) {
	order := featureOrder(spec, plan.Features)
	var features []ScopeFeature
	for _, f := range spec.Features {
		if slices.Contains(plan.Features, f.ID) {
			features = append(features, ScopeFeature{ID: f.ID, Name: f.Name, Needs: order[f.ID]})
		}
	}
	var items []ScopeItem
	for _, it := range spec.ProductWide {
		if slices.Contains(plan.ProductWide, it.ID) {
			items = append(items, ScopeItem{ID: it.ID, Text: it.Text, AppliesTo: it.AppliesTo})
		}
	}
	return features, items
}

// featureOrder is the build order among the carried features: what each is
// built after. A feature file's `Needs:` comes first, as the whole feature
// waits on it; a story's own need joins only when it closes no loop — Claims'
// "see the decision" story needs Approvals while Approvals needs Claims, and
// Claims is still built first, its one story landing on top of a stub.
func featureOrder(spec reqspec.Spec, carried []string) map[string][]string {
	order := map[string][]string{}
	reaches := func(from, to string) bool {
		seen := map[string]bool{}
		stack := []string{from}
		for len(stack) > 0 {
			n := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if n == to {
				return true
			}
			if !seen[n] {
				seen[n] = true
				stack = append(stack, order[n]...)
			}
		}
		return false
	}
	add := func(f, need string) {
		if need != f && slices.Contains(carried, f) && slices.Contains(carried, need) && !slices.Contains(order[f], need) && !reaches(need, f) {
			order[f] = append(order[f], need)
		}
	}
	for _, f := range spec.Features {
		for _, n := range f.Needs {
			add(f.ID, n)
		}
	}
	for _, f := range spec.Features {
		for _, n := range f.Waits() {
			add(f.ID, n)
		}
	}
	for id := range order {
		slices.SortFunc(order[id], reqspec.CompareIDs)
	}
	return order
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
