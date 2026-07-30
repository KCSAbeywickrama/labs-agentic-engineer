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
	"testing"

	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/delivery/validation"
)

// TestVerdictFromReport pins the rule that turns the runner's committed report
// into a run property.
//
// The load-bearing case is `partial`: a report where something passed, nothing
// failed, and some criteria were never covered. Calling that `passed` — as it was
// called before — claims a result for criteria nobody checked, which is the whole
// reason this vocabulary grew.
func TestVerdictFromReport(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
	}{
		// ---- passed: full coverage, all green -------------------------------
		{
			"every criterion was automated and passed",
			`{"criteria":[{"id":"AC-1","method":"e2e","status":"pass"},{"id":"AC-2","method":"e2e","status":"pass"}]}`,
			delivery.ValidationVerdictPassed,
		},
		{
			"a single passing criterion is full coverage",
			`{"criteria":[{"id":"AC-1","method":"e2e","status":"pass"}]}`,
			delivery.ValidationVerdictPassed,
		},

		// ---- failed: an assertion lost, and it wins over everything ---------
		{
			"one real failure is the verdict",
			`{"criteria":[{"id":"AC-1","status":"pass"},{"id":"AC-2","status":"fail"}]}`,
			delivery.ValidationVerdictFailed,
		},
		{
			"a failure outranks uncovered criteria",
			`{"criteria":[{"id":"AC-1","status":"fail"},{"id":"AC-2","status":"manual"}]}`,
			delivery.ValidationVerdictFailed,
		},
		{
			"a failure outranks having no passes at all",
			`{"criteria":[{"id":"AC-1","status":"fail"},{"id":"AC-2","status":"not_run"}]}`,
			delivery.ValidationVerdictFailed,
		},

		// ---- partial: real evidence, but gaps ------------------------------
		{
			"passes plus a manual checklist item is PARTIAL, not passed",
			`{"criteria":[{"id":"AC-1","method":"e2e","status":"pass"},{"id":"AC-2","method":"manual","status":"manual"}]}`,
			delivery.ValidationVerdictPartial,
		},
		{
			"passes plus an unwritten spec is partial",
			`{"criteria":[{"id":"AC-1","status":"pass"},{"id":"AC-2","status":"not_run"}]}`,
			delivery.ValidationVerdictPartial,
		},
		{
			"passes plus an out-of-scope scenario is partial",
			`{"criteria":[{"id":"AC-1","status":"pass"},{"id":"AC-2","method":"scenario","status":"not_validated"}]}`,
			delivery.ValidationVerdictPartial,
		},

		// ---- inconclusive: no test results at all --------------------------
		{
			"nothing ran and nothing failed",
			`{"criteria":[{"id":"AC-1","status":"not_run"},{"id":"AC-2","status":"manual"}]}`,
			delivery.ValidationVerdictInconclusive,
		},
		{
			"an oracle of only manual criteria",
			`{"criteria":[{"id":"AC-1","method":"manual","status":"manual"},{"id":"AC-2","method":"manual","status":"manual"}]}`,
			delivery.ValidationVerdictInconclusive,
		},

		// ---- unreported: no usable report ----------------------------------
		// Distinct from inconclusive: there we can read the evidence and it says
		// nothing ran; here there is nothing to read, so the run learned nothing
		// and the agent broke its contract.
		{"no report at all", "", delivery.ValidationVerdictUnreported},
		{"an unparseable report", "{not json", delivery.ValidationVerdictUnreported},
		{"a report with no criteria", `{"criteria":[]}`, delivery.ValidationVerdictUnreported},
		{"a report missing its criteria key", `{"schemaVersion":1}`, delivery.ValidationVerdictUnreported},
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
		`{"criteria":[{"id":"AC-1","status":"pass"}]}`,
		`{"criteria":[{"id":"AC-1","status":"fail"}]}`,
		`{"criteria":[{"id":"AC-1","status":"pass"},{"id":"AC-2","status":"manual"}]}`,
		`{"criteria":[{"id":"AC-1","status":"manual"}]}`,
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
