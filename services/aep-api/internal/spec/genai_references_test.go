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

package spec_test

import (
	"slices"
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/agentsvc"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// The reference-documents channel (#384), sibling to the captured idea: the
// console commits what the user attached at create into
// specs/requirements/references/, and `/start` tells the agent they are there.
// These tests assert the FACTS the BFF puts on the turn — the wording that
// renders them belongs to the agents service.

// References attached at create ride the `/start` turn, sorted so the same
// folder always produces the same turn.
func TestStartCommand_CarriesReferenceDocuments(t *testing.T) {
	got := startTurnSpec(t, map[string]string{
		spec.DescriptorPath:                            descriptorTOML(t, testIdea),
		"specs/requirements/references/rfp.pdf":        "%PDF-1.4\n",
		"specs/requirements/references/glossary.md":    "# Terms\n",
		"specs/requirements/references/interviews.txt": "notes\n",
	}, "/start")

	want := []string{
		"specs/requirements/references/glossary.md",
		"specs/requirements/references/interviews.txt",
		"specs/requirements/references/rfp.pdf",
	}
	if !slices.Equal(got.References, want) {
		t.Fatalf("references = %v, want %v (sorted, all three)", got.References, want)
	}
	// The idea channel is untouched by the new one — they ride together.
	if got.Idea != testIdea {
		t.Fatalf("idea = %q, want the captured idea to still ride", got.Idea)
	}
}

// No references folder → nothing is added, so a docless project's turn stays
// exactly what it is today. This is the no-regression guarantee: every existing
// project takes this path.
func TestStartCommand_NoReferencesFolderAddsNothing(t *testing.T) {
	got := startTurnSpec(t, map[string]string{
		spec.DescriptorPath: descriptorTOML(t, testIdea),
	}, "/start")

	if len(got.References) != 0 {
		t.Fatalf("references = %v, want none for a project with no references folder", got.References)
	}
}

// Only the references folder rides. The rest of specs/ is already the agent's
// to read from its snapshot; re-listing it here would drown the real brief.
func TestStartCommand_OnlyReferenceFolderFilesRide(t *testing.T) {
	got := startTurnSpec(t, map[string]string{
		spec.DescriptorPath: descriptorTOML(t, testIdea),
		// Siblings that must NOT ride: one beside the references folder, one in
		// another specs/ subtree, one outside specs/ entirely. (prd.md is left
		// out deliberately — the shared rig writes it as the turn's own output.)
		"specs/requirements/scope.md": "# Scope\n",
		"specs/design/design.md":      "# Design\n",
		"README.md":                   "hi\n",
		// The name-prefix trap: this folder SHARES a prefix with the real one
		// and must not ride. Drop the trailing slash from ReferencesDir and
		// this file starts leaking into every kickoff.
		"specs/requirements/references-old/superseded.md": "# Old\n",
		"specs/requirements/references/brief.md":          "# Brief\n",
	}, "/start")

	want := []string{"specs/requirements/references/brief.md"}
	if !slices.Equal(got.References, want) {
		t.Fatalf("references = %v, want only the references folder's own file %v", got.References, want)
	}
}

// Flow turns carry the references too (#383 follow-up): the design flow
// generates wireframes.dsl, and a user-drawn sketch attached at create is
// exactly what those wireframes must follow. Same channel, same sorting,
// same best-effort posture as the start turn.
func TestFlowCommand_CarriesReferenceDocuments(t *testing.T) {
	got := startTurnSpec(t, map[string]string{
		spec.DescriptorPath:                        descriptorTOML(t, testIdea),
		"specs/requirements/references/sketch.png": "\x89PNG\r\n",
	}, "/design")

	if got.Kind != agentsvc.TurnKindFlow || got.Skill != "design" {
		t.Fatalf("/design was not recognised as a flow turn: %+v", got)
	}
	want := []string{"specs/requirements/references/sketch.png"}
	if !slices.Equal(got.References, want) {
		t.Fatalf("references = %v, want %v on a flow turn", got.References, want)
	}
}

// Ordinary chat prose stays reference-free: the documents are already in the
// conversation history from the kickoff, and a chat turn generates nothing
// that must be grounded in them.
func TestChatProse_CarriesNoReferences(t *testing.T) {
	got := startTurnSpec(t, map[string]string{
		spec.DescriptorPath:                        descriptorTOML(t, testIdea),
		"specs/requirements/references/sketch.png": "\x89PNG\r\n",
	}, "tighten the second requirement")

	if got.Kind != agentsvc.TurnKindChat {
		t.Fatalf("prose was not a chat turn: %+v", got)
	}
	if len(got.References) != 0 {
		t.Fatalf("references = %v, want none on a chat turn", got.References)
	}
}
