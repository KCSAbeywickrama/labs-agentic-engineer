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

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { DesignReview, ReviewComment } from "@aep/agent-stream";
import { changedPaths, commentProblems, nextRevision } from "../src/scoring/address-comments.js";
import type { CommentExpect } from "../src/scenario.js";

const SENT: ReviewComment = {
  id: "c1",
  author: { id: "u1", name: "Maya" },
  text: "Rename it.",
  createdAt: "2026-10-11T08:00:00.000Z",
  sentAt: "2026-10-11T08:05:00.000Z",
  status: "sent",
};
const ACT: CommentExpect = { outcome: "act", earliest: ["specs/design/domain-model.md"], changes: [] };

test("nextRevision: 2 when no comment has one, else the highest plus one", () => {
  const review = (revision?: number): DesignReview => ({
    version: 1,
    artifacts: [{ path: "specs/design/domain-model.md", comments: [{ ...SENT, ...(revision ? { revision } : {}) }] }],
  });
  assert.equal(nextRevision(review()), 2);
  assert.equal(nextRevision(review(3)), 4);
});

test("commentProblems act: addressed with a reply at the run's revision passes", () => {
  const after: ReviewComment = { ...SENT, status: "addressed", reply: "Renamed it.", revision: 2, addressedAt: "2026-10-11T09:00:00.000Z" };
  assert.deepEqual(commentProblems("c1", ACT, SENT, after, 2), []);
});

test("commentProblems act: a changed text, a missing reply and a wrong revision are each named", () => {
  const after: ReviewComment = { ...SENT, text: "Renamed.", status: "addressed", revision: 3, addressedAt: "t" };
  const problems = commentProblems("c1", ACT, SENT, after, 2);
  assert.deepEqual(problems, ["c1: changed text", "c1: no reply", "c1: revision 3, expected 2"]);
});

test("commentProblems ask: a question on a sent comment passes; a reply instead is named", () => {
  assert.deepEqual(commentProblems("c1", { outcome: "ask" }, SENT, { ...SENT, question: "By amount or by date?" }, 2), []);
  const replied: ReviewComment = { ...SENT, status: "addressed", reply: "Sorted by amount.", revision: 2 };
  assert.deepEqual(commentProblems("c1", { outcome: "ask" }, SENT, replied, 2), [
    "c1: status addressed, expected sent (waiting on the question)",
    "c1: no question",
    "c1: replied to instead of asked",
  ]);
});

test("commentProblems wait: any change to a draft is named; a removed comment is named", () => {
  const draft: ReviewComment = { ...SENT, status: "draft" };
  assert.deepEqual(commentProblems("c1", { outcome: "wait" }, draft, draft, 2), []);
  assert.equal(commentProblems("c1", { outcome: "wait" }, draft, { ...draft, status: "sent" }, 2).length, 1);
  assert.deepEqual(commentProblems("c1", { outcome: "wait" }, draft, undefined, 2), ["c1: removed from review.json"]);
});

test("changedPaths: edits, additions and removals", () => {
  assert.deepEqual(changedPaths({ a: "1", b: "2", c: "3" }, { a: "1", b: "x", d: "4" }), ["b", "c", "d"]);
});
