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

// failedReport is an agent's report with two scenarios lost, one blocked and one
// passing — the shape a repair pass is built from. The blocked one is here on
// purpose: it must never be filed.
const failedReport = `{"schemaVersion":2,"commit":"abc123","scenarios":[
  {"feature":"Greeting","featureFile":"specs/acceptance/greeting.feature","line":8,
   "rule":"The page greets the visitor by name","scenario":"Greeting a known visitor","outcome":"failed",
   "steps":[
     {"keyword":"When","text":"Ada opens the page","command":"agent-browser open /"},
     {"keyword":"Then","text":"she is greeted by name","command":"agent-browser wait --text \"Hello, Ada\"",
      "exit":1,"observed":"the heading read \"Hello, undefined\""}]},
  {"feature":"Greeting","featureFile":"specs/acceptance/greeting.feature","line":16,
   "rule":"The page greets the visitor by name","scenario":"Greeting an unknown visitor","outcome":"passed"},
  {"feature":"Greeting","featureFile":"specs/acceptance/greeting.feature","line":24,
   "rule":"A blank name is refused","scenario":"Submitting a blank name","outcome":"blocked",
   "steps":[{"keyword":"When","text":"Ada submits a blank name","observed":"the Submit button was [disabled]"}]},
  {"feature":"Copy","featureFile":"specs/acceptance/copy.feature","line":5,
   "rule":"Warnings read as warnings","scenario":"The cutoff notice","outcome":"failed",
   "steps":[{"keyword":"Then","text":"the notice reads as a warning",
             "command":"agent-browser get text .notice","exit":0,"observed":"copy reads as a confirmation"}]}
]}`

// One issue PER FAILED SCENARIO, not one per attempt. The granularity is what
// keeps a partial repair legible to the no-progress rule: an agent that fixes two
// of three failures shrinks the working set, where a single omnibus issue it cannot
// close would look like a cycle that achieved nothing.
//
// The blocked scenario in the fixture is the other half of the rule: a block is
// reported and left for a person, because the agent cannot tell an app that
// correctly refuses an action from one too broken to perform it.
func TestMintRepairIssues_OnePerFailedScenario(t *testing.T) {
	iss := &fakeIssues{}
	svc := newSvc(iss, fakeCriteria{raw: []byte(sampleCriteria), found: true})

	filed, err := svc.MintRepairIssues(context.Background(), "org", "proj", thisMilestone,
		[]byte(failedReport), "cycle-abc")
	if err != nil {
		t.Fatalf("MintRepairIssues: %v", err)
	}
	if len(filed) != 2 {
		t.Fatalf("filed %d issues (%v); want one per failed scenario, and none for the block", len(filed), filed)
	}
	if len(iss.created) != 2 {
		t.Fatalf("created %d issues; want 2", len(iss.created))
	}

	first := iss.created[0]
	if !strings.Contains(first.Title, "Greeting a known visitor") {
		t.Errorf("title = %q; want the scenario named in it", first.Title)
	}
	for _, req := range iss.created {
		if strings.Contains(req.Title, "Submitting a blank name") {
			t.Errorf("a blocked scenario was filed for repair: %q", req.Title)
		}
	}
	if first.Milestone == nil || *first.Milestone != thisMilestone {
		t.Errorf("milestone = %v; repair work belongs to the version that failed", first.Milestone)
	}
	// The working-set label is the whole mechanism: without it the issue is a ledger
	// entry nobody is dispatched for, and the loop would settle over its own repair.
	if !delivery.HasLabel(first.Labels, delivery.LabelAgentWork) {
		t.Errorf("labels = %v; want the %q working-set label", first.Labels, delivery.LabelAgentWork)
	}

	// The body is answerable from the report alone — the scenario text says what
	// was demanded, the observation says what happened, and the location says
	// where to read it. Nothing here needs a second read of the specification.
	for _, want := range []string{
		"The page greets the visitor by name", // the rule
		"Then she is greeted by name",         // the scenario, as written
		`the heading read "Hello, undefined"`, // what the agent observed
		"specs/acceptance/greeting.feature:8", // where to read it
	} {
		if !strings.Contains(first.Body, want) {
			t.Errorf("body is missing %q:\n%s", want, first.Body)
		}
	}
	// Enforcement of this is deferred to separate skill work, so the issue itself has
	// to say it: the cheapest path to a green report is to weaken the assertion.
	if !strings.Contains(first.Body, "specs/acceptance/") {
		t.Errorf("body does not tell the agent the scenarios are off limits:\n%s", first.Body)
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

// The report is self-sufficient: it carries each scenario's own Given/When/Then,
// so nothing here reads the specification. This pins that — a reintroduced oracle
// read would make an unusable oracle able to block repair work, and a run with
// nothing to work settles GREEN over a validation failure.
func TestMintRepairIssues_NeedsNoOracle(t *testing.T) {
	iss := &fakeIssues{}
	svc := newSvc(iss, fakeCriteria{found: false})

	filed, err := svc.MintRepairIssues(context.Background(), "org", "proj", thisMilestone,
		[]byte(failedReport), "cycle-abc")
	if err != nil {
		t.Fatalf("MintRepairIssues: %v", err)
	}
	if len(filed) != 2 {
		t.Fatalf("filed %v; want the failures filed without consulting the specification", filed)
	}
	if !strings.Contains(iss.created[0].Body, "Hello, undefined") {
		t.Error("the report's own observation should still reach the issue")
	}
}

// productionReport is a real agent-browser report — the scenarios, commands and
// exit codes are taken from a recorded run against a live app, restated in
// schemaVersion 2. It pins two things the hand-written fixture above cannot:
//
//   - a scenario settled by a VALUE-RETURNING command, which exits 0 because the
//     command ran. Only the observation says the assertion lost, so a body built
//     from the exit code alone would come out empty;
//   - a passing scenario whose steps carry no `observed` at all, which the decoder
//     has to survive rather than treat as missing evidence.
const productionReport = `{
  "schemaVersion": 2,
  "generatedAt": "2026-09-10T11:02:41.118Z",
  "commit": "6e4f2d6a1c9b3f70d5e2a84c1b6f09e7d3a5c218",
  "baseUrl": "https://shopping-list-dev.example",
  "isolation": "each scenario creates its own list and asserts only on that list",
  "scenarios": [
    {"feature": "Adding items to the list",
     "featureFile": "specs/acceptance/shopping-list.feature", "line": 12,
     "rule": "A household member can add an item with a name and a quantity",
     "scenario": "Adding a new item", "tags": ["@story-2"], "outcome": "passed",
     "steps": [
       {"text": "the shared shopping list is empty", "keyword": "Given",
        "command": "POST /lists (a fresh list for this scenario)"},
       {"text": "Priya adds an item named \"Milk\" with quantity \"2\"", "keyword": "When",
        "command": "agent-browser find role button click --name \"Add item\""},
       {"text": "the list shows \"Milk\" with quantity \"2\"", "keyword": "Then",
        "command": "agent-browser wait --text \"Milk\" --timeout 3000", "exit": 0}]},
    {"feature": "Adding items to the list",
     "featureFile": "specs/acceptance/shopping-list.feature", "line": 27,
     "rule": "An item that duplicates one already on the list is rejected",
     "scenario": "Adding a duplicate item", "tags": ["@negative"], "outcome": "failed",
     "steps": [
       {"text": "the list holds one item named \"Milk\"", "keyword": "Given",
        "command": "POST /lists then POST /lists/{id}/items"},
       {"text": "Dan tries to add another item named \"Milk\"", "keyword": "When",
        "command": "agent-browser find role button click --name \"Add item\""},
       {"text": "the list still has exactly one item", "keyword": "Then",
        "command": "agent-browser get count \"[data-testid=item]\"",
        "exit": 0, "observed": "2 — the list holds \"Milk\" and \" milk \""}]}
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
		t.Fatalf("filed %d issues; exactly one scenario failed", len(filed))
	}
	body := iss.created[0].Body
	for _, want := range []string{
		"An item that duplicates one already on the list is rejected", // the rule
		"Then the list still has exactly one item",                    // the scenario, as written
		`2 — the list holds "Milk" and " milk "`,                      // the observation, which is the only evidence
		"specs/acceptance/shopping-list.feature:27",                   // where to read it
	} {
		if !strings.Contains(body, want) {
			t.Errorf("body is missing %q:\n%s", want, body)
		}
	}
	if !strings.Contains(iss.created[0].Title, "Adding a duplicate item") {
		t.Errorf("title = %q; want the failing scenario named", iss.created[0].Title)
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
