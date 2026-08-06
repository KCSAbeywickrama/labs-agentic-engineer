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
	"strings"
	"testing"
)

const gatePRD = `# Lunch — PRD

## User Stories

1. As a member, I want to browse today's order, so that I can join.
2. As a member, I want to add my item, so that it is counted.
4. As a coordinator, I want the round locked at cutoff, so that the order is final.
7. As a member, I want a Slack message on close, so that I don't miss it.

## Phasing

- **Phase 1 — core loop**: order end to end. Stories: 1, 2, 4.
- **Phase 2 — notifications**: Stories: 7.
`

func gateCell(phase string) string {
	return phase + `
component lunch-api service [stories: 1, 2, 4]
component lunch-web web-application [stories: 1, 2]
component slack-notifier service [stories: 7]
component orders-db database
`
}

func enriched(id, typ string) string {
	return `{"name":"` + id + `","type":"` + typ + `","version":"0.1.0","language":"Ballerina","buildpack":"docker","appPath":"` + id + `","entrypoint":"deployment/` + typ + `","exposure":"intranet","dependencies":[],"description":"real responsibility text"}`
}

func completeDesignFiles() map[string]string {
	return map[string]string{
		"design.cell":                              gateCell("phase 1"),
		"components/lunch-api/design.json":         enriched("lunch-api", "service"),
		"components/lunch-api/openapi.yaml":        "openapi: 3.0.3\n",
		"components/lunch-web/design.json":         enriched("lunch-web", "web-application"),
		"components/lunch-web/wireframes.dsl":      "screen home\n",
		"components/slack-notifier/design.json":    scaffoldPlaceholderJSON("slack-notifier", "service"),
	}
}

func scaffoldPlaceholderJSON(id, typ string) string {
	return renderScaffold(id, typ, nil)
}

func gateErrors(t *testing.T, reqFiles, designFiles map[string]string) []FileValidationError {
	t.Helper()
	return validatePhaseGate(map[string]string{requirementsMainFile: gatePRD}, designFiles)
}

func codesOf(errs []FileValidationError) []string {
	out := make([]string, 0, len(errs))
	for _, e := range errs {
		out = append(out, e.Code)
	}
	return out
}

func TestPhaseGate_CompleteDesignPasses(t *testing.T) {
	errs := gateErrors(t, nil, completeDesignFiles())
	if len(errs) != 0 {
		t.Fatalf("complete design should pass, got %+v", errs)
	}
}

func TestPhaseGate_MissingCellAndPhase(t *testing.T) {
	errs := validatePhaseGate(map[string]string{requirementsMainFile: gatePRD}, map[string]string{})
	if len(errs) != 1 || errs[0].Code != "MISSING_DESIGN_CELL" {
		t.Fatalf("want MISSING_DESIGN_CELL, got %+v", errs)
	}

	files := completeDesignFiles()
	files["design.cell"] = gateCell("") // no phase statement
	errs = gateErrors(t, nil, files)
	if len(errs) != 1 || errs[0].Code != "MISSING_PHASE" {
		t.Fatalf("want MISSING_PHASE, got %+v", errs)
	}
}

func TestPhaseGate_PhaseAbsentFromPRD(t *testing.T) {
	files := completeDesignFiles()
	files["design.cell"] = strings.Replace(files["design.cell"], "phase 1", "phase 3", 1)
	errs := gateErrors(t, nil, files)
	if len(errs) == 0 || errs[0].Code != "PHASE_NOT_IN_PRD" {
		t.Fatalf("want PHASE_NOT_IN_PRD, got %+v", errs)
	}
}

func TestPhaseGate_UncoveredStory(t *testing.T) {
	files := completeDesignFiles()
	files["design.cell"] = `phase 1
component lunch-api service [stories: 1, 4]
component lunch-web web-application [stories: 1]
`
	errs := gateErrors(t, nil, files)
	found := false
	for _, e := range errs {
		if e.Code == "UNCOVERED_STORY" && strings.Contains(e.Message, "story 2") {
			found = true
		}
	}
	if !found {
		t.Fatalf("want UNCOVERED_STORY for story 2, got %+v", errs)
	}
}

func TestPhaseGate_InPhaseComponentDemandsArtifactsAndEnrichment(t *testing.T) {
	files := completeDesignFiles()
	delete(files, "components/lunch-api/openapi.yaml")
	files["components/lunch-web/design.json"] = scaffoldPlaceholderJSON("lunch-web", "web-application")
	errs := gateErrors(t, nil, files)
	codes := strings.Join(codesOf(errs), ",")
	if !strings.Contains(codes, "MISSING_COMPONENT_ARTIFACT") {
		t.Errorf("want MISSING_COMPONENT_ARTIFACT for lunch-api openapi.yaml, got %+v", errs)
	}
	if !strings.Contains(codes, "UNENRICHED_COMPONENT") {
		t.Errorf("want UNENRICHED_COMPONENT for scaffold-placeholder lunch-web, got %+v", errs)
	}
}

func TestPhaseGate_StubsAndInfrastructureExempt(t *testing.T) {
	// slack-notifier (stories all in phase 2) stays a bare scaffold with no
	// openapi.yaml; orders-db has no directory at all — neither may fail the
	// phase-1 gate (the complete-design test asserts overall pass; this pins
	// the reason).
	files := completeDesignFiles()
	errs := gateErrors(t, nil, files)
	for _, e := range errs {
		if strings.Contains(e.Path, "slack-notifier") || strings.Contains(e.Path, "orders-db") {
			t.Errorf("stub/infrastructure leaked into the gate: %+v", e)
		}
	}
}

// TestPhaseGate_LanguageSentinelRefused pins that the platform never decides a
// component's language: a design.json enriched everywhere EXCEPT the
// scaffold's "TBD" language sentinel still refuses the tag — the agent must
// set it (org Tech stack default → requirements → platform default).
func TestPhaseGate_LanguageSentinelRefused(t *testing.T) {
	files := completeDesignFiles()
	files["components/lunch-api/design.json"] = strings.Replace(
		enriched("lunch-api", "service"), `"language":"Ballerina"`, `"language":"TBD"`, 1)
	errs := gateErrors(t, nil, files)
	found := false
	for _, e := range errs {
		if e.Code == "UNENRICHED_COMPONENT" && strings.Contains(e.Message, "language") {
			found = true
		}
	}
	if !found {
		t.Fatalf("want UNENRICHED_COMPONENT for the TBD language sentinel, got %+v", errs)
	}
}
