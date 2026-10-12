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
 * The project's design review file, `specs/design/review.json`, as the
 * playground writes it: the console's two writes that happen without the
 * agent. A prototype review saved in the preview becomes draft comments on the
 * prototype (the console's queue is its drafts the same way), and Address
 * comments marks every waiting comment sent before its turn. The agent's own
 * writes (replies, questions) go through the turn, as in the pod.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  checkDesignReview,
  DESIGN_REVIEW_PATH,
  type DesignReview,
  type ReviewAnchor,
  type ReviewComment,
  type ReviewedArtifact,
} from "@aep/agent-stream";
import type { FeedbackRequest } from "@wso2/prototype-kit/feedback";

/** Who the playground's review comments are by: one person reviews locally. */
export const PLAYGROUND_REVIEWER = { id: "playground", name: "Reviewer" } as const;

const EMPTY: DesignReview = { version: 1, artifacts: [] };

export type ReadReview = { ok: true; review: DesignReview } | { ok: false; reason: string };

/** The review file of `projectDir`: a missing file is an empty review, an invalid one is refused, never written over. */
export function readReviewFile(projectDir: string): ReadReview {
  const file = join(projectDir, DESIGN_REVIEW_PATH);
  if (!existsSync(file)) return { ok: true, review: EMPTY };
  const text = readFileSync(file, "utf8");
  if (text.trim() === "") return { ok: true, review: EMPTY };
  const problem = checkDesignReview(DESIGN_REVIEW_PATH, text);
  if (problem) return { ok: false, reason: problem.message };
  return { ok: true, review: JSON.parse(text) as DesignReview };
}

/** Write the review as the console does (two-space JSON, final newline); returns the text written. */
export function writeReviewFile(projectDir: string, review: DesignReview): string {
  const text = `${JSON.stringify(review, null, 2)}\n`;
  const problem = checkDesignReview(DESIGN_REVIEW_PATH, text);
  if (problem) throw new Error(`refusing to write an invalid ${DESIGN_REVIEW_PATH}: ${problem.message}`);
  const file = join(projectDir, DESIGN_REVIEW_PATH);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
  return text;
}

/** An entry with nothing in it is dropped, so the file holds only what someone did. */
function tidy(entry: ReviewedArtifact): ReviewedArtifact[] {
  const comments = entry.comments?.length ? entry.comments : undefined;
  if (entry.checkedHash === undefined && comments === undefined) return [];
  return [{ path: entry.path, ...(entry.checkedHash !== undefined ? { checkedHash: entry.checkedHash } : {}), ...(comments ? { comments } : {}) }];
}

function anchorOf(request: FeedbackRequest): ReviewAnchor {
  return {
    screenId: request.screenId,
    ...(request.flowId !== undefined ? { flowId: request.flowId } : {}),
    roleId: request.roleId,
    stateId: request.stateId,
    elementIds: [...request.elementIds],
  };
}

export interface SavedDrafts {
  review: DesignReview;
  /** The drafts this save made, by id: the next save of the same session replaces them. */
  ids: string[];
}

/**
 * `path`'s drafts once a preview session saved `requests`. A save holds the
 * session's whole queue, so the drafts the session saved before (`previous`)
 * are replaced; every other comment stays as it is.
 */
export function withSavedDrafts(
  review: DesignReview,
  path: string,
  previous: readonly string[],
  requests: readonly FeedbackRequest[],
  now: string,
  newId: () => string = randomUUID,
): SavedDrafts {
  const replaced = new Set(previous);
  const drafts: ReviewComment[] = requests.map((r) => ({
    id: newId(),
    author: { ...PLAYGROUND_REVIEWER },
    text: r.text,
    createdAt: now,
    status: "draft",
    anchor: anchorOf(r),
  }));
  const found = review.artifacts.some((a) => a.path === path);
  const entries = found ? review.artifacts : [...review.artifacts, { path }];
  const artifacts = entries.flatMap((a) => {
    const kept = (a.comments ?? []).filter((c) => !(replaced.has(c.id) && c.status === "draft"));
    return tidy(a.path === path ? { ...a, comments: [...kept, ...drafts] } : { ...a, comments: kept });
  });
  return { review: { version: 1, artifacts }, ids: drafts.map((d) => d.id) };
}

/** What a send changed: each comment sent and the status it had, to put back if the turn does not run. */
export interface SentComments {
  review: DesignReview;
  sent: { id: string; was: ReviewComment["status"] }[];
}

/** Every waiting comment (a draft, or one reopened) marked sent at `at`, as the console's Address comments does. */
export function sendWaiting(review: DesignReview, at: string): SentComments {
  const sent: SentComments["sent"] = [];
  const artifacts = review.artifacts.map((a) => {
    if (!a.comments) return a;
    const comments = a.comments.map((c): ReviewComment => {
      if (c.status !== "draft" && c.status !== "reopened") return c;
      sent.push({ id: c.id, was: c.status });
      return { ...c, status: "sent", sentAt: at };
    });
    return { ...a, comments };
  });
  return { review: { version: 1, artifacts }, sent };
}

/** The comments a send marked, back as they were. */
export function unsend(review: DesignReview, sent: SentComments["sent"]): DesignReview {
  const was = new Map(sent.map((s) => [s.id, s.was]));
  const artifacts = review.artifacts.map((a) => {
    if (!a.comments) return a;
    const comments = a.comments.map((c): ReviewComment => {
      const status = was.get(c.id);
      if (status === undefined || c.status !== "sent") return c;
      const back: ReviewComment = { ...c, status };
      delete back.sentAt;
      return back;
    });
    return { ...a, comments };
  });
  return { version: 1, artifacts };
}
