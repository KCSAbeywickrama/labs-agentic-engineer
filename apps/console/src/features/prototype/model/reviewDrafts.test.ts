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

import { describe, expect, it } from "vitest";
import { checkDesignReview, DESIGN_REVIEW_PATH, type ReviewAnchor } from "@aep/agent-stream";
import { dequeue, editRequest, enqueue, keepOnScreen, type PlacedRequest } from "@wso2/prototype-kit/feedback";
import { addDraft, commentsOn, EMPTY_REVIEW, reviewText, sendWaiting } from "../../design/model/review";
import { queueOf, withQueue } from "./reviewDrafts";

// The full-screen review's queue is the reviewer's drafts on the prototype in
// review.json: every move the kit's queue makes lands in the file.

const PATH = "specs/design/components/expense-web/prototype.json";
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const me = { id: "u-priya", name: "Priya" };
let n = 0;
const draft = (text: string, anchor: ReviewAnchor) => ({ id: `c${++n}`, author: me, text, createdAt: "2026-10-10T09:00:00Z", anchor });
const on = (elementIds: string[], text: string): PlacedRequest => ({ screenId: "screen.claim", roleId: "manager", stateId: "state.default", elementIds, text });

/** The review after the queue made `move`, from the queue `review` reads as. */
function after(review: typeof EMPTY_REVIEW, move: (q: ReturnType<typeof queueOf>) => ReturnType<typeof queueOf>, hash = H1) {
  const queue = queueOf(review, PATH, me.id, hash, {}, []);
  const out = withQueue(review, PATH, queue.requests, move(queue).requests, draft);
  expect(checkDesignReview(DESIGN_REVIEW_PATH, reviewText(out.review))).toBeNull();
  return out;
}

describe("the review's queue in review.json", () => {
  it("writes a queued comment as a Pending draft on the prototype, with where it was made", () => {
    const { review, made } = after(EMPTY_REVIEW, (q) => enqueue(q, H1, on(["btn.approve"], "Move it right")));
    const [c] = commentsOn(review, PATH);
    expect(c).toMatchObject({ status: "draft", text: "Move it right", author: me });
    expect(c?.anchor).toEqual({ screenId: "screen.claim", roleId: "manager", stateId: "state.default", elementIds: ["btn.approve"] });
    expect(made[c!.id]).toEqual({ revision: H1 });
  });

  it("reads the drafts back as the queue, on the revision showing unless this browser knows another", () => {
    const { review, made } = after(EMPTY_REVIEW, (q) => enqueue(q, H1, on([], "Too busy")));
    expect(queueOf(review, PATH, me.id, H2, {}, []).requests.map((r) => [r.text, r.revision])).toEqual([["Too busy", H2]]);
    expect(queueOf(review, PATH, me.id, H2, made, []).requests.map((r) => r.revision)).toEqual([H1]);
  });

  it("edits a draft when its comment is edited or kept on its whole screen, and deletes it when it is removed", () => {
    const one = after(EMPTY_REVIEW, (q) => enqueue(q, H1, on(["btn.approve"], "Move it right"))).review;
    const edited = after(one, (q) => editRequest(q, 0, "Move it left")).review;
    expect(commentsOn(edited, PATH)[0]?.text).toBe("Move it left");
    const screen = after(edited, (q) => keepOnScreen(q, 0)).review;
    expect(commentsOn(screen, PATH)[0]?.anchor?.elementIds).toEqual([]);
    expect(after(screen, (q) => dequeue(q, 0)).review).toEqual(EMPTY_REVIEW);
  });

  it("holds only this reviewer's drafts, and leaves a teammate's, and every sent comment, as they are", () => {
    const anchor = { screenId: "screen.claim", roleId: "manager", stateId: "state.default", elementIds: [] };
    let review = addDraft(EMPTY_REVIEW, PATH, { id: "sam-1", author: { id: "u-sam", name: "Sam" }, text: "Theirs", createdAt: "x", anchor });
    review = after(review, (q) => enqueue(q, H1, on([], "Mine, sent"))).review;
    review = sendWaiting(review, "2026-10-10T10:00:00Z").review;
    review = after(review, (q) => enqueue(q, H1, on([], "Mine"))).review;
    expect(queueOf(review, PATH, me.id, H1, {}, []).requests.map((r) => r.text)).toEqual(["Mine"]);
    const cleared = after(review, (q) => dequeue(q, 0)).review;
    expect(commentsOn(cleared, PATH).map((c) => [c.text, c.status])).toEqual([
      ["Theirs", "sent"],
      ["Mine, sent", "sent"],
    ]);
  });
});
