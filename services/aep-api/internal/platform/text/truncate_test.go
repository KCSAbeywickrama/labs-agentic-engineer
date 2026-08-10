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

package text

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestTruncateLeavesShortStringsAlone(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name, in string
		max      int
	}{
		{"under the budget", "short", 200},
		{"exactly the budget", strings.Repeat("a", 10), 10},
		{"zero budget is no budget", "untouched", 0},
		{"negative budget is no budget", "untouched", -1},
	} {
		if got := Truncate(tc.in, tc.max); got != tc.in {
			t.Errorf("%s: Truncate(%q, %d) = %q, want it unchanged", tc.name, tc.in, tc.max, got)
		}
	}
}

// The reason this package exists: a byte cut through a multi-byte rune leaves
// invalid UTF-8, which json re-encodes as U+FFFD in a user-visible message.
// Every case below cuts INSIDE a rune.
func TestTruncateNeverLeavesHalfARune(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name string
		in   string
		max  int
	}{
		{"2-byte rune split", strings.Repeat("a", 199) + "église", 200},
		{"4-byte rune split after 1 of 4", strings.Repeat("a", 199) + "🔥done", 200},
		{"4-byte rune split after 2 of 4", strings.Repeat("a", 198) + "🔥done", 200},
		{"3-byte rune split", strings.Repeat("a", 199) + "→go", 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			// Guard the fixture: if the raw cut were already valid the case proves
			// nothing.
			if utf8.ValidString(tc.in[:tc.max]) {
				t.Fatalf("fixture does not cut inside a rune")
			}
			got := Truncate(tc.in, tc.max)
			if !utf8.ValidString(got) {
				t.Fatalf("Truncate produced invalid UTF-8: %q", got)
			}
			// …and json must not have to substitute anything.
			b, err := json.Marshal(got)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			if strings.Contains(string(b), `�`) {
				t.Errorf("json re-encoded a replacement char: %s", b)
			}
			if !strings.HasSuffix(got, "…") {
				t.Errorf("a cut string must say so, got %q", got[len(got)-8:])
			}
		})
	}
}

// A RuneStart walk is the obvious implementation and it does not work — a LEAD
// byte satisfies b&0xC0 != 0x80, so it survives the walk and leaves the split
// rune's head behind. Pinned so nobody "simplifies" back to it.
func TestTruncateBeatsARuneStartWalk(t *testing.T) {
	t.Parallel()

	in := strings.Repeat("a", 199) + "église"
	runeStartWalk := func(s string) string {
		for len(s) > 0 && !utf8.RuneStart(s[len(s)-1]) {
			s = s[:len(s)-1]
		}
		return s
	}
	if utf8.ValidString(runeStartWalk(in[:200])) {
		t.Fatal("a RuneStart walk unexpectedly produced valid UTF-8 — revisit this test")
	}
	if !utf8.ValidString(Truncate(in, 200)) {
		t.Error("Truncate must produce valid UTF-8 where the walk cannot")
	}
}
