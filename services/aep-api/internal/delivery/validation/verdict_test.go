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

package validation

import (
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/delivery"
)

// reportJSON builds a minimal report document carrying the given per-criterion
// statuses — the only part of the report the verdict depends on.
func reportJSON(statuses ...string) string {
	var b strings.Builder
	b.WriteString(`{"schemaVersion":1,"criteria":[`)
	for i, s := range statuses {
		if i > 0 {
			b.WriteString(",")
		}
		method := "e2e"
		switch s {
		case "manual":
			method = "manual"
		case "not_validated":
			method = "scenario"
		}
		b.WriteString(`{"id":"AC-`)
		b.WriteString(string(rune('1' + i)))
		b.WriteString(`","method":"`)
		b.WriteString(method)
		b.WriteString(`","status":"`)
		b.WriteString(s)
		b.WriteString(`"}`)
	}
	b.WriteString(`]}`)
	return b.String()
}

func TestComputeVerdict(t *testing.T) {
	tests := []struct {
		name     string
		statuses []string
		want     string
	}{
		// Rule 4 — the only path to pass: every criterion is e2e and green.
		{"all e2e pass", []string{"pass", "pass", "pass"}, delivery.ValidationVerdictPass},
		{"single e2e pass", []string{"pass"}, delivery.ValidationVerdictPass},

		// Rule 1 — a failing assertion wins outright, whatever else is present.
		{"one e2e fail among passes", []string{"pass", "fail", "pass"}, delivery.ValidationVerdictFail},
		{"all e2e fail", []string{"fail", "fail"}, delivery.ValidationVerdictFail},
		{"fail beats manual", []string{"fail", "manual"}, delivery.ValidationVerdictFail},
		{"fail beats scenario", []string{"fail", "not_validated"}, delivery.ValidationVerdictFail},
		{"fail beats not_run", []string{"not_run", "fail"}, delivery.ValidationVerdictFail},

		// Rule 2 — a coverage gap is not a broken app; a human decides.
		{"one e2e not_run", []string{"pass", "not_run"}, delivery.ValidationVerdictAwaitingReview},
		{"all e2e not_run", []string{"not_run"}, delivery.ValidationVerdictAwaitingReview},

		// Rule 3 — anything a machine cannot judge needs a human.
		{"manual present", []string{"pass", "manual"}, delivery.ValidationVerdictAwaitingReview},
		{"scenario present", []string{"pass", "not_validated"}, delivery.ValidationVerdictAwaitingReview},
		{"only manual", []string{"manual", "manual"}, delivery.ValidationVerdictAwaitingReview},
		{"only scenario", []string{"not_validated"}, delivery.ValidationVerdictAwaitingReview},
		{"manual and scenario", []string{"manual", "not_validated"}, delivery.ValidationVerdictAwaitingReview},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ComputeVerdict([]byte(reportJSON(tt.statuses...)))
			if err != nil {
				t.Fatalf("ComputeVerdict: %v", err)
			}
			if got != tt.want {
				t.Errorf("verdict = %q; want %q", got, tt.want)
			}
		})
	}
}

// A report the platform cannot read is report_invalid, never a verdict — and in
// particular never a vacuous pass, which is what "no criteria failed" would
// otherwise degrade into.
func TestComputeVerdictInvalid(t *testing.T) {
	tests := []struct {
		name string
		raw  string
	}{
		{"malformed json", `{"criteria":`},
		{"not an object", `[]`},
		{"no criteria key", `{"schemaVersion":1}`},
		{"empty criteria", `{"schemaVersion":1,"criteria":[]}`},
		{"unknown status", `{"criteria":[{"id":"AC-1","method":"e2e","status":"flaky"}]}`},
		{"empty status", `{"criteria":[{"id":"AC-1","method":"e2e","status":""}]}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ComputeVerdict([]byte(tt.raw))
			if err == nil {
				t.Fatalf("want error, got verdict %q", got)
			}
			if got != "" {
				t.Errorf("verdict = %q; want empty on error", got)
			}
		})
	}
}

// The five per-criterion states are a contract shared with the console's
// validation-view parser. A new state must be handled deliberately, not
// silently swallowed into pass.
func TestComputeVerdictRejectsUnknownStateRatherThanPassing(t *testing.T) {
	raw := `{"criteria":[{"id":"AC-1","method":"e2e","status":"pass"},
	               {"id":"AC-2","method":"e2e","status":"quarantined"}]}`
	if _, err := ComputeVerdict([]byte(raw)); err == nil {
		t.Fatal("an unrecognised criterion state must be report_invalid, not a pass")
	}
}
