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
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/prompts"
	"github.com/wso2/aep/aep-api/internal/spec"
)

const testIdea = "An expense claim tracker for a 200-person company"

func descriptorTOML(t *testing.T, idea string) string {
	t.Helper()
	raw, err := spec.MarshalDescriptor(spec.NewDescriptor("proj", idea, "2026-07-29T10:14:00Z"))
	if err != nil {
		t.Fatalf("spec.MarshalDescriptor: %v", err)
	}
	return string(raw)
}

// startInstruction seeds a project and returns the instruction dispatched for
// `msg`. `/start` turns carry NO useCase — that field is part of the
// conversation identity, and the kickoff must share the conversation with the
// chat around it so its interview answers land in the same history.
func startInstruction(t *testing.T, seed map[string]string, msg string) string {
	t.Helper()
	r := newGenaiRig(t, seed)
	r.fake.parts = []string{addFilePart("specs/requirements/requirements.md", "# Reqs\n")}
	m := manifestPart(map[string]string{"specs/requirements/requirements.md": "# Reqs\n"}, nil)
	r.fake.manifest = &m

	turnID := r.startTurn(t, convUUID, "", msg)
	st := r.waitTerminal(t, turnID)
	if st.Status != "completed" {
		t.Fatalf("turn status = %q, want completed", st.Status)
	}
	return r.fake.sentTurn(t, 0).req.Instruction
}

// The server owns `/start`: it expands the bare command into the skill load and
// appends the idea captured at project creation — neither of which the client
// sent, and neither of which the agent could read for itself.
func TestStartCommand_ExpandsAndCarriesCapturedIdea(t *testing.T) {
	got := startInstruction(t, map[string]string{
		spec.DescriptorPath: descriptorTOML(t, testIdea),
	}, "/start")

	if !strings.Contains(got, prompts.StartInstruction) {
		t.Fatalf("/start was not expanded to the skill load: %q", got)
	}
	if !strings.Contains(got, testIdea) {
		t.Fatalf("instruction missing the captured idea: %q", got)
	}
	if strings.Contains(got, "/start") {
		t.Fatalf("the raw command must not survive into the instruction: %q", got)
	}
}

// An idea typed inline wins over the descriptor — the user is restating what
// they want right now.
func TestStartCommand_InlineIdeaOverridesDescriptor(t *testing.T) {
	got := startInstruction(t, map[string]string{
		spec.DescriptorPath: descriptorTOML(t, testIdea),
	}, "/start a rota planner for nurses")

	if !strings.Contains(got, "a rota planner for nurses") {
		t.Fatalf("inline idea missing: %q", got)
	}
	if strings.Contains(got, testIdea) {
		t.Fatalf("descriptor idea must not also ride when one was typed inline: %q", got)
	}
}

// No descriptor → the command still expands, just with nothing appended. An
// older project (or a best-effort descriptor write that failed) still starts;
// the skill asks the user for the idea instead.
func TestStartCommand_NoDescriptorStillExpands(t *testing.T) {
	got := startInstruction(t, map[string]string{"README.md": "hi\n"}, "/start")

	if !strings.Contains(got, prompts.StartInstruction) {
		t.Fatalf("/start must still expand without a descriptor: %q", got)
	}
	if strings.Contains(got, "The user's idea") {
		t.Fatalf("no descriptor must append no idea: %q", got)
	}
}

// A corrupt descriptor is best-effort: losing the idea costs one question,
// failing the turn costs the user their kickoff.
func TestStartCommand_CorruptDescriptorDoesNotFailTheTurn(t *testing.T) {
	got := startInstruction(t, map[string]string{
		spec.DescriptorPath: "this is not = = toml [[[",
	}, "/start")

	if !strings.Contains(got, prompts.StartInstruction) {
		t.Fatalf("/start must still expand: %q", got)
	}
	if strings.Contains(got, "The user's idea") {
		t.Fatalf("corrupt descriptor must append no idea: %q", got)
	}
}

// The command grammar is narrow: ordinary prose that merely mentions the word
// is a normal turn, sent through untouched.
func TestStartCommand_OrdinaryProseIsUntouched(t *testing.T) {
	got := startInstruction(t, map[string]string{
		spec.DescriptorPath: descriptorTOML(t, testIdea),
	}, "where do I /start with the design?")

	if !strings.Contains(got, "where do I /start with the design?") {
		t.Fatalf("ordinary prose must ride verbatim: %q", got)
	}
	if strings.Contains(got, testIdea) {
		t.Fatalf("a non-command turn must not carry the idea: %q", got)
	}
}
