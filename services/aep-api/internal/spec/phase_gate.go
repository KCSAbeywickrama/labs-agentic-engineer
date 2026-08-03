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

// phase_gate.go — the build-tag phase gate (spec-agent redesign #369/#370/
// #371). A `v<N>` tag names a buildable snapshot of ONE PRD phase, so before
// the tag is cut the platform verifies, mechanically:
//
//   - design.cell exists, its facts parse, and it declares a phase;
//   - the declared phase exists in the PRD's Phasing section (which yields the
//     IN-SCOPE story set);
//   - every in-scope story is cited by at least one cell component (the
//     coverage check — the anti-disappearance net that replaced the old
//     Capabilities prose discipline);
//   - every in-scope, non-stub deployable component is ENRICHED (its
//     design.json moved off the scaffold placeholder) and carries its
//     type-mandated artifact (service → openapi.yaml, web-application →
//     wireframes.dsl).
//
// Stubs — components whose cited stories all fall outside the declared phase —
// and story-less infrastructure nodes are exempt from detail: the walking
// skeleton is real but never gates. Failures surface as FileValidationError
// rows through the existing SaveSpec 422 channel; nothing is tagged.

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Phase-gate error codes (join the designspec/save vocabulary the console
// renders).
const (
	codeMissingDesignCell        = "MISSING_DESIGN_CELL"
	codeInvalidDesignCell        = "INVALID_DESIGN_CELL"
	codeMissingPhase             = "MISSING_PHASE"
	codePhaseNotInPRD            = "PHASE_NOT_IN_PRD"
	codeUncoveredStory           = "UNCOVERED_STORY"
	codeUnenrichedComponent      = "UNENRICHED_COMPONENT"
	codeMissingComponentArtifact = "MISSING_COMPONENT_ARTIFACT"
)

const designCellFile = "design.cell"

// scaffoldPlaceholderMarker is how the gate tells a scaffold that was never
// enriched: the platform-authored description survives verbatim.
const scaffoldPlaceholderMarker = "Scaffolded from design.cell"

// validatePhaseGate runs the phase gate over the requirements bundle (keys
// relative to specs/requirements/) and the design bundle (keys relative to
// specs/design/). It returns FileValidationError rows (repo-relative paths are
// stamped by the caller) — empty means the phase gate passes.
func validatePhaseGate(reqFiles, designFiles map[string]string) []FileValidationError {
	cellSource, ok := designFiles[designCellFile]
	if !ok || strings.TrimSpace(cellSource) == "" {
		return []FileValidationError{{
			Path: designCellFile, Code: codeMissingDesignCell,
			Message: "design.cell missing — the cell is the primary design source; generate the design before building",
		}}
	}
	facts, err := parseCellFacts(cellSource)
	if err != nil {
		return []FileValidationError{{Path: designCellFile, Code: codeInvalidDesignCell, Message: err.Error()}}
	}
	if facts.Phase == 0 {
		return []FileValidationError{{
			Path: designCellFile, Code: codeMissingPhase,
			Message: "design.cell declares no phase — add `phase <N>` naming the PRD phase this design version details",
		}}
	}

	phasing := parsePRDPhasing(reqFiles[requirementsMainFile])
	inScope, ok := phasing[facts.Phase]
	if !ok {
		return []FileValidationError{{
			Path: designCellFile, Code: codePhaseNotInPRD,
			Message: fmt.Sprintf("design.cell declares phase %d, but the PRD's Phasing section defines no such phase (with a `Stories: …` list)", facts.Phase),
		}}
	}

	var errs []FileValidationError

	// Coverage: every in-scope story cited somewhere in the cell.
	cited := map[int]bool{}
	for _, n := range facts.CitedStories() {
		cited[n] = true
	}
	for _, n := range sortedStorySet(inScope) {
		if !cited[n] {
			errs = append(errs, FileValidationError{
				Path: designCellFile, Code: codeUncoveredStory,
				Message: fmt.Sprintf("story %d is in phase %d but no component cites it — extend the design or move the story", n, facts.Phase),
			})
		}
	}

	// Per-component completeness for in-scope, non-stub deployable components.
	for _, c := range facts.Components {
		componentType, deployable := deployableCellTypes[strings.ToLower(strings.TrimSpace(c.Type))]
		if !deployable || len(c.Stories) == 0 || facts.IsStub(c.ID, inScope) {
			continue
		}
		designPath := "components/" + c.ID + "/design.json"
		content, ok := designFiles[designPath]
		if !ok {
			errs = append(errs, FileValidationError{
				Path: designPath, Code: codeMissingComponentArtifact,
				Message: fmt.Sprintf("component %q has no design.json — save the design so the scaffold lands, then enrich it", c.ID),
			})
			continue
		}
		if strings.Contains(content, scaffoldPlaceholderMarker) {
			errs = append(errs, FileValidationError{
				Path: designPath, Code: codeUnenrichedComponent,
				Message: fmt.Sprintf("component %q is still the platform scaffold — enrich its design.json before building", c.ID),
			})
		}
		var artifact string
		switch componentType {
		case "service":
			artifact = "openapi.yaml"
		case "web-application":
			artifact = "wireframes.dsl"
		}
		if artifact != "" {
			artifactPath := "components/" + c.ID + "/" + artifact
			if strings.TrimSpace(designFiles[artifactPath]) == "" {
				errs = append(errs, FileValidationError{
					Path: artifactPath, Code: codeMissingComponentArtifact,
					Message: fmt.Sprintf("component %q (%s) is in phase %d and needs %s", c.ID, componentType, facts.Phase, artifact),
				})
			}
		}
	}
	return errs
}

// phasingEntryPattern matches one Phasing entry's phase number, anywhere on
// the line: "Phase 1 — core loop … Stories: 1, 2, 4."
var phasingEntryPattern = regexp.MustCompile(`(?i)\bphase\s+(\d+)\b`)
var storiesListPattern = regexp.MustCompile(`(?i)\bstories:\s*([\d,\s]+)`)

// parsePRDPhasing extracts phase → story set from the PRD's "## Phasing"
// section. The contract requires each phase entry to carry a
// "Stories: <n, n, …>" list; an entry without one defines no phase here (the
// gate then reports PHASE_NOT_IN_PRD, pointing the user at the contract).
func parsePRDPhasing(prd string) map[int]map[int]bool {
	out := map[int]map[int]bool{}
	section := markdownSection(prd, "Phasing")
	if section == "" {
		return out
	}
	currentPhase := 0
	for _, line := range strings.Split(section, "\n") {
		if m := phasingEntryPattern.FindStringSubmatch(line); m != nil {
			currentPhase, _ = strconv.Atoi(m[1])
		}
		if currentPhase == 0 {
			continue
		}
		if m := storiesListPattern.FindStringSubmatch(line); m != nil {
			set := out[currentPhase]
			if set == nil {
				set = map[int]bool{}
				out[currentPhase] = set
			}
			for _, tok := range strings.FieldsFunc(m[1], func(r rune) bool { return r == ',' || r == ' ' || r == '\t' }) {
				if n, err := strconv.Atoi(tok); err == nil && n > 0 {
					set[n] = true
				}
			}
		}
	}
	return out
}

// markdownSection returns the body of the `## <title>` section (up to the next
// `## ` heading), "" when absent.
func markdownSection(doc, title string) string {
	lines := strings.Split(doc, "\n")
	var body []string
	in := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "## ") {
			if in {
				break
			}
			in = strings.EqualFold(strings.TrimSpace(strings.TrimPrefix(trimmed, "## ")), title)
			continue
		}
		if in {
			body = append(body, line)
		}
	}
	return strings.Join(body, "\n")
}

func sortedStorySet(set map[int]bool) []int {
	out := make([]int, 0, len(set))
	for n := range set {
		out = append(out, n)
	}
	for i := 1; i < len(out); i++ { // insertion sort — sets are tiny
		for j := i; j > 0 && out[j-1] > out[j]; j-- {
			out[j-1], out[j] = out[j], out[j-1]
		}
	}
	return out
}
