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
	"errors"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// commentBody composes a report comment the way the runner's skill does: marker
// first, human markdown, then the payload in a json fence.
func commentBody(tag, execution, payload string) string {
	return "<!-- aep:validation-report/v1 tag=" + tag + " execution=" + execution + " -->\n" +
		"## Validation report\n\n| criterion | status |\n|---|---|\n| AC-1 | pass |\n\n" +
		"```json\n" + payload + "\n```\n"
}

func at(min int) time.Time {
	return time.Date(2026, 7, 28, 10, min, 0, 0, time.UTC)
}

func TestFindReportCommentPicksMatchingExecution(t *testing.T) {
	comments := []sourcecontrol.IssueComment{
		// The runner's opening comment — no marker, must be ignored.
		{ID: 1, Body: "Starting validation for issue #7", CreatedAt: at(0)},
		{ID: 2, Body: commentBody("design-v3", "exec-a", `{"run":"first"}`), CreatedAt: at(5)},
		// A newer report from a DIFFERENT execution must not be picked.
		{ID: 3, Body: commentBody("design-v4", "exec-c", `{"run":"other-tag"}`), CreatedAt: at(15)},
		{ID: 4, Body: commentBody("design-v3", "exec-b", `{"run":"second"}`), CreatedAt: at(10)},
	}

	got, err := FindReportComment(comments, "exec-b")
	if err != nil {
		t.Fatalf("FindReportComment: %v", err)
	}
	if string(got.Report) != `{"run":"second"}` {
		t.Errorf("report = %s; want exec-b's payload", got.Report)
	}
	if got.Execution != "exec-b" {
		t.Errorf("execution = %q; want exec-b", got.Execution)
	}
	if !got.CreatedAt.Equal(at(10)) {
		t.Errorf("createdAt = %v; want %v", got.CreatedAt, at(10))
	}
}

// An empty execution means "any run" — the console's read, where the issue has
// already narrowed the results to one tag.
func TestFindReportCommentAnyExecution(t *testing.T) {
	comments := []sourcecontrol.IssueComment{
		{ID: 1, Body: commentBody("design-v3", "exec-a", `{"run":"only"}`), CreatedAt: at(5)},
	}
	got, err := FindReportComment(comments, "")
	if err != nil {
		t.Fatalf("FindReportComment: %v", err)
	}
	if got.Tag != "design-v3" {
		t.Errorf("tag = %q; want design-v3", got.Tag)
	}
}

// No marked comment is report_missing, distinct from a malformed one — the two
// map to different failure kinds, so they must not collapse into one error.
func TestFindReportCommentMissing(t *testing.T) {
	tests := []struct {
		name     string
		comments []sourcecontrol.IssueComment
		exec     string
	}{
		{"no comments at all", nil, "exec-a"},
		{"no marker", []sourcecontrol.IssueComment{{ID: 1, Body: "just a human talking"}}, "exec-a"},
		{
			// The report of a PREVIOUS run against the same tag/issue must not
			// satisfy this run — that is what makes report_missing trustworthy.
			"marker from another execution only",
			[]sourcecontrol.IssueComment{{ID: 1, Body: commentBody("design-v3", "exec-previous", `{}`)}},
			"exec-a",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := FindReportComment(tt.comments, tt.exec)
			if !errors.Is(err, ErrNoReportComment) {
				t.Fatalf("err = %v; want ErrNoReportComment", err)
			}
		})
	}
}

// A marked comment whose payload cannot be recovered is malformed, NOT missing.
func TestFindReportCommentMalformed(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{
			"marker but no fence",
			"<!-- aep:validation-report/v1 tag=design-v3 execution=e -->\nreport went missing",
		},
		{
			"unterminated fence",
			"<!-- aep:validation-report/v1 tag=design-v3 execution=e -->\n```json\n{\"a\":1}\n",
		},
		{
			"empty payload",
			"<!-- aep:validation-report/v1 tag=design-v3 execution=e -->\n```json\n\n```\n",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := FindReportComment([]sourcecontrol.IssueComment{{ID: 1, Body: tt.body}}, "e")
			if err == nil {
				t.Fatal("want an error")
			}
			if errors.Is(err, ErrNoReportComment) {
				t.Error("a malformed report must not report as missing — they map to different failure kinds")
			}
		})
	}
}

// The payload is JSON.stringify output, so newlines inside string values are
// escaped and no line of it can be a bare fence. A multi-line indented payload
// must survive extraction intact.
func TestFindReportCommentIndentedPayload(t *testing.T) {
	payload := "{\n  \"schemaVersion\": 1,\n  \"criteria\": [\n    {\"id\": \"AC-1\", \"status\": \"pass\"}\n  ]\n}"
	got, err := FindReportComment(
		[]sourcecontrol.IssueComment{{ID: 1, Body: commentBody("design-v3", "e", payload)}},
		"e",
	)
	if err != nil {
		t.Fatalf("FindReportComment: %v", err)
	}
	if string(got.Report) != payload {
		t.Errorf("report =\n%s\nwant\n%s", got.Report, payload)
	}
	// End to end: the extracted payload must feed ComputeVerdict.
	verdict, err := ComputeVerdict(got.Report)
	if err != nil {
		t.Fatalf("ComputeVerdict on extracted payload: %v", err)
	}
	if verdict != "pass" {
		t.Errorf("verdict = %q; want pass", verdict)
	}
}
