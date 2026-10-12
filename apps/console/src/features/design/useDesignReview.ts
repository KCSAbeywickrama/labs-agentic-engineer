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

import { useCallback, useMemo, useState } from "react";
import type * as Y from "yjs";
import { checkDesignReview, DESIGN_REVIEW_PATH, type DesignReview, type ReviewAnchor, type ReviewAuthor } from "@aep/agent-stream";
import { readDocFile, setDocFile } from "@aep/collab-doc";
import { useSession } from "../../auth/SessionContext";
import { useSpecDoc } from "../spec/collab/specDoc";
import { useRoomFiles } from "../spec/collab/useRoomFiles";
import {
  addDraft,
  deleteDraft,
  editDraft,
  readReview,
  reopen,
  reviewText,
  sendWaiting,
  setChecked,
  unsend,
  type NewDraft,
  type Sent,
} from "./model/review";

// The design review, read live from the room's specs/design/review.json and
// written back through it (model/review.ts holds what each change does). Every
// write is the whole file, checked against the contract first: a review the
// save gate would refuse is never written, and a file that cannot be read is
// never written over. The room commits it with the rest of the spec, and
// flushes it before every turn, so the agent reads what the card shows.

const REVIEW_FILE = [DESIGN_REVIEW_PATH] as const;

/** The user's edits, as the room's other user edits are marked (spec/collab/specEdits.ts). */
const USER_ORIGIN = "console:user";

/**
 * Write `next` over the review the doc holds now, if it is valid; the problem
 * otherwise. Read at the moment of writing, so a change made meanwhile by the
 * agent or a teammate is not lost: `change` runs on the current file.
 */
function writeReview(doc: Y.Doc, change: (review: DesignReview) => DesignReview): string | null {
  const current = readReview(readDocFile(doc, DESIGN_REVIEW_PATH));
  if (current.problem) return `The review can't be saved: ${current.problem}`;
  const text = reviewText(change(current.review));
  const problem = checkDesignReview(DESIGN_REVIEW_PATH, text);
  if (problem) return `The review can't be saved: ${problem.message}`;
  if (text !== readDocFile(doc, DESIGN_REVIEW_PATH)) setDocFile(doc, DESIGN_REVIEW_PATH, text, USER_ORIGIN);
  return null;
}

export interface DesignReviewActions {
  review: DesignReview;
  /** Who the signed-in user writes comments as. */
  me: ReviewAuthor;
  /** Why the file can't be read or the last change couldn't be saved; null when all is well. */
  problem: string | null;
  /** Whether the room is there to write to. */
  ready: boolean;
  check: (path: string, hash: string | null) => void;
  /** Add a draft; resolves to its id, or null when it could not be written. */
  comment: (path: string, text: string, anchor?: ReviewAnchor) => string | null;
  editDraft: (id: string, change: { text?: string; anchor?: ReviewAnchor }) => void;
  deleteDraft: (id: string) => void;
  reopen: (id: string) => void;
  /** Mark every waiting comment sent; what was sent, or null when nothing could be written. */
  sendWaiting: () => Sent["sent"] | null;
  /** Put comments a send marked back as they were. */
  unsend: (sent: Sent["sent"]) => void;
  /** Any change to the review in one write; `draft` makes a new draft by this user. */
  change: (fn: (review: DesignReview, draft: (text: string, anchor?: ReviewAnchor) => NewDraft) => DesignReview) => void;
}

/** The project's design review, and the user's moves on it. */
export function useDesignReview(projectName: string): DesignReviewActions {
  const doc = useSpecDoc(projectName);
  const text = useRoomFiles(doc, REVIEW_FILE)[DESIGN_REVIEW_PATH];
  const read = useMemo(() => readReview(text), [text]);
  const { user } = useSession();
  const [failure, setFailure] = useState<string | null>(null);

  const write = useCallback(
    (change: (review: DesignReview) => DesignReview): boolean => {
      if (!doc) return false;
      const problem = writeReview(doc, change);
      setFailure(problem);
      return problem === null;
    },
    [doc],
  );

  return useMemo((): DesignReviewActions => {
    // The token's sub, or the name when a token carries none: a comment always names who wrote it.
    const author = { id: user.id || user.email || user.name, name: user.name || user.email || "You" };
    const draft = (body: string, anchor?: ReviewAnchor): NewDraft => ({
      id: crypto.randomUUID(),
      author,
      text: body,
      createdAt: new Date().toISOString(),
      ...(anchor ? { anchor } : {}),
    });
    return {
      review: read.review,
      me: author,
      problem: read.problem ?? failure,
      ready: doc !== null,
      check: (path, hash) => void write((r) => setChecked(r, path, hash)),
      comment: (path, body, anchor) => {
        const made = draft(body, anchor);
        return write((r) => addDraft(r, path, made)) ? made.id : null;
      },
      editDraft: (id, change) => void write((r) => editDraft(r, id, change)),
      deleteDraft: (id) => void write((r) => deleteDraft(r, id)),
      reopen: (id) => void write((r) => reopen(r, id)),
      sendWaiting: () => {
        let sent: Sent["sent"] = [];
        const at = new Date().toISOString();
        const ok = write((r) => {
          const out = sendWaiting(r, at);
          sent = out.sent;
          return out.review;
        });
        return ok ? sent : null;
      },
      unsend: (sent) => void write((r) => unsend(r, sent)),
      change: (fn) => void write((r) => fn(r, draft)),
    };
  }, [read, failure, doc, write, user.id, user.email, user.name]);
}
