/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/**
 * Write-gate behavior for `specs/design/review.json`, the Design step's
 * comments and checks: the schema and the rules across entries, directly and
 * through FileBundle (the agent's file tools).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkDesignReview, DESIGN_REVIEW_PATH } from "../src/design-review-schema.ts";
import { FileBundle } from "../src/bundle.ts";

const HASH = "a".repeat(64);
const PROTOTYPE = "specs/design/components/web/prototype.json";

const comment = (overrides: Record<string, unknown> = {}) => ({
  id: "c1",
  author: { id: "u-1", name: "Mark" },
  text: "Name the aggregate Expense, not Claim.",
  createdAt: "2026-10-10T09:00:00Z",
  status: "draft",
  ...overrides,
});

/** A review holding a checked domain model and an addressed prototype comment. */
function review(overrides: { artifacts?: unknown[] } & Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    artifacts: [
      { path: "specs/design/domain-model.md", checkedHash: HASH, comments: [comment()] },
      {
        path: PROTOTYPE,
        comments: [
          comment({
            id: "c2",
            status: "addressed",
            sentAt: "2026-10-10T09:05:00Z",
            reply: "Moved the total above the list.",
            revision: 3,
            addressedAt: "2026-10-10T09:06:00Z",
            anchor: { screenId: "home", flowId: "submit", roleId: "user", stateId: "default", elementIds: ["total"] },
          }),
        ],
      },
      { path: "specs/validation/acceptance/F1-submit.md" },
    ],
    ...overrides,
  });
}

const problem = (content: string) => checkDesignReview(DESIGN_REVIEW_PATH, content);

test("ignores every other path", () => {
  assert.equal(checkDesignReview("specs/design/security.json", "{nope"), null);
  assert.equal(checkDesignReview("specs/design/components/web/review.json", "{nope"), null);
});

test("accepts a sound review, and an empty one", () => {
  assert.equal(problem(review()), null);
  assert.equal(problem(JSON.stringify({ version: 1, artifacts: [] })), null);
});

test("accepts the agent's question on a sent comment, and the user's answer reopening it", () => {
  const asked = comment({ status: "sent", sentAt: "2026-10-10T09:05:00Z", question: "Which total: before or after tax?" });
  const answered = { ...asked, status: "reopened", answer: "After tax." };
  for (const c of [asked, answered, { ...answered, status: "addressed", reply: "Shows the total after tax.", revision: 2 }]) {
    assert.equal(problem(JSON.stringify({ version: 1, artifacts: [{ path: "specs/design/domain-model.md", comments: [c] }] })), null, c.status);
  }
});

test("refuses a file that is not JSON", () => {
  assert.equal(problem("{nope")?.code, "INVALID_JSON");
});

for (const [name, artifacts, expected] of [
  ["an unknown status", [{ path: "specs/design/domain-model.md", comments: [comment({ status: "resolved" })] }], /status/],
  ["a missing text", [{ path: "specs/design/domain-model.md", comments: [comment({ text: undefined })] }], /text/],
  ["a blank text", [{ path: "specs/design/domain-model.md", comments: [comment({ text: "  \n" })] }], /text: must not be blank/],
  ["an unknown key on a comment", [{ path: "specs/design/domain-model.md", comments: [comment({ resolved: true })] }], /resolved/],
  ["a hash that is not a SHA-256", [{ path: "specs/design/domain-model.md", checkedHash: "abc" }], /checkedHash/],
  ["a path outside the generated artifacts", [{ path: "specs/requirements/prd.md" }], /path/],
  ["a revision that is not a positive integer", [{ path: PROTOTYPE, comments: [comment({ revision: 0 })] }], /revision/],
  ["a blank question", [{ path: PROTOTYPE, comments: [comment({ status: "sent", question: " " })] }], /question: must not be blank/],
  ["a blank answer", [{ path: PROTOTYPE, comments: [comment({ status: "reopened", question: "Which?", answer: "" })] }], /answer: must not be blank/],
] as const) {
  test(`refuses ${name}`, () => {
    const p = problem(JSON.stringify({ version: 1, artifacts }));
    assert.equal(p?.code, "SCHEMA_VIOLATION");
    assert.match(p!.message, /violates the DesignReview schema/);
    assert.match(p!.message, expected);
  });
}

test("refuses another version and an unknown top-level key", () => {
  assert.match(problem(review({ version: 2 }))!.message, /version/);
  assert.match(problem(review({ checks: [] }))!.message, /checks/);
});

test("refuses the rules the schema cannot say", () => {
  const twice = { path: "specs/design/domain-model.md" };
  assert.match(problem(JSON.stringify({ version: 1, artifacts: [twice, twice] }))!.message, /appears more than once/);

  const reused = [
    { path: "specs/design/domain-model.md", comments: [comment()] },
    { path: "specs/design/flows/submit.md", comments: [comment()] },
  ];
  assert.match(problem(JSON.stringify({ version: 1, artifacts: reused }))!.message, /"c1" is already used/);

  const unanswered = [{ path: "specs/design/domain-model.md", comments: [comment({ status: "addressed" })] }];
  assert.match(problem(JSON.stringify({ version: 1, artifacts: unanswered }))!.message, /addressed comment carries its one-line "reply"/);

  const anchored = [{ path: "specs/design/domain-model.md", comments: [comment({ anchor: { screenId: "s", roleId: "r", stateId: "d", elementIds: [] } })] }];
  assert.match(problem(JSON.stringify({ version: 1, artifacts: anchored }))!.message, /only a prototype's comments/);

  const draftQuestion = [{ path: "specs/design/domain-model.md", comments: [comment({ question: "Which?" })] }];
  assert.match(problem(JSON.stringify({ version: 1, artifacts: draftQuestion }))!.message, /a draft has no question/);

  const loneAnswer = [{ path: "specs/design/domain-model.md", comments: [comment({ status: "reopened", answer: "After tax." })] }];
  assert.match(problem(JSON.stringify({ version: 1, artifacts: loneAnswer }))!.message, /an answer goes with the agent's "question"/);
});

test("FileBundle refuses a malformed review.json and keeps the file as it was", () => {
  const prior = review();
  const b = new FileBundle({ [DESIGN_REVIEW_PATH]: prior });
  const r = b.editFile(DESIGN_REVIEW_PATH, '"status":"draft"', '"status":"resolved"');
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "SCHEMA_VIOLATION");
  assert.equal(b.read(DESIGN_REVIEW_PATH), prior);

  const ok = b.editFile(DESIGN_REVIEW_PATH, '"status":"draft"', '"status":"sent"');
  assert.equal(ok.ok, true, JSON.stringify(ok));
});
