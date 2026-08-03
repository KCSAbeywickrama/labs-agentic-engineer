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
	"context"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/delivery"
)

// failedReport is a runner report with two criteria lost and one passing — the
// shape a repair pass is built from.
const failedReport = `{"criteria":[
  {"id":"AC-001-a","method":"e2e","status":"fail","spec":"tests/e2e/greet.spec.ts",
   "failure":{"message":"expected \"Hello, Ada\" but saw \"Hello, undefined\"","location":"greet.spec.ts:14"}},
  {"id":"AC-001-b","method":"e2e","status":"pass"},
  {"id":"AC-002-a","method":"manual","status":"fail","failure":{"message":"copy reads as a warning"}}
]}`

// One issue PER FAILED CRITERION, not one per attempt. The granularity is what
// keeps a partial repair legible to the no-progress rule: an agent that fixes two
// of three failures shrinks the working set, where a single omnibus issue it cannot
// close would look like a cycle that achieved nothing.
func TestMintRepairIssues_OnePerFailedCriterion(t *testing.T) {
	iss := &fakeIssues{}
	svc := newSvc(iss, fakeCriteria{raw: []byte(sampleCriteria), found: true})

	filed, err := svc.MintRepairIssues(context.Background(), "org", "proj", thisMilestone,
		[]byte(failedReport), "cycle-abc")
	if err != nil {
		t.Fatalf("MintRepairIssues: %v", err)
	}
	if len(filed) != 2 {
		t.Fatalf("filed %d issues (%v); want one per failed criterion", len(filed), filed)
	}
	if len(iss.created) != 2 {
		t.Fatalf("created %d issues; want 2", len(iss.created))
	}

	first := iss.created[0]
	if !strings.Contains(first.Title, "AC-001-a") {
		t.Errorf("title = %q; want the criterion id in it", first.Title)
	}
	if first.Milestone == nil || *first.Milestone != thisMilestone {
		t.Errorf("milestone = %v; repair work belongs to the version that failed", first.Milestone)
	}
	// The working-set label is the whole mechanism: without it the issue is a ledger
	// entry nobody is dispatched for, and the loop would settle over its own repair.
	if !delivery.HasLabel(first.Labels, delivery.LabelAgentWork) {
		t.Errorf("labels = %v; want the %q working-set label", first.Labels, delivery.LabelAgentWork)
	}

	// The body has to carry BOTH halves: the oracle's `must` (which the report does
	// not have) and the report's failure detail (which the oracle does not have).
	// Either alone leaves the agent guessing.
	for _, want := range []string{
		"A text box is visible",   // the must, from the oracle
		"Hello, undefined",        // the message, from the report
		"greet.spec.ts:14",        // the location, from the report
		"tests/e2e/greet.spec.ts", // the spec file
	} {
		if !strings.Contains(first.Body, want) {
			t.Errorf("body is missing %q:\n%s", want, first.Body)
		}
	}
	// Enforcement of this is deferred to separate skill work, so the issue itself has
	// to say it: the cheapest path to a green report is to weaken the assertion.
	if !strings.Contains(first.Body, "tests/") {
		t.Errorf("body does not tell the agent the tests are off limits:\n%s", first.Body)
	}
}

// The dedupe key carries the ATTEMPT's cycle id, and that is load-bearing in two
// directions at once.
func TestMintRepairIssues_DedupeKeyIsScopedToTheAttempt(t *testing.T) {
	iss := &fakeIssues{}
	svc := newSvc(iss, fakeCriteria{raw: []byte(sampleCriteria), found: true})
	report := []byte(failedReport)

	// Same attempt, called twice — a Temporal activity retry. The keys must match so
	// the second pass files nothing new.
	if _, err := svc.MintRepairIssues(context.Background(), "org", "proj", thisMilestone, report, "cycle-abc"); err != nil {
		t.Fatalf("first mint: %v", err)
	}
	firstKeys := dedupeKeys(iss)
	iss.created = nil

	if _, err := svc.MintRepairIssues(context.Background(), "org", "proj", thisMilestone, report, "cycle-abc"); err != nil {
		t.Fatalf("retry: %v", err)
	}
	if got := dedupeKeys(iss); !equalStrings(got, firstKeys) {
		t.Errorf("a retry of the SAME attempt produced different keys:\n got %v\nwant %v", got, firstKeys)
	}

	// The NEXT attempt is different work: the criterion failed again, after a repair,
	// and the last attempt's issues are closed. Its keys must differ or the second
	// attempt's repair work would be silently suppressed.
	iss.created = nil
	if _, err := svc.MintRepairIssues(context.Background(), "org", "proj", thisMilestone, report, "cycle-xyz"); err != nil {
		t.Fatalf("second attempt: %v", err)
	}
	for _, key := range dedupeKeys(iss) {
		for _, prior := range firstKeys {
			if key == prior {
				t.Errorf("attempt 2 reused attempt 1's dedupe key %q; its repair work would never be filed", key)
			}
		}
	}
}

// A report with nothing failed is not an error — it is what "there was nothing to
// repair" looks like, and the caller reads the empty result as "no work to do".
func TestMintRepairIssues_NothingFailedFilesNothing(t *testing.T) {
	iss := &fakeIssues{}
	svc := newSvc(iss, fakeCriteria{raw: []byte(sampleCriteria), found: true})

	for name, report := range map[string]string{
		"all green":  `{"criteria":[{"id":"AC-001-a","status":"pass"}]}`,
		"no report":  "",
		"unparsable": `{`,
	} {
		filed, err := svc.MintRepairIssues(context.Background(), "org", "proj", thisMilestone,
			[]byte(report), "cycle-abc")
		if err != nil {
			t.Errorf("%s: MintRepairIssues: %v", name, err)
		}
		if len(filed) != 0 || len(iss.created) != 0 {
			t.Errorf("%s: filed %v; want nothing", name, filed)
		}
	}
}

// Without a cycle id two attempts would share a dedupe key, so the second
// attempt's repair work would vanish. Refusing loudly beats filing work that
// silently collides.
func TestMintRepairIssues_RequiresACycleID(t *testing.T) {
	iss := &fakeIssues{}
	svc := newSvc(iss, fakeCriteria{raw: []byte(sampleCriteria), found: true})

	if _, err := svc.MintRepairIssues(context.Background(), "org", "proj", thisMilestone,
		[]byte(failedReport), "  "); err == nil {
		t.Error("MintRepairIssues accepted a blank cycle id; the dedupe key needs it")
	}
	if len(iss.created) != 0 {
		t.Errorf("filed %d issues before refusing", len(iss.created))
	}
}

// An unusable oracle costs the issue its `must` and nothing else. Refusing to file
// would leave the run with no repair work, and a run with nothing to work settles
// GREEN over a validation failure — strictly worse than a thinner issue body.
func TestMintRepairIssues_FilesWithoutTheOracle(t *testing.T) {
	iss := &fakeIssues{}
	svc := newSvc(iss, fakeCriteria{found: false})

	filed, err := svc.MintRepairIssues(context.Background(), "org", "proj", thisMilestone,
		[]byte(failedReport), "cycle-abc")
	if err != nil {
		t.Fatalf("MintRepairIssues: %v", err)
	}
	if len(filed) != 2 {
		t.Fatalf("filed %v; want the failures filed even with no oracle to quote", filed)
	}
	if !strings.Contains(iss.created[0].Body, "Hello, undefined") {
		t.Error("the report's own failure detail should still reach the issue")
	}
}

// productionReport is a REAL report shape, taken verbatim from a run's committed
// tests/validation/report.json (fields trimmed to those this package reads, values
// left alone). It pins two things the hand-written fixtures above cannot:
//
//   - the generator echoes `must` into the report, so a repair issue is answerable
//     from one read and does not depend on the oracle at all;
//   - a PASSING criterion carries `failure: null`, which the failure decoder has to
//     survive rather than treat as a malformed object.
const productionReport = `{
  "schemaVersion": 1,
  "issue": 3,
  "commit": "c5208feed192b527c7136e5135cfbcc773ed0860",
  "generatedAt": "2026-07-31T09:19:11.404Z",
  "playwrightVersion": "1.61.1",
  "totals": {"e2e": {"total": 2, "pass": 1, "fail": 1, "notRun": 0}, "manual": 1, "scenario": 0},
  "criteria": [
    {"id": "AC-001-a", "requirementId": "REQ-001",
     "must": "Visiting the app's root URL returns a page without requiring login",
     "method": "e2e", "status": "pass", "spec": "tests/e2e/specs/AC-001-a.spec.ts",
     "healed": false, "healAttempts": 0, "flaky": false, "durationMs": 192, "failure": null},
    {"id": "AC-001-b", "requirementId": "REQ-001",
     "must": "The page displays the text \"Hello, World!\"",
     "method": "e2e", "status": "fail", "spec": "tests/e2e/specs/AC-001-b.spec.ts",
     "healed": false, "healAttempts": 0, "flaky": false, "durationMs": 95,
     "failure": {"message": "expected \"Hello, World!\" but the heading was empty",
                 "location": "tests/e2e/specs/AC-001-b.spec.ts:9"}},
    {"id": "AC-001-c", "requirementId": "REQ-001",
     "must": "The page renders correctly on desktop and mobile widths",
     "method": "manual", "status": "manual", "spec": null,
     "healed": false, "healAttempts": 0, "flaky": false, "durationMs": 0, "failure": null}
  ]
}`

func TestMintRepairIssues_AgainstAProductionReport(t *testing.T) {
	iss := &fakeIssues{}
	// No oracle at all: the report has to be sufficient on its own.
	svc := newSvc(iss, fakeCriteria{found: false})

	filed, err := svc.MintRepairIssues(context.Background(), "org", "proj", thisMilestone,
		[]byte(productionReport), "cycle-real")
	if err != nil {
		t.Fatalf("MintRepairIssues: %v", err)
	}
	if len(filed) != 1 {
		t.Fatalf("filed %d issues; exactly one criterion failed", len(filed))
	}
	body := iss.created[0].Body
	for _, want := range []string{
		`The page displays the text "Hello, World!"`,         // must, straight from the report
		`expected "Hello, World!" but the heading was empty`, // the assertion
		"tests/e2e/specs/AC-001-b.spec.ts:9",                 // location
	} {
		if !strings.Contains(body, want) {
			t.Errorf("body is missing %q:\n%s", want, body)
		}
	}
	if !strings.Contains(iss.created[0].Title, "AC-001-b") {
		t.Errorf("title = %q; want the failing criterion named", iss.created[0].Title)
	}
}

func dedupeKeys(iss *fakeIssues) []string {
	out := make([]string, 0, len(iss.created))
	for _, req := range iss.created {
		out = append(out, req.DedupeKey)
	}
	return out
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
