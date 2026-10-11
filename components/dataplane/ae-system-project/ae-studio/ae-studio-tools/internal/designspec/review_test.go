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

// The twin of services/aep-api/internal/platform/designspec/review_test.go; keep the
// two in step until the aep-api copy is deleted in phase 4.

package designspec

import (
	"errors"
	"strings"
	"testing"
)

// The review.json gate: the same rows the agent's write gate is held to
// (packages/agent-stream/test/design-review-gate.test.ts), so a file one gate
// refuses the other refuses too.

const reviewHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const validReview = `{
  "version": 1,
  "artifacts": [
    { "path": "specs/design/domain-model.md", "checkedHash": "` + reviewHash + `",
      "comments": [{ "id": "c1", "author": { "id": "u-1", "name": "Mark" }, "text": "Name it Expense.",
                     "createdAt": "2026-10-10T09:00:00Z", "status": "draft" }] },
    { "path": "specs/design/components/web/prototype.json",
      "comments": [{ "id": "c2", "author": { "id": "u-1", "name": "Mark" }, "text": "Move the total up.",
                     "createdAt": "2026-10-10T09:00:00Z", "status": "addressed", "sentAt": "2026-10-10T09:05:00Z",
                     "reply": "Moved the total above the list.", "revision": 3, "addressedAt": "2026-10-10T09:06:00Z",
                     "anchor": { "screenId": "home", "flowId": "submit", "roleId": "user", "stateId": "default", "elementIds": ["total"] } }] },
    { "path": "specs/validation/acceptance/F1-submit.md" }
  ]
}`

// A question the agent asked on a sent comment, and the user's answer reopening it.
const questionReview = `{
  "version": 1,
  "artifacts": [
    { "path": "specs/design/domain-model.md",
      "comments": [
        { "id": "c1", "author": { "id": "u-1", "name": "Mark" }, "text": "Show the total.", "createdAt": "2026-10-10T09:00:00Z",
          "status": "sent", "sentAt": "2026-10-10T09:05:00Z", "question": "Before or after tax?" },
        { "id": "c2", "author": { "id": "u-1", "name": "Mark" }, "text": "Show the date.", "createdAt": "2026-10-10T09:00:00Z",
          "status": "reopened", "sentAt": "2026-10-10T09:05:00Z", "question": "Submitted or approved?", "answer": "Submitted." }] }
  ]
}`

func TestValidateDesignReview_AcceptsASoundReview(t *testing.T) {
	for name, raw := range map[string]string{"sound": validReview, "empty": `{"version":1,"artifacts":[]}`, "question and answer": questionReview} {
		if err := ValidateDesignReview([]byte(raw)); err != nil {
			t.Errorf("%s review refused: %v", name, err)
		}
	}
}

func TestValidateDesignReview_RefusesAMalformedReview(t *testing.T) {
	comment := func(extra string) string {
		return `{"id":"c1","author":{"id":"u","name":"M"},"text":"t","createdAt":"x","status":"draft"` + extra + `}`
	}
	doc := func(artifacts string) string { return `{"version":1,"artifacts":[` + artifacts + `]}` }
	on := func(path, comments string) string { return `{"path":"` + path + `","comments":[` + comments + `]}` }
	const model = "specs/design/domain-model.md"
	for _, tc := range []struct {
		name, raw, code, want string
	}{
		{"not JSON", "{nope", CodeInvalidJSON, "not valid JSON"},
		{"another version", `{"version":2,"artifacts":[]}`, CodeSchemaViolation, "version"},
		{"unknown top-level key", `{"version":1,"artifacts":[],"checks":[]}`, CodeSchemaViolation, "checks"},
		{"unknown status", doc(on(model, strings.Replace(comment(""), `"draft"`, `"resolved"`, 1))), CodeSchemaViolation, "status"},
		{"missing text", doc(on(model, strings.Replace(comment(""), `"text":"t",`, "", 1))), CodeSchemaViolation, "text"},
		{"blank text", doc(on(model, strings.Replace(comment(""), `"text":"t"`, `"text":"  "`, 1))), CodeSchemaViolation, "text"},
		{"unknown comment key", doc(on(model, comment(`,"resolved":true`))), CodeSchemaViolation, "resolved"},
		{"hash not a SHA-256", doc(`{"path":"` + model + `","checkedHash":"abc"}`), CodeSchemaViolation, "checkedHash"},
		{"path outside the artifacts", doc(`{"path":"specs/requirements/prd.md"}`), CodeSchemaViolation, "path"},
		{"revision not positive", doc(on(model, comment(`,"revision":0`))), CodeSchemaViolation, "revision"},
		{"one artifact twice", doc(`{"path":"` + model + `"},{"path":"` + model + `"}`), CodeSchemaViolation, "appears more than once"},
		{"comment id reused", doc(on(model, comment("")) + "," + on("specs/design/flows/submit.md", comment(""))), CodeSchemaViolation, `"c1" is already used`},
		{"addressed without a reply", doc(on(model, strings.Replace(comment(""), `"draft"`, `"addressed"`, 1))), CodeSchemaViolation, `carries its one-line "reply"`},
		{"anchor off a prototype", doc(on(model, comment(`,"anchor":{"screenId":"s","roleId":"r","stateId":"d","elementIds":[]}`))), CodeSchemaViolation, "only a prototype's comments"},
		{"blank question", doc(on(model, strings.Replace(comment(`,"question":" "`), `"draft"`, `"sent"`, 1))), CodeSchemaViolation, "question"},
		{"question on a draft", doc(on(model, comment(`,"question":"Which?"`))), CodeSchemaViolation, "a draft has no question"},
		{"answer without a question", doc(on(model, strings.Replace(comment(`,"answer":"After tax."`), `"draft"`, `"reopened"`, 1))), CodeSchemaViolation, `an answer goes with the agent's "question"`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateDesignReview([]byte(tc.raw))
			var ve *ValidationError
			if !errors.As(err, &ve) {
				t.Fatalf("want a *ValidationError, got %v", err)
			}
			if ve.Code != tc.code || !strings.Contains(ve.Message, tc.want) {
				t.Errorf("got %s %q, want %s containing %q", ve.Code, ve.Message, tc.code, tc.want)
			}
		})
	}
}
