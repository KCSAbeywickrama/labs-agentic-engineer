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

// build_gate.go — the build-tag gate (spec-agent redesign #369). A `v<N>` tag
// names a buildable snapshot of the whole spec, so before the tag is cut the
// platform verifies, mechanically:
//
//   - design.cell exists and its facts parse;
//   - every PRD story is claimed by at least one component — each component's
//     design.json carries the `stories` it serves, and the union must cover
//     the PRD's User Stories list (the coverage check — the anti-disappearance
//     net that keeps requirements from silently vanishing between PRD and
//     design);
//   - every deployable component is ENRICHED (its design.json moved off the
//     scaffold placeholder, a language decided) and carries its type-mandated
//     artifact (service → openapi.yaml, web-application → wireframes.dsl).
//
// Story-less infrastructure nodes (database, cache, …) are not deployable and
// never gate. Failures surface as FileValidationError rows through the
// existing SaveSpec 422 channel; nothing is tagged.

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Build-gate error codes (join the designspec/save vocabulary the console
// renders).
const (
	codeMissingDesignCell        = "MISSING_DESIGN_CELL"
	codeInvalidDesignCell        = "INVALID_DESIGN_CELL"
	codeUncoveredStory           = "UNCOVERED_STORY"
	codeUnenrichedComponent      = "UNENRICHED_COMPONENT"
	codeMissingComponentArtifact = "MISSING_COMPONENT_ARTIFACT"
)

const designCellFile = "design.cell"

// scaffoldPlaceholderMarker is how the gate tells a scaffold that was never
// enriched: the platform-authored description survives verbatim.
const scaffoldPlaceholderMarker = "Scaffolded from design.cell"

// validateBuildGate runs the build gate over the requirements bundle (keys
// relative to specs/requirements/) and the design bundle (keys relative to
// specs/design/). It returns FileValidationError rows (repo-relative paths are
// stamped by the caller) — empty means the gate passes.
func validateBuildGate(reqFiles, designFiles map[string]string) []FileValidationError {
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

	var errs []FileValidationError

	// Coverage: every PRD story claimed by some component's design.json.
	claimed := map[int]bool{}
	for _, c := range facts.Components {
		for _, n := range designJSONStories(designFiles["components/"+c.ID+"/design.json"]) {
			claimed[n] = true
		}
	}
	for _, n := range sortedStoryNumbers(parsePRDStories(reqFiles[requirementsMainFile])) {
		if !claimed[n] {
			errs = append(errs, FileValidationError{
				Path: designCellFile, Code: codeUncoveredStory,
				Message: fmt.Sprintf("story %d is in the PRD but no component's design.json lists it in `stories` — extend the design or drop the story", n),
			})
		}
	}

	// Per-component completeness for deployable components.
	for _, c := range facts.Components {
		componentType, deployable := deployableCellTypes[strings.ToLower(strings.TrimSpace(c.Type))]
		if !deployable {
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
		} else if strings.Contains(content, `"language": "`+scaffoldLanguageSentinel+`"`) || strings.Contains(content, `"language":"`+scaffoldLanguageSentinel+`"`) {
			errs = append(errs, FileValidationError{
				Path: designPath, Code: codeUnenrichedComponent,
				Message: fmt.Sprintf("component %q has no language decided — set it from the organization Tech stack default, the requirements, or the platform default", c.ID),
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
					Message: fmt.Sprintf("component %q (%s) needs %s", c.ID, componentType, artifact),
				})
			}
		}
	}
	return errs
}

// designJSONStories reads the `stories` list a component's design.json claims.
// Malformed JSON or a missing field yields nothing — the design write-gates
// own rejecting bad JSON; this reader only collects claims.
func designJSONStories(content string) []int {
	if strings.TrimSpace(content) == "" {
		return nil
	}
	var doc struct {
		Stories []int `json:"stories"`
	}
	if err := json.Unmarshal([]byte(content), &doc); err != nil {
		return nil
	}
	out := make([]int, 0, len(doc.Stories))
	for _, n := range doc.Stories {
		if n > 0 {
			out = append(out, n)
		}
	}
	return out
}

// storyLinePattern matches one numbered PRD story line: "7. As a member, ...".
var storyLinePattern = regexp.MustCompile(`(?m)^(\d+)\.\s+(.+)$`)

// parsePRDStories extracts story number → title from the PRD's
// "## User Stories" section ("N. <title>" lines).
func parsePRDStories(prd string) map[int]string {
	out := map[int]string{}
	for _, m := range storyLinePattern.FindAllStringSubmatch(markdownSection(prd, "User Stories"), -1) {
		n, err := strconv.Atoi(m[1])
		if err != nil || n <= 0 {
			continue
		}
		out[n] = strings.TrimSpace(m[2])
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

func sortedStoryNumbers[V any](set map[int]V) []int {
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
