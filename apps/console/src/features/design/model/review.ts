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

import {
  checkDesignReview,
  DESIGN_REVIEW_PATH,
  type DesignReview,
  type ReviewAnchor,
  type ReviewAuthor,
  type ReviewComment,
  type ReviewedArtifact,
} from "@aep/agent-stream";

// The design review as `specs/design/review.json` holds it (the contract is
// @aep/agent-stream's DesignReview): per artifact path, the user's comments
// and the hash the artifact had when they ticked it Checked. The Design card
// reads it live from the room and writes it back whole; everything it does to
// the file is a pure function here, so each is one write of the whole file.
//
// A comment WAITS while it is a draft or reopened: Address comments sends
// every waiting one (`sent`), and the agent marks each `addressed` with a
// reply. Only drafts are edited or deleted; only an addressed one reopens.

export const EMPTY_REVIEW: DesignReview = Object.freeze({ version: 1, artifacts: [] }) as DesignReview;

/** The review the file holds, or why it cannot be read (then nothing is written over it). */
export type ReadReview = { review: DesignReview; problem: null } | { review: DesignReview; problem: string };

/** The last text read, and what it read as: the card and every write read the same text again and again. */
let lastRead: { text: string; read: ReadReview } | null = null;

/** Read review.json's text; a missing file is an empty review, an invalid one says why. */
export function readReview(text: string | undefined): ReadReview {
  if (text === undefined || text.trim() === "") return { review: EMPTY_REVIEW, problem: null };
  if (lastRead?.text === text) return lastRead.read;
  const problem = checkDesignReview(DESIGN_REVIEW_PATH, text);
  const read: ReadReview = problem ? { review: EMPTY_REVIEW, problem: problem.message } : { review: JSON.parse(text) as DesignReview, problem: null };
  lastRead = { text, read };
  return read;
}

/** The file's text for a review, as it is written: two-space JSON and a final newline. */
export function reviewText(review: DesignReview): string {
  return `${JSON.stringify(review, null, 2)}\n`;
}

/** Whether a comment waits for the next Address comments. */
export function isWaiting(comment: Pick<ReviewComment, "status">): boolean {
  return comment.status === "draft" || comment.status === "reopened";
}

export function commentsOn(review: DesignReview, path: string): ReviewComment[] {
  return review.artifacts.find((a) => a.path === path)?.comments ?? [];
}

/** Every comment waiting to be sent, across the review. */
export function waitingComments(review: DesignReview): ReviewComment[] {
  return review.artifacts.flatMap((a) => (a.comments ?? []).filter(isWaiting));
}

/** Whether `path` is ticked Checked for the artifact as it is now (`hash`): a changed artifact is not. */
export function isChecked(review: DesignReview, path: string, hash: string | undefined): boolean {
  const checked = review.artifacts.find((a) => a.path === path)?.checkedHash;
  return checked !== undefined && hash !== undefined && checked === hash;
}

/** Ticked once, and the artifact changed since. */
export function changedSinceChecked(review: DesignReview, path: string, hash: string | undefined): boolean {
  const checked = review.artifacts.find((a) => a.path === path)?.checkedHash;
  return checked !== undefined && hash !== undefined && checked !== hash;
}

/** An entry with nothing in it is dropped, so the file holds only what someone did. */
function tidy(entry: ReviewedArtifact): ReviewedArtifact | null {
  const comments = entry.comments?.length ? entry.comments : undefined;
  if (entry.checkedHash === undefined && comments === undefined) return null;
  return { path: entry.path, ...(entry.checkedHash !== undefined ? { checkedHash: entry.checkedHash } : {}), ...(comments ? { comments } : {}) };
}

/** The review with `path`'s entry changed by `fn` (made when missing). */
function onArtifact(review: DesignReview, path: string, fn: (entry: ReviewedArtifact) => ReviewedArtifact): DesignReview {
  const found = review.artifacts.some((a) => a.path === path);
  const entries = found ? review.artifacts : [...review.artifacts, { path }];
  const artifacts = entries.flatMap((a) => (a.path === path ? (tidy(fn(a)) ?? []) : [a]));
  return { version: 1, artifacts };
}

/** The review with every comment passed through `fn` (one returning null deletes it). */
function onComments(review: DesignReview, fn: (comment: ReviewComment) => ReviewComment | null): DesignReview {
  const artifacts = review.artifacts.flatMap((a) => {
    if (!a.comments) return [a];
    const comments = a.comments.flatMap((c) => fn(c) ?? []);
    return tidy({ ...a, comments }) ?? [];
  });
  return { version: 1, artifacts };
}

/** Tick `path` Checked at its current hash, or untick it (null). */
export function setChecked(review: DesignReview, path: string, hash: string | null): DesignReview {
  return onArtifact(review, path, (entry) => ({
    path: entry.path,
    ...(hash !== null ? { checkedHash: hash } : {}),
    ...(entry.comments ? { comments: entry.comments } : {}),
  }));
}

export interface NewDraft {
  id: string;
  author: ReviewAuthor;
  text: string;
  createdAt: string;
  /** Prototype comments only: where on the prototype it was made. */
  anchor?: ReviewAnchor;
}

/** A new draft on `path`, after its other comments. */
export function addDraft(review: DesignReview, path: string, draft: NewDraft): DesignReview {
  const comment: ReviewComment = {
    id: draft.id,
    author: draft.author,
    text: draft.text,
    createdAt: draft.createdAt,
    status: "draft",
    ...(draft.anchor ? { anchor: draft.anchor } : {}),
  };
  return onArtifact(review, path, (entry) => ({ ...entry, comments: [...(entry.comments ?? []), comment] }));
}

/** A draft's new words (and, for a prototype comment, where it is); anything but a draft is left as it is. */
export function editDraft(review: DesignReview, id: string, change: { text?: string; anchor?: ReviewAnchor }): DesignReview {
  return onComments(review, (c) => (c.id === id && c.status === "draft" ? { ...c, ...change } : c));
}

/** The review without draft `id`; a sent comment is never deleted. */
export function deleteDraft(review: DesignReview, id: string): DesignReview {
  return onComments(review, (c) => (c.id === id && c.status === "draft" ? null : c));
}

/** An addressed comment back in the next batch. */
export function reopen(review: DesignReview, id: string): DesignReview {
  return onComments(review, (c) => (c.id === id && c.status === "addressed" ? { ...c, status: "reopened" } : c));
}

/** What a send changed: each comment sent, and the status it had, to put back if the turn does not start. */
export interface Sent {
  review: DesignReview;
  sent: { id: string; was: ReviewComment["status"] }[];
}

/** Every waiting comment marked sent at `at` (ISO 8601). */
export function sendWaiting(review: DesignReview, at: string): Sent {
  const sent: Sent["sent"] = [];
  const next = onComments(review, (c) => {
    if (!isWaiting(c)) return c;
    sent.push({ id: c.id, was: c.status });
    return { ...c, status: "sent", sentAt: at };
  });
  return { review: next, sent };
}

/** The comments a send marked, back as they were (the turn never started). */
export function unsend(review: DesignReview, sent: Sent["sent"]): DesignReview {
  return onComments(review, (c) => {
    const was = sent.find((s) => s.id === c.id);
    if (!was || c.status !== "sent") return c;
    const back: ReviewComment = { ...c, status: was.was };
    delete back.sentAt;
    return back;
  });
}

/** The one primary action on the Design card, first match wins. */
export type Primary =
  | { kind: "address"; count: number }
  | { kind: "build" }
  | { kind: "open"; key: string }
  | null;

/**
 * The card's one primary: Address comments while any comment waits, then
 * Build once every checkable file is checked, otherwise Open on the first
 * unchecked row (`rows`, in the Overview's order). Null while nothing is
 * listed.
 */
export function primaryAction(input: { waiting: number; rows: readonly { key: string; checked: boolean }[] }): Primary {
  if (input.waiting > 0) return { kind: "address", count: input.waiting };
  if (input.rows.length === 0) return null;
  const first = input.rows.find((r) => !r.checked);
  return first ? { kind: "open", key: first.key } : { kind: "build" };
}
