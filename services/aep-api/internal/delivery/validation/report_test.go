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

package validation_test

import (
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/delivery/validation"
)

// TestVerdictFromReport pins the rule that turns the agent's committed report
// into a run property.
//
// The load-bearing case is `partial`: a report where something passed, nothing
// failed, and some scenarios were never judged. Calling that `passed` claims a
// result for scenarios nobody drove, which is the whole reason this vocabulary
// grew.
func TestVerdictFromReport(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
	}{
		// ---- passed: every scenario judged, all green -----------------------
		{
			"every scenario passed",
			`{"scenarios":[{"scenario":"A","outcome":"passed"},{"scenario":"B","outcome":"passed"}]}`,
			delivery.ValidationVerdictPassed,
		},
		{
			"a single passing scenario",
			`{"scenarios":[{"scenario":"A","outcome":"passed"}]}`,
			delivery.ValidationVerdictPassed,
		},

		// ---- failed: an assertion lost, and it wins outright -----------------
		// It is the one thing the report says about the SOFTWARE rather than
		// about the run, so it outranks any coverage gap.
		{
			"one scenario failed among passes",
			`{"scenarios":[{"scenario":"A","outcome":"passed"},{"scenario":"B","outcome":"failed"}]}`,
			delivery.ValidationVerdictFailed,
		},
		{
			"a failure outranks a block",
			`{"scenarios":[{"scenario":"A","outcome":"failed"},{"scenario":"B","outcome":"blocked"}]}`,
			delivery.ValidationVerdictFailed,
		},
		{
			"a failure outranks an unjudgeable",
			`{"scenarios":[{"scenario":"A","outcome":"failed"},{"scenario":"B","outcome":"unjudgeable"}]}`,
			delivery.ValidationVerdictFailed,
		},

		// ---- partial: something passed, nothing failed, something unjudged ---
		{
			"a block leaves the run partial",
			`{"scenarios":[{"scenario":"A","outcome":"passed"},{"scenario":"B","outcome":"blocked"}]}`,
			delivery.ValidationVerdictPartial,
		},
		{
			"an unjudgeable leaves the run partial",
			`{"scenarios":[{"scenario":"A","outcome":"passed"},{"scenario":"B","outcome":"unjudgeable"}]}`,
			delivery.ValidationVerdictPartial,
		},
		{
			// An outcome word this build does not know is evidence we cannot
			// interpret. Counting it towards full coverage would let a typo buy a
			// `passed`, so it degrades to a gap.
			"an unrecognised outcome counts as a gap, not as coverage",
			`{"scenarios":[{"scenario":"A","outcome":"passed"},{"scenario":"B","outcome":"skipped-ish"}]}`,
			delivery.ValidationVerdictPartial,
		},

		// ---- inconclusive: read the evidence, nothing was judged -------------
		{
			"every scenario blocked",
			`{"scenarios":[{"scenario":"A","outcome":"blocked"},{"scenario":"B","outcome":"blocked"}]}`,
			delivery.ValidationVerdictInconclusive,
		},
		{
			"every scenario unjudgeable",
			`{"scenarios":[{"scenario":"A","outcome":"unjudgeable"}]}`,
			delivery.ValidationVerdictInconclusive,
		},

		// ---- unreported: no usable report ------------------------------------
		// Distinct from inconclusive: there we can read the evidence and it says
		// nothing ran; here there is nothing to read, so the run learned nothing
		// and the agent broke its contract.
		{"no report at all", "", delivery.ValidationVerdictUnreported},
		{"an unparseable report", "{not json", delivery.ValidationVerdictUnreported},
		{"a report with no scenarios", `{"scenarios":[]}`, delivery.ValidationVerdictUnreported},
		{"a report missing its scenarios key", `{"schemaVersion":2}`, delivery.ValidationVerdictUnreported},
	}
	for _, c := range cases {
		if got := validation.VerdictFromReport([]byte(c.raw)); got != c.want {
			t.Errorf("VerdictFromReport(%s) = %q, want %q", c.name, got, c.want)
		}
	}
}

// Every verdict the derivation can produce must be a member of the closed set the
// store accepts, or the run's one chance to record what it learned fails at write
// time. This is the seam the two halves are most likely to drift across.
func TestVerdictFromReportOnlyProducesStorableVerdicts(t *testing.T) {
	raws := []string{
		`{"scenarios":[{"outcome":"passed"}]}`,
		`{"scenarios":[{"outcome":"failed"}]}`,
		`{"scenarios":[{"outcome":"passed"},{"outcome":"blocked"}]}`,
		`{"scenarios":[{"outcome":"unjudgeable"}]}`,
		"",
	}
	for _, raw := range raws {
		got := validation.VerdictFromReport([]byte(raw))
		if !delivery.ValidationVerdicts[got] {
			t.Errorf("VerdictFromReport(%q) = %q, which the store would reject", raw, got)
		}
	}
}

// The fatal set is the verdict→outcome map the supervisor branches on. Pinned here
// because a verdict silently becoming fatal (or stopping being fatal) changes
// whether a version settles green, which no other test would catch.
func TestValidationVerdictFailsRun(t *testing.T) {
	cases := []struct {
		verdict    string
		wantFatal  bool
		wantReason string
	}{
		{delivery.ValidationVerdictPassed, false, ""},
		{delivery.ValidationVerdictPartial, false, ""},
		{delivery.ValidationVerdictInconclusive, false, ""},
		{delivery.ValidationVerdictSkipped, false, ""},
		{delivery.ValidationVerdictFailed, true, delivery.RunReasonValidationFailed},
		{delivery.ValidationVerdictUnreported, true, delivery.RunReasonValidationUnreported},
	}
	for _, c := range cases {
		reason, fatal := delivery.ValidationVerdictFailsRun(c.verdict)
		if fatal != c.wantFatal || reason != c.wantReason {
			t.Errorf("ValidationVerdictFailsRun(%q) = (%q, %v), want (%q, %v)",
				c.verdict, reason, fatal, c.wantReason, c.wantFatal)
		}
	}
}

// TestFailedScenarios covers the read a repair issue is built from.
//
// Two rules carry the risk. A `blocked` scenario must NOT appear: the agent
// cannot tell an app that correctly refuses an action from one too broken to
// perform it, so filing repair work on a block would have a coding run add an
// affordance the requirement never asked for. And the step that SETTLED the
// scenario has to be found even when its exit code was 0, because a command that
// prints a value exits 0 merely by running.
func TestFailedScenarios(t *testing.T) {
	t.Run("nothing failed", func(t *testing.T) {
		if got := validation.FailedScenarios([]byte(`{"scenarios":[{"outcome":"passed"}]}`)); got != nil {
			t.Errorf("got %+v, want nil", got)
		}
	})

	t.Run("a block is reported but never filed", func(t *testing.T) {
		raw := `{"scenarios":[
		  {"scenario":"A","outcome":"blocked","steps":[{"keyword":"When","text":"x","observed":"the button was [disabled]"}]}
		]}`
		if got := validation.FailedScenarios([]byte(raw)); got != nil {
			t.Errorf("a blocked scenario was filed for repair: %+v", got)
		}
	})

	t.Run("a failure carries its identity, its text and what settled it", func(t *testing.T) {
		raw := `{"scenarios":[
		  {"scenario":"A","outcome":"passed"},
		  {"feature":"Lists","featureFile":"specs/acceptance/lists.feature","line":24,
		   "rule":"A duplicate is rejected","scenario":"Adding a duplicate","outcome":"failed",
		   "steps":[
		     {"keyword":"When","text":"Dan adds \"Milk\" again","command":"agent-browser click"},
		     {"keyword":"Then","text":"the list still has one item","command":"agent-browser wait --text x","exit":1,
		      "observed":"the list held two items"}]}
		]}`
		got := validation.FailedScenarios([]byte(raw))
		if len(got) != 1 {
			t.Fatalf("got %d failures, want 1", len(got))
		}
		f := got[0]
		if f.ID != "Lists / A duplicate is rejected / Adding a duplicate" {
			t.Errorf("ID = %q", f.ID)
		}
		if f.FeatureFile != "specs/acceptance/lists.feature" || f.Line != 24 {
			t.Errorf("location = %s:%d", f.FeatureFile, f.Line)
		}
		if !strings.Contains(f.Text, "When Dan adds") || !strings.Contains(f.Text, "Then the list still has one item") {
			t.Errorf("Text does not read as the scenario:\n%s", f.Text)
		}
		if f.Step != "Then the list still has one item" {
			t.Errorf("Step = %q", f.Step)
		}
		if f.Observed != "the list held two items" {
			t.Errorf("Observed = %q", f.Observed)
		}
	})

	t.Run("a value-returning command settles the scenario at exit 0", func(t *testing.T) {
		// `get count` exits 0 because the command RAN. The agent read the printed
		// value and judged, so the observation is the only evidence there is.
		raw := `{"scenarios":[
		  {"scenario":"Adding a duplicate","outcome":"failed","steps":[
		    {"keyword":"Then","text":"the list still has exactly one item",
		     "command":"agent-browser get count \".item\"","exit":0,"observed":"2"}]}
		]}`
		got := validation.FailedScenarios([]byte(raw))
		if len(got) != 1 || got[0].Observed != "2" {
			t.Fatalf("got %+v, want the observation to settle it", got)
		}
	})

	t.Run("report order is preserved", func(t *testing.T) {
		raw := `{"scenarios":[
		  {"scenario":"B","outcome":"failed"},
		  {"scenario":"A","outcome":"passed"},
		  {"scenario":"C","outcome":"failed"}]}`
		got := validation.FailedScenarios([]byte(raw))
		if len(got) != 2 || got[0].Scenario != "B" || got[1].Scenario != "C" {
			t.Errorf("got %+v, want B then C", got)
		}
	})

	t.Run("an unreadable report files nothing", func(t *testing.T) {
		for _, raw := range []string{"", "{not json", `{"scenarios":[]}`} {
			if got := validation.FailedScenarios([]byte(raw)); got != nil {
				t.Errorf("FailedScenarios(%q) = %+v, want nil", raw, got)
			}
		}
	})
}

// TestReportDigest pins the fingerprint the repair loop compares attempts with.
// It must cover WHAT WAS CONCLUDED and nothing else: a whole-file hash would
// change on every attempt (the report stamps `commit` and `generatedAt`) and the
// identical-answer check would become dead code that silently never fires.
func TestReportDigest(t *testing.T) {
	t.Run("empty for anything unreadable", func(t *testing.T) {
		for _, raw := range []string{"", "{not json", `{"scenarios":[]}`} {
			if got := validation.ReportDigest([]byte(raw)); got != "" {
				t.Errorf("ReportDigest(%q) = %q, want empty", raw, got)
			}
		}
	})

	t.Run("order does not change the answer", func(t *testing.T) {
		a := `{"scenarios":[{"scenario":"A","outcome":"passed"},{"scenario":"B","outcome":"failed"}]}`
		b := `{"scenarios":[{"scenario":"B","outcome":"failed"},{"scenario":"A","outcome":"passed"}]}`
		if validation.ReportDigest([]byte(a)) != validation.ReportDigest([]byte(b)) {
			t.Error("the same outcomes in a different order produced different digests")
		}
	})

	t.Run("the same scenario failing differently is a different answer", func(t *testing.T) {
		a := `{"scenarios":[{"scenario":"A","outcome":"failed","steps":[{"keyword":"Then","text":"t","exit":1,"observed":"one"}]}]}`
		b := `{"scenarios":[{"scenario":"A","outcome":"failed","steps":[{"keyword":"Then","text":"t","exit":1,"observed":"two"}]}]}`
		if validation.ReportDigest([]byte(a)) == validation.ReportDigest([]byte(b)) {
			t.Error("a repair that changed the failure still read as the same answer")
		}
	})

	t.Run("the timestamp and commit are not part of the answer", func(t *testing.T) {
		a := `{"commit":"aaa","generatedAt":"2026-01-01T00:00:00Z","scenarios":[{"scenario":"A","outcome":"passed"}]}`
		b := `{"commit":"bbb","generatedAt":"2026-02-02T00:00:00Z","scenarios":[{"scenario":"A","outcome":"passed"}]}`
		if validation.ReportDigest([]byte(a)) != validation.ReportDigest([]byte(b)) {
			t.Error("a re-run with the same conclusions produced a different digest")
		}
	})

	t.Run("a changed outcome is a different answer", func(t *testing.T) {
		a := `{"scenarios":[{"scenario":"A","outcome":"failed"}]}`
		b := `{"scenarios":[{"scenario":"A","outcome":"passed"}]}`
		if validation.ReportDigest([]byte(a)) == validation.ReportDigest([]byte(b)) {
			t.Error("a fixed scenario read as the same answer")
		}
	})
}
