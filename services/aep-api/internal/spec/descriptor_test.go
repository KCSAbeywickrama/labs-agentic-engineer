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

// The idea is free text a user typed: newlines, straight quotes, apostrophes
// and backslashes all have to survive a write→read cycle intact. This is the
// whole reason the descriptor uses a real TOML encoder instead of hand-rolled
// key writing.
func TestDescriptorRoundTripsAwkwardIdeaText(t *testing.T) {
	t.Parallel()
	idea := "A \"claims\" tracker for Ops.\nDon't lose receipts — path C:\\temp matters.\n\n[not-a-section]\nidea = \"not a key\""
	in := Descriptor{
		APIVersion: DescriptorAPIVersion,
		Name:       "expense-tracker",
		CreatedAt:  "2026-07-29T10:14:00Z",
		Idea:       idea,
	}

	raw, err := MarshalDescriptor(in)
	if err != nil {
		t.Fatalf("MarshalDescriptor: %v", err)
	}
	got, err := ParseDescriptor(raw)
	if err != nil {
		t.Fatalf("ParseDescriptor(%q): %v", raw, err)
	}
	if got.Idea != idea {
		t.Fatalf("idea round-trip:\n got %q\nwant %q\nencoded as:\n%s", got.Idea, idea, raw)
	}
	if got.Name != in.Name || got.APIVersion != in.APIVersion || got.CreatedAt != in.CreatedAt {
		t.Fatalf("identity round-trip = %+v, want %+v", got, in)
	}
}

// A hand-written descriptor (the shape documented for users) parses.
func TestParseDescriptorHandWritten(t *testing.T) {
	t.Parallel()
	const raw = `apiVersion = "agentic-engineer/v1"
name = "expense-tracker"
createdAt = "2026-07-29T10:14:00Z"

idea = """
An expense claim tracker for a 200-person company,
with manager approval and receipt uploads.
"""
`
	got, err := ParseDescriptor([]byte(raw))
	if err != nil {
		t.Fatalf("ParseDescriptor: %v", err)
	}
	if got.Name != "expense-tracker" {
		t.Fatalf("name = %q", got.Name)
	}
	if !strings.HasPrefix(got.Idea, "An expense claim tracker") ||
		!strings.Contains(got.Idea, "receipt uploads.") {
		t.Fatalf("idea = %q", got.Idea)
	}
}

func TestParseDescriptorRejectsGarbage(t *testing.T) {
	t.Parallel()
	if _, err := ParseDescriptor([]byte("this is not = = toml [[[")); err == nil {
		t.Fatal("want a parse error on malformed TOML, got nil")
	}
}

// NewDescriptor stamps the current apiVersion so callers cannot forget it —
// the field is what identifies the file as an Agentic Engineer descriptor.
func TestNewDescriptorStampsAPIVersion(t *testing.T) {
	t.Parallel()
	d := NewDescriptor("expense-tracker", "an expense tracker", "2026-07-29T10:14:00Z")
	if d.APIVersion != DescriptorAPIVersion {
		t.Fatalf("apiVersion = %q, want %q", d.APIVersion, DescriptorAPIVersion)
	}
}

// ideaSteer is the server half that carries the captured idea into a
// requirements-generate turn. Empty/whitespace idea appends NOTHING, so a turn
// without a descriptor is byte-identical to one before this feature.
func TestIdeaSteer(t *testing.T) {
	t.Parallel()
	if got := ideaSteer("   \n  "); got != "" {
		t.Fatalf("blank idea must append nothing, got %q", got)
	}
	got := ideaSteer("  an expense claim tracker  ")
	if !strings.HasPrefix(got, "\n\n") {
		t.Fatalf("steer must start with the paragraph break, got %q", got)
	}
	if !strings.Contains(got, "an expense claim tracker") {
		t.Fatalf("steer must carry the idea verbatim, got %q", got)
	}
	if strings.Contains(got, "  an expense") {
		t.Fatalf("steer must trim the idea, got %q", got)
	}
}
