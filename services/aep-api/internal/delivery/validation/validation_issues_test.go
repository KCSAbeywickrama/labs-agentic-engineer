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
	"reflect"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// The version under test, and the one before it. Two distinct milestones are
// what tell a version-scoped lookup apart from a project-wide one.
const (
	thisMilestone = 5
	pastMilestone = 4
)

// ---- fakes ------------------------------------------------------------------

type fakeIssues struct {
	// byMilestone is the host's issue index — milestone number → its issues. The
	// fake HONOURS the filter it is handed, because one that ignored it would let
	// a project-wide query pass for a milestone-scoped one.
	byMilestone map[int][]sourcecontrol.IssueInfo
	// filters records what was asked, so a test can assert the question and not
	// just the answer.
	filters []sourcecontrol.MilestoneIssuesFilter
	created []sourcecontrol.CreateIssueRequest
	// numberless models a provider that files the issue and reports back no
	// number — the one create outcome the minter must not read as "nothing to
	// validate".
	numberless bool
}

func (f *fakeIssues) ListMilestoneIssues(_ context.Context, _, _ string, filter sourcecontrol.MilestoneIssuesFilter) ([]sourcecontrol.IssueInfo, error) {
	f.filters = append(f.filters, filter)
	var out []sourcecontrol.IssueInfo
	for _, issue := range f.byMilestone[filter.Number] {
		if filter.State != "" && !strings.EqualFold(issue.State, filter.State) {
			continue
		}
		// REST narrows as labels are added (sourcecontrol/README.md) — every
		// requested label must be present.
		if !hasEveryLabel(issue.Labels, filter.Labels) {
			continue
		}
		out = append(out, issue)
	}
	return out, nil
}

func (f *fakeIssues) CreateIssue(_ context.Context, _, _ string, req sourcecontrol.CreateIssueRequest) (*sourcecontrol.IssueResult, error) {
	f.created = append(f.created, req)
	if f.numberless {
		return &sourcecontrol.IssueResult{URL: "https://example/issues/unknown"}, nil
	}
	return &sourcecontrol.IssueResult{Number: 42, URL: "https://example/issues/42"}, nil
}

func hasEveryLabel(have, want []string) bool {
	for _, label := range want {
		if !delivery.HasLabel(have, label) {
			return false
		}
	}
	return true
}

type fakeCriteria struct {
	raw   []byte
	found bool
}

func (f fakeCriteria) ReadValidationCriteria(_ context.Context, _, _ string) ([]byte, bool, error) {
	return f.raw, f.found, nil
}

const sampleCriteria = `{
  "requirements": [
    { "id": "REQ-001", "statement": "Greets by name",
      "criteria": [
        { "id": "AC-001-a", "must": "A text box is visible", "method": "e2e" },
        { "id": "AC-001-b", "must": "Says Hello, name", "method": "e2e" }
      ] },
    { "id": "REQ-002", "statement": "Copy is clear",
      "criteria": [ { "id": "AC-002-a", "must": "Greeting is friendly", "method": "manual" } ] }
  ]
}`

func newSvc(iss *fakeIssues, crit fakeCriteria) *Service {
	return NewService(Deps{Issues: iss, Criteria: crit})
}

// validationIssue is an open aep:validation issue as the host would report it.
func validationIssue(number int) sourcecontrol.IssueInfo {
	return sourcecontrol.IssueInfo{
		Number: number, State: "open", Labels: []string{delivery.LabelValidationWork},
	}
}

// ---- tests ------------------------------------------------------------------

func TestEnsureValidationIssue_CreatesFormattedIssue(t *testing.T) {
	iss := &fakeIssues{}
	svc := newSvc(iss, fakeCriteria{raw: []byte(sampleCriteria), found: true})

	if _, err := svc.EnsureValidationIssue(context.Background(), "org", "proj", thisMilestone); err != nil {
		t.Fatalf("EnsureValidationIssue: %v", err)
	}
	if len(iss.created) != 1 {
		t.Fatalf("want 1 created issue, got %d", len(iss.created))
	}
	got := iss.created[0]

	// ONE label, and deliberately not the `aep` working-set one: the validation
	// cycle is dispatched at this issue by number, and working-set membership
	// would hold the run's settle predicate open forever.
	wantLabels := []string{delivery.LabelValidationWork}
	if !reflect.DeepEqual(got.Labels, wantLabels) {
		t.Errorf("labels = %v; want %v", got.Labels, wantLabels)
	}
	if got.Title != validationTitle {
		t.Errorf("title = %q; want %q", got.Title, validationTitle)
	}

	// The MILESTONE is the version pin, and it rides the create — no follow-up
	// patch, so the issue is never versionless even for a beat.
	if got.Milestone == nil {
		t.Fatal("no milestone on the create: the issue would be born with no version")
	}
	if *got.Milestone != thisMilestone {
		t.Errorf("milestone = %d; want %d", *got.Milestone, thisMilestone)
	}
	// The dedupe key is version-scoped too, so a later version's mint is never
	// deduped against this one.
	if got.DedupeKey != "validation:proj:5" {
		t.Errorf("dedupe key = %q; want the milestone-scoped %q", got.DedupeKey, "validation:proj:5")
	}

	// The body is PROSE: the consumer contract the aep-validation skill reads,
	// with no machine block, and NO deployed endpoints or credentials (the
	// runner fetches those from the secure validation-context endpoint).
	if strings.Contains(got.Body, "aep:task/v1") {
		t.Errorf("a validation issue body must carry no machine block:\n%s", got.Body)
	}
	for _, want := range []string{"## Acceptance oracle", "## Test layout", "## Report", "AC-001-a", "specs/validation/validation-criteria.json"} {
		if !strings.Contains(got.Body, want) {
			t.Errorf("body missing %q", want)
		}
	}
	if strings.Contains(got.Body, "## Deployed endpoints") {
		t.Error("body must NOT carry a Deployed endpoints section (runner fetches endpoints from validation-context)")
	}
	// e2e count reflects the oracle (2 e2e). Coverage is no longer a field —
	// it is derived from committed-spec presence, so the oracle summary just
	// counts by method.
	if !strings.Contains(got.Body, "`e2e` — 2 criteria") {
		t.Errorf("acceptance-oracle counts wrong; body:\n%s", got.Body)
	}
}

// The minted number comes from the create itself and is never re-discovered by
// listing. GitHub's issue index lags the write by a beat, so the re-read this
// replaces came back empty on a real run: the supervisor filed the validation
// issue, failed to find it a second later, and reported the version `skipped`
// over an oracle it had itself just filed. The fake's milestone holds nothing,
// which is exactly how that lagging index behaves.
func TestEnsureValidationIssue_ReturnsTheNumberItMinted(t *testing.T) {
	iss := &fakeIssues{} // the milestone reads empty, always
	svc := newSvc(iss, fakeCriteria{raw: []byte(sampleCriteria), found: true})

	number, err := svc.EnsureValidationIssue(context.Background(), "org", "proj", thisMilestone)
	if err != nil {
		t.Fatalf("EnsureValidationIssue: %v", err)
	}
	if number != 42 {
		t.Fatalf("issue number = %d; want 42 — the number the create reported", number)
	}
}

// 0 is the minter's way of saying "there is nothing to validate", which settles
// the run `skipped`. A create that reports no number is a broken provider, not
// an absent oracle, so it must surface as an error and let the activity retry —
// the retry then finds the open issue and returns its number.
func TestEnsureValidationIssue_NumberlessCreateIsAnError(t *testing.T) {
	iss := &fakeIssues{numberless: true}
	svc := newSvc(iss, fakeCriteria{raw: []byte(sampleCriteria), found: true})

	number, err := svc.EnsureValidationIssue(context.Background(), "org", "proj", thisMilestone)
	if err == nil {
		t.Fatal("want an error when the create reports no number, got nil")
	}
	if number != 0 {
		t.Errorf("number = %d; want 0 alongside the error", number)
	}
}

// One validation issue per version: a re-entered validation cycle must be
// dispatched at the issue this version already has, not mint a second.
func TestEnsureValidationIssue_ReusesTheVersionsOwnOpenIssue(t *testing.T) {
	iss := &fakeIssues{byMilestone: map[int][]sourcecontrol.IssueInfo{
		thisMilestone: {validationIssue(7)},
	}}
	svc := newSvc(iss, fakeCriteria{raw: []byte(sampleCriteria), found: true})

	number, err := svc.EnsureValidationIssue(context.Background(), "org", "proj", thisMilestone)
	if err != nil {
		t.Fatalf("EnsureValidationIssue: %v", err)
	}
	if len(iss.created) != 0 {
		t.Fatalf("dedup failed: created %d issues, want 0", len(iss.created))
	}
	if number != 7 {
		t.Errorf("issue number = %d; want the open issue 7", number)
	}

	// The QUESTION matters as much as the answer: scoped to this milestone, open
	// only, and narrowed to the validation label.
	if len(iss.filters) != 1 {
		t.Fatalf("want 1 milestone read, got %d", len(iss.filters))
	}
	want := sourcecontrol.MilestoneIssuesFilter{
		Number: thisMilestone, State: "open", Labels: []string{delivery.LabelValidationWork},
	}
	if !reflect.DeepEqual(iss.filters[0], want) {
		t.Errorf("filter = %+v; want %+v", iss.filters[0], want)
	}
}

// The regression that the project-wide lookup caused: v2's run found v1's still
// open validation issue and re-filed it under v2's milestone, erasing it from
// v1's ledger and handing v2's agent the criteria table rendered for v1.
func TestEnsureValidationIssue_DoesNotReuseAnotherVersionsIssue(t *testing.T) {
	iss := &fakeIssues{byMilestone: map[int][]sourcecontrol.IssueInfo{
		pastMilestone: {validationIssue(7)},
	}}
	svc := newSvc(iss, fakeCriteria{raw: []byte(sampleCriteria), found: true})

	number, err := svc.EnsureValidationIssue(context.Background(), "org", "proj", thisMilestone)
	if err != nil {
		t.Fatalf("EnsureValidationIssue: %v", err)
	}
	if number == 7 {
		t.Fatal("adopted the PREVIOUS version's validation issue — its criteria are stale and v1 loses it from its ledger")
	}
	if len(iss.created) != 1 {
		t.Fatalf("want a fresh issue for this version, created %d", len(iss.created))
	}
	if m := iss.created[0].Milestone; m == nil || *m != thisMilestone {
		t.Errorf("fresh issue filed under %v; want milestone %d", m, thisMilestone)
	}
}

// A validation issue with no version is the state this whole change removes, so
// the minter refuses rather than filing one loose in the repo.
func TestEnsureValidationIssue_RefusesWithoutAMilestone(t *testing.T) {
	iss := &fakeIssues{}
	svc := newSvc(iss, fakeCriteria{raw: []byte(sampleCriteria), found: true})

	number, err := svc.EnsureValidationIssue(context.Background(), "org", "proj", 0)
	if err == nil {
		t.Fatal("want an error with no milestone, got nil")
	}
	if number != 0 {
		t.Errorf("number = %d; want 0 alongside the error", number)
	}
	if len(iss.created) != 0 {
		t.Errorf("filed %d versionless issue(s); want 0", len(iss.created))
	}
}

func TestEnsureValidationIssue_SkipsWhenCriteriaAbsent(t *testing.T) {
	iss := &fakeIssues{}
	svc := newSvc(iss, fakeCriteria{found: false})

	number, err := svc.EnsureValidationIssue(context.Background(), "org", "proj", thisMilestone)
	if err != nil {
		t.Fatalf("EnsureValidationIssue: %v", err)
	}
	if len(iss.created) != 0 {
		t.Fatalf("want no issue when criteria file absent, got %d", len(iss.created))
	}
	if number != 0 {
		t.Errorf("number = %d; want 0 — no oracle, nothing to validate", number)
	}
}

func TestEnsureValidationIssue_SkipsWhenCriteriaMalformed(t *testing.T) {
	iss := &fakeIssues{}
	svc := newSvc(iss, fakeCriteria{raw: []byte(`{"requirements": []}`), found: true})

	number, err := svc.EnsureValidationIssue(context.Background(), "org", "proj", thisMilestone)
	if err != nil {
		t.Fatalf("EnsureValidationIssue (malformed should skip, not error): %v", err)
	}
	if len(iss.created) != 0 {
		t.Fatalf("want no issue when criteria empty/malformed, got %d", len(iss.created))
	}
	if number != 0 {
		t.Errorf("number = %d; want 0", number)
	}
}
