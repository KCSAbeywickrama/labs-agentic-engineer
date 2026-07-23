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
	"errors"
	"testing"
)

type fakeTaskLocator struct {
	repo    string
	issue   int
	project string
	found   bool
}

func (f fakeTaskLocator) LookupExecutionTask(_ context.Context, _, _ string) (string, int, string, bool, error) {
	return f.repo, f.issue, f.project, f.found, nil
}

type capturedUpsert struct {
	orgID, projectID, repo               string
	issue                                int
	executionID, criterionID, requiremnt string
	status                               string
	calls                                int
}

type fakeCriterionStore struct{ last *capturedUpsert }

func (f *fakeCriterionStore) UpsertCriterion(_ context.Context, orgID, projectID, repo string, issue int, executionID, criterionID, requirementID, status string) error {
	f.last = &capturedUpsert{
		orgID: orgID, projectID: projectID, repo: repo, issue: issue,
		executionID: executionID, criterionID: criterionID, requiremnt: requirementID, status: status,
		calls: 1,
	}
	return nil
}

func TestReportCriterion_ResolvesTaskAndUpserts(t *testing.T) {
	store := &fakeCriterionStore{}
	svc := NewCriterionIngestService(
		fakeTaskLocator{repo: "o/r", issue: 30, project: "proj", found: true},
		store,
	)
	err := svc.ReportCriterion(context.Background(), "exec-1", "org", CriterionReportInput{
		CriterionID:   "AC-001-a",
		Status:        "passed",
		RequirementID: "REQ-001",
	})
	if err != nil {
		t.Fatalf("ReportCriterion: %v", err)
	}
	if store.last == nil {
		t.Fatal("store was not called")
	}
	got := store.last
	if got.orgID != "org" || got.projectID != "proj" || got.repo != "o/r" || got.issue != 30 {
		t.Errorf("scope = org=%q proj=%q repo=%q issue=%d", got.orgID, got.projectID, got.repo, got.issue)
	}
	if got.criterionID != "AC-001-a" || got.status != "passed" || got.requiremnt != "REQ-001" || got.executionID != "exec-1" {
		t.Errorf("payload = %+v", got)
	}
}

func TestReportCriterion_UnknownExecutionIs404(t *testing.T) {
	svc := NewCriterionIngestService(fakeTaskLocator{found: false}, &fakeCriterionStore{})
	err := svc.ReportCriterion(context.Background(), "exec-x", "org", CriterionReportInput{
		CriterionID: "AC-001-a", Status: "validating",
	})
	if !errors.Is(err, ErrExecutionNotFound) {
		t.Fatalf("want ErrExecutionNotFound (→ 404), got %v", err)
	}
}

func TestReportCriterion_RejectsInvalidInput(t *testing.T) {
	store := &fakeCriterionStore{}
	svc := NewCriterionIngestService(fakeTaskLocator{found: true}, store)
	for _, in := range []CriterionReportInput{
		{CriterionID: "", Status: "passed"},         // blank id
		{CriterionID: "AC-001-a", Status: "  "},     // blank status
		{CriterionID: "AC-001-a", Status: "bogus"},  // status outside the closed set
		{CriterionID: "AC-001-a", Status: "PASSED"}, // wrong case — not a member
	} {
		err := svc.ReportCriterion(context.Background(), "exec-1", "org", in)
		if !errors.Is(err, ErrInvalidCriterionReport) {
			t.Errorf("want ErrInvalidCriterionReport (→ 400) for %+v, got %v", in, err)
		}
	}
	if store.last != nil {
		t.Error("store must not be called for invalid input")
	}
}
