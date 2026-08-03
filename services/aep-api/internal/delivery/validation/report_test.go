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

// TestFailedCriteria covers the read a repair issue is built from. The shape of
// `failure` is the whole risk: generate-report.mjs writes an OBJECT, and reports
// already merged into project repos carry a bare string — a report is read long
// after it was written, so both have to work.
func TestFailedCriteria(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want []validation.FailedCriterion
	}{
		{"no report at all", "", nil},
		{"unparseable", `{`, nil},
		{"nothing failed", `{"criteria":[{"id":"AC-1","status":"pass"}]}`, nil},
		{
			"object-shaped failure — what the generator writes",
			`{"criteria":[
			  {"id":"AC-1","method":"e2e","status":"pass"},
			  {"id":"AC-2","method":"e2e","status":"fail","spec":"tests/e2e/greet.spec.ts",
			   "failure":{"message":"expected Hello, Ada","location":"greet.spec.ts:14"}}
			]}`,
			[]validation.FailedCriterion{{
				ID: "AC-2", Method: "e2e", Message: "expected Hello, Ada",
				Location: "greet.spec.ts:14", Spec: "tests/e2e/greet.spec.ts",
			}},
		},
		{
			"string-shaped failure — the older on-disk shape",
			`{"criteria":[{"id":"AC-9","method":"e2e","status":"fail","failure":"timed out"}]}`,
			[]validation.FailedCriterion{{ID: "AC-9", Method: "e2e", Message: "timed out"}},
		},
		{
			"a failure shaped like neither degrades to no detail, not to a dropped criterion",
			`{"criteria":[{"id":"AC-9","method":"e2e","status":"fail","failure":42}]}`,
			[]validation.FailedCriterion{{ID: "AC-9", Method: "e2e"}},
		},
		{
			"every failure is returned, in report order",
			`{"criteria":[
			  {"id":"AC-3","status":"fail","failure":{"message":"one"}},
			  {"id":"AC-1","status":"not_run"},
			  {"id":"AC-2","status":"fail","failure":{"message":"two"}}
			]}`,
			[]validation.FailedCriterion{
				{ID: "AC-3", Message: "one"},
				{ID: "AC-2", Message: "two"},
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := validation.FailedCriteria([]byte(tc.raw))
			if len(got) != len(tc.want) {
				t.Fatalf("FailedCriteria() = %+v; want %+v", got, tc.want)
			}
			for i := range tc.want {
				if got[i] != tc.want[i] {
					t.Errorf("FailedCriteria()[%d] = %+v; want %+v", i, got[i], tc.want[i])
				}
			}
		})
	}
}

// TestReportDigest is the live-or-dead test for the identical-report rule.
//
// The rule stops a repeat attempt that learned nothing. It can only ever fire if the
// digest ignores everything about a report except what it concluded — and the runner
// stamps every report with the commit it was generated at, so a whole-file hash
// would differ on every attempt and the rule would be dead code that always passes.
func TestReportDigest(t *testing.T) {
	const outcomes = `"criteria":[{"id":"AC-1","status":"fail","failure":{"message":"boom"}},{"id":"AC-2","status":"pass"}]`

	t.Run("same outcomes digest the same, despite a different commit stamp", func(t *testing.T) {
		first := validation.ReportDigest([]byte(`{"commit":"aaaaaaa","generatedAt":"2026-01-01T00:00:00Z",` + outcomes + `}`))
		second := validation.ReportDigest([]byte(`{"commit":"bbbbbbb","generatedAt":"2026-02-02T00:00:00Z",` + outcomes + `}`))
		if first == "" {
			t.Fatal("digest is empty for a usable report")
		}
		if first != second {
			t.Error("the commit stamp changed the digest — the identical-report rule can never fire")
		}
	})

	t.Run("criterion order is not part of the answer", func(t *testing.T) {
		a := validation.ReportDigest([]byte(`{"criteria":[{"id":"AC-1","status":"pass"},{"id":"AC-2","status":"fail"}]}`))
		b := validation.ReportDigest([]byte(`{"criteria":[{"id":"AC-2","status":"fail"},{"id":"AC-1","status":"pass"}]}`))
		if a != b {
			t.Error("report order changed the digest; it is the runner's discovery order, not a promise")
		}
	})

	t.Run("a repaired criterion is a changed answer", func(t *testing.T) {
		red := validation.ReportDigest([]byte(`{"criteria":[{"id":"AC-1","status":"fail"}]}`))
		green := validation.ReportDigest([]byte(`{"criteria":[{"id":"AC-1","status":"pass"}]}`))
		if red == green {
			t.Error("a repaired criterion must not digest the same as a failing one")
		}
	})

	t.Run("the same criterion failing for a different reason is a changed answer", func(t *testing.T) {
		a := validation.ReportDigest([]byte(`{"criteria":[{"id":"AC-1","status":"fail","failure":{"message":"timeout"}}]}`))
		b := validation.ReportDigest([]byte(`{"criteria":[{"id":"AC-1","status":"fail","failure":{"message":"404"}}]}`))
		if a == b {
			t.Error("the repair moved the failure; that is progress and must not read as unchanged")
		}
	})

	t.Run("no comparable evidence digests empty, so two of them never match", func(t *testing.T) {
		for name, raw := range map[string]string{
			"absent":      "",
			"unparseable": `{`,
			"no criteria": `{"criteria":[]}`,
		} {
			if got := validation.ReportDigest([]byte(raw)); got != "" {
				t.Errorf("%s: digest = %q; want empty so it cannot compare equal", name, got)
			}
		}
	})
}
