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

package issues_test

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/wso2/aep/aep-api/internal/sourcecontrol/issues"
)

// fakeClassifier answers class (or err) and records each report and org.
type fakeClassifier struct {
	class   issues.ReportClass
	err     error
	reports []issues.Report
	orgs    []string
}

func (f *fakeClassifier) ClassifyReport(_ context.Context, org string, r issues.Report) (issues.ReportClass, error) {
	f.reports, f.orgs = append(f.reports, r), append(f.orgs, org)
	return f.class, f.err
}

func classify(t *testing.T, c issues.ReportClassifier, args map[string]any) map[string]any {
	t.Helper()
	h := issues.NewUserMCPHandler(&recordingIssues{}, issues.IssueAgentPorts{Classifier: c})
	text, isErr := callUserTool(t, h, "classify_report", args)
	if isErr {
		t.Fatalf("classify_report failed: %s", text)
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("%s: %v", text, err)
	}
	return out
}

var unknownClass = map[string]any{"kind": "unknown", "confidence": float64(0), "alternatives": []any{}}

// classify_report asks the platform's classifier for the session's org and
// answers only the kind, its confidence and the two most probable kinds.
func TestUserMCPClassifyReport(t *testing.T) {
	c := &fakeClassifier{class: issues.ReportClass{Kind: "bug", Confidence: 0.9,
		Alternatives: []issues.KindChance{{Kind: "bug", P: 0.9}, {Kind: "improvement", P: 0.07}}}}
	got := classify(t, c, map[string]any{"message": "save does nothing", "recentMessages": []string{"on expenses"}})
	want := map[string]any{"kind": "bug", "confidence": 0.9, "alternatives": []any{
		map[string]any{"kind": "bug", "p": 0.9}, map[string]any{"kind": "improvement", "p": 0.07},
	}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if !reflect.DeepEqual(c.reports, []issues.Report{{Message: "save does nothing", Recent: []string{"on expenses"}}}) || c.orgs[0] != "acme" {
		t.Fatalf("asked %+v for %v", c.reports, c.orgs)
	}
}

// No classifier (the install has no Jev key) or a failing one answers
// unknown: the agent then asks the user, it never fails the turn.
func TestUserMCPClassifyReportUnavailableIsUnknown(t *testing.T) {
	if got := classify(t, nil, map[string]any{"message": "save does nothing"}); !reflect.DeepEqual(got, unknownClass) {
		t.Errorf("no classifier: %v", got)
	}
	if got := classify(t, &fakeClassifier{err: errors.New("jev: unavailable")}, map[string]any{"message": "x"}); !reflect.DeepEqual(got, unknownClass) {
		t.Errorf("failing classifier: %v", got)
	}
}

// One org cannot spend the platform's key without bound: past the per-org
// rate the answer is unknown and the classifier is not asked; another org
// still is.
func TestUserMCPClassifyReportIsRateLimitedPerOrg(t *testing.T) {
	c := &fakeClassifier{class: issues.ReportClass{Kind: "bug", Confidence: 0.9, Alternatives: []issues.KindChance{{Kind: "bug", P: 0.9}}}}
	h := issues.NewUserMCPHandler(&recordingIssues{}, issues.IssueAgentPorts{Classifier: c})
	for i := 0; i < issues.ClassifyBurst; i++ {
		callUserTool(t, h, "classify_report", map[string]any{"message": "m"})
	}
	text, _ := callUserTool(t, h, "classify_report", map[string]any{"message": "m"})
	var got map[string]any
	_ = json.Unmarshal([]byte(text), &got)
	if !reflect.DeepEqual(got, unknownClass) || len(c.reports) != issues.ClassifyBurst {
		t.Fatalf("past the burst: %v after %d asks", got, len(c.reports))
	}
}

func TestUserMCPClassifyReportNeedsAMessage(t *testing.T) {
	h := issues.NewUserMCPHandler(&recordingIssues{}, issues.IssueAgentPorts{Classifier: &fakeClassifier{}})
	if _, isErr := callUserTool(t, h, "classify_report", map[string]any{"message": "  "}); !isErr {
		t.Fatal("an empty message must be a tool error")
	}
}
