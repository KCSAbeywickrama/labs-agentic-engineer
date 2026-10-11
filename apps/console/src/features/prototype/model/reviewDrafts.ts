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

import type { DesignReview, ReviewAnchor, ReviewComment } from "@aep/agent-stream";
import type { FeedbackQueue, PlacedRequest, QueuedComment } from "@wso2/prototype-kit/feedback";
import type { FramePoint } from "@wso2/prototype-kit/host";
import { addDraft, commentsOn, deleteDraft, editDraft, type NewDraft } from "../../design/model/review";

// The full-screen review's comment queue IS the prototype's drafts in the
// room's review.json (L3, L24): a comment queued in the review is written as
// a Pending draft on the prototype artifact (keyed by its manifest), with the
// screen, flow, role, state and elements it was made on, so it shows in the
// prototype's 💬 panel and on the Comments item, and goes to the agent only
// with Address comments on the Overview. Edited or removed in the review, the
// draft is edited or deleted. The queue holds the reviewer's own drafts; a
// teammate's show in the 💬 panel, and are theirs to change.
//
// The kit's queue functions (enqueue, editRequest, keepOnScreen, dequeue)
// keep each request's other fields, so a request made from a draft carries
// the draft's id through them: a request without one is new. What the file
// does not hold, the revision a comment was written on and the spot a
// whole-screen comment was made at, this browser remembers for the comments
// it wrote (`Placed`); a draft from elsewhere is on the revision showing, with
// no spot.

/** A queued comment, and the draft in review.json it is (none until it is written). */
export interface DraftRequest extends QueuedComment {
  commentId?: string;
}

/** What this browser knows of a draft it wrote, by the draft's id. */
export type Placed = Readonly<Record<string, { revision: string; at?: FramePoint }>>;

export function anchorOf(request: PlacedRequest): ReviewAnchor {
  return {
    screenId: request.screenId,
    ...(request.flowId !== undefined ? { flowId: request.flowId } : {}),
    roleId: request.roleId,
    stateId: request.stateId,
    elementIds: [...request.elementIds],
  };
}

function sameAnchor(a: ReviewAnchor | undefined, b: ReviewAnchor): boolean {
  return (
    a !== undefined &&
    a.screenId === b.screenId &&
    a.flowId === b.flowId &&
    a.roleId === b.roleId &&
    a.stateId === b.stateId &&
    a.elementIds.length === b.elementIds.length &&
    a.elementIds.every((id, i) => id === b.elementIds[i])
  );
}

/** The prototype's drafts by `authorId` that carry a place on it, in the file's order. */
function placedDrafts(review: DesignReview, path: string, authorId: string): (ReviewComment & { anchor: ReviewAnchor })[] {
  return commentsOn(review, path).filter(
    (c): c is ReviewComment & { anchor: ReviewAnchor } => c.status === "draft" && c.anchor !== undefined && c.author.id === authorId,
  );
}

/**
 * The review's queue: the reviewer's drafts on the prototype as the kit's
 * requests, each on the revision it was written on (`placed`; the one
 * showing, `hash`, otherwise), with the comments they started and did not add.
 */
export function queueOf(
  review: DesignReview,
  path: string,
  authorId: string,
  hash: string,
  placed: Placed,
  drafts: readonly PlacedRequest[],
): FeedbackQueue {
  const requests: DraftRequest[] = placedDrafts(review, path, authorId).map((c) => {
    const known = placed[c.id];
    const at = c.anchor.elementIds.length === 0 ? known?.at : undefined;
    return { ...c.anchor, text: c.text, revision: known?.revision ?? hash, commentId: c.id, ...(at ? { at } : {}) };
  });
  return { hash: requests.length > 0 ? hash : null, requests, drafts };
}

/**
 * The review once the queue went from `before` to `after`: a request without
 * a draft is a new draft (made by `draft`), a changed one edits its draft, and
 * a draft `before` held and `after` does not is deleted. Also returns what it
 * knows of the drafts it made.
 */
export function withQueue(
  review: DesignReview,
  path: string,
  before: readonly DraftRequest[],
  after: readonly DraftRequest[],
  draft: (text: string, anchor: ReviewAnchor) => NewDraft,
): { review: DesignReview; made: Record<string, { revision: string; at?: FramePoint }> } {
  const kept = new Set(after.flatMap((r) => (r.commentId ? [r.commentId] : [])));
  let next = review;
  for (const r of before) if (r.commentId && !kept.has(r.commentId)) next = deleteDraft(next, r.commentId);
  const made: Record<string, { revision: string; at?: FramePoint }> = {};
  for (const r of after) {
    const anchor = anchorOf(r);
    if (!r.commentId) {
      const d = draft(r.text, anchor);
      next = addDraft(next, path, d);
      made[d.id] = { revision: r.revision, ...(r.at ? { at: r.at } : {}) };
      continue;
    }
    const was = commentsOn(next, path).find((c) => c.id === r.commentId && c.status === "draft");
    if (was && (was.text !== r.text || !sameAnchor(was.anchor, anchor))) next = editDraft(next, r.commentId, { text: r.text, anchor });
  }
  return { review: next, made };
}
