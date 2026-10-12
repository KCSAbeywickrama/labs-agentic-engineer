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

package spec

import (
	"testing"

	"github.com/wso2/aep/aep-api/internal/platform/designspec"
)

// The design save gate over specs/design/review.json, the Design step's
// comments and checks. The rules themselves are pinned in designspec; these
// rows prove the gate applies them to the review file and reports a per-file
// row, so a malformed file written by the console or the agent never acquires
// a tag.

const soundReview = `{"version":1,"artifacts":[{"path":"specs/design/domain-model.md","comments":[
  {"id":"c1","author":{"id":"u-1","name":"Mark"},"text":"Name it Expense.","createdAt":"2026-10-10T09:00:00Z","status":"draft"}]}]}`

func TestSaveGate_ReviewIsOptionalAndASoundOnePasses(t *testing.T) {
	files := securityDesignBundle(t)
	if err := validateDesignBundle(files); err != nil {
		t.Fatalf("a design with no review.json must pass: %v", err)
	}
	files["review.json"] = soundReview
	if err := validateDesignBundle(files); err != nil {
		t.Fatalf("a sound review.json must pass the save gate: %v", err)
	}
}

func TestSaveGate_RefusesAMalformedReview(t *testing.T) {
	for _, tc := range []struct {
		name, content, code, message string
	}{
		{"not JSON", "{nope", designspec.CodeInvalidJSON, "not valid JSON"},
		{"unknown status", `{"version":1,"artifacts":[{"path":"specs/design/domain-model.md","comments":[
  {"id":"c1","author":{"id":"u","name":"M"},"text":"t","createdAt":"x","status":"resolved"}]}]}`, designspec.CodeSchemaViolation, "status"},
		{"addressed without a reply", `{"version":1,"artifacts":[{"path":"specs/design/domain-model.md","comments":[
  {"id":"c1","author":{"id":"u","name":"M"},"text":"t","createdAt":"x","status":"addressed"}]}]}`, designspec.CodeSchemaViolation, `"reply"`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := securityDesignBundle(t)
			files["review.json"] = tc.content
			rows := fileRows(t, validateDesignBundle(files))
			if len(rows) != 1 {
				t.Fatalf("want exactly one row, got %+v", rows)
			}
			if rows[0].Path != "review.json" || rows[0].Code != tc.code {
				t.Errorf("row = %s %s, want review.json %s", rows[0].Path, rows[0].Code, tc.code)
			}
			assertContains(t, rows[0].Message, tc.message)
		})
	}
}
