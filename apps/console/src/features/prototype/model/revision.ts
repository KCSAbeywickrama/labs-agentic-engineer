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

import type { PlacedRequest } from "@wso2/prototype-kit/feedback";
import type { AppPrototype, PrototypeFiles } from "./prototypes";
import type { Placed } from "./reviewDrafts";

// A prototype's review across a revision, kept beside the review rather than
// in it, since the review closes and opens again while the agent works:
//
//   revising  the review keeps showing the revision it had, never the files
//             the agent is still writing;
//   landed    the run ended and the prototype is ready: the review swaps the
//             new revision in and says so (a run that left it as it was, or
//             made the first one, has nothing to say);
//   failed    what the run left is invalid: the last good revision keeps
//             showing, with the reason.
//
// The comments themselves are not here: a queued comment is a draft on the
// prototype in the room's review.json (./reviewDrafts.ts), sent with Address
// comments on the Design card's Overview. Here are only the comments the
// reviewer started and closed without adding (the kit's drafts), which never
// leave the browser.

/** What a revision's end leaves the review to say; null once it is seen. */
export type RevisionNotice = { kind: "updated" } | { kind: "failed"; reason: string } | null;

export interface ReviewSession {
  /** Comments started on some elements and closed without adding, kept so selecting them again restores them. */
  drafts: readonly PlacedRequest[];
  /** What the file does not hold of the drafts queued here: the revision each was written on, and a whole-screen one's spot. */
  placed: Placed;
  notice: RevisionNotice;
  /** The revision the review shows: the last ready one, kept while the agent revises it and when its revision is invalid. */
  shown: PrototypeFiles | null;
  revising: boolean;
}

export const NEW_SESSION: ReviewSession = { drafts: [], placed: {}, notice: null, shown: null, revising: false };

/** The session following the prototype as the room and the chat now have it (the same session when nothing changed). */
export function follow(s: ReviewSession, prototype: AppPrototype): ReviewSession {
  const revising = prototype.status === "revising";
  if (revising) {
    // Seen first mid-run, the files as they are then are the best there is.
    return s.revising ? s : { ...s, revising, shown: s.shown ?? prototype.files };
  }
  const shown = prototype.status === "ready" ? prototype.files : prototype.status === "invalid" ? s.shown : null;
  if (!s.revising) return shown === s.shown ? s : { ...s, shown };
  // The run is over: a new revision landed, what it left can't be shown, or it left the prototype as it was (or made the first one).
  const notice: RevisionNotice =
    prototype.status === "invalid"
      ? { kind: "failed", reason: `The updated prototype can't be shown (${prototype.problem ?? "it is invalid"}), so you're still seeing the previous version.` }
      : s.shown && shown && !sameFiles(s.shown, shown)
        ? { kind: "updated" }
        : s.notice;
  return { ...s, revising, shown, notice };
}

function sameFiles(a: PrototypeFiles, b: PrototypeFiles): boolean {
  return a.manifestText === b.manifestText && a.source === b.source;
}
