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

// Collab question cards spike (2026-07-23): the shared `questions` map on the
// project's Yjs room — how agent questions surface on the MAIN spec panel for
// every participant to see and co-author. Written by useRoomQuestion (which
// mirrors this client's chat log into the doc) and by the form's answer/skip
// actions; observed by the form for live updates.

import type { Doc, Map as YMap } from "yjs";
import type { AskQuestionInput, QuestionAnswer } from "@aep/agent-stream";

const QUESTIONS_MAP = "questions" as const;

/** One collaboratively-answered question card, stored as a plain value in the
 *  Yjs `questions` map (keyed by toolCallId). Last-write-wins per entry — the
 *  co-edited draft `answers` is adequate for the spike. */
export interface RoomQuestion {
  toolCallId: string;
  questions: AskQuestionInput[];
  /** Local user id of the turn-owner who mirrored it — only they can submit. */
  ownerId: string;
  /** The shared draft answer, co-edited by the room; null until first touched. */
  answers: QuestionAnswer[] | null;
  /** Set once the asker submits or skips — the form closes for the whole room. */
  submitted?: boolean;
  /**
   * True while the batch is still streaming (#270 latency): `questions` is the
   * prefix parsed so far and grows on re-mirror; the form renders and takes
   * selections but submit stays gated until the final mirror clears this.
   */
  streaming?: boolean;
  /**
   * Epoch ms of the first mirror. Gates ORPHAN closing (an entry with no
   * backing log message): another tab or device of the same user legitimately
   * lacks the asker's log, so an orphan may only close once it is old enough
   * that nobody is coming back for it. Absent on pre-stamp entries — treated
   * as ancient (closable), which is exactly the legacy-zombie case.
   */
  askedAt?: number;
}

// --- Shared `questions` map helpers ----------------------------------------

function questionsMap(doc: Doc): YMap<RoomQuestion> {
  return doc.getMap<RoomQuestion>(QUESTIONS_MAP);
}

/**
 * Mirror a parsed question into the room's shared map (idempotent by
 * toolCallId — a re-fold overwrites the same key, preserving any co-edited
 * answers already present). Ownership is FIRST-writer-wins: a re-mirror (a
 * replay, or another tab's back-fill from a shared chat log) must never
 * reassign `ownerId`, or a teammate could steal the submit right.
 */
export function mirrorQuestion(
  doc: Doc,
  entry: { toolCallId: string; questions: AskQuestionInput[]; ownerId: string; streaming?: boolean },
): void {
  const map = questionsMap(doc);
  const existing = map.get(entry.toolCallId);
  map.set(entry.toolCallId, {
    toolCallId: entry.toolCallId,
    questions: entry.questions,
    // A re-mirror flips streaming off by OMITTING it — never resurrect the
    // gate from a stale entry, and never leak `streaming: false` into the doc.
    ...(entry.streaming ? { streaming: true } : {}),
    ownerId: existing?.ownerId ?? entry.ownerId,
    answers: existing?.answers ?? null,
    ...(existing?.submitted ? { submitted: true } : {}),
    askedAt: existing?.askedAt ?? Date.now(),
  });
}

/** Write the co-edited draft answer for a card (any participant). */
export function setRoomAnswer(doc: Doc, toolCallId: string, answers: QuestionAnswer[] | null): void {
  const map = questionsMap(doc);
  const existing = map.get(toolCallId);
  if (!existing) return;
  map.set(toolCallId, { ...existing, answers });
}

/**
 * Close a question for the WHOLE room — used both when the asker submits the
 * answers and when they skip the questions. The form disappears for everyone
 * and the spec body returns to the files.
 */
export function closeRoomQuestion(doc: Doc, toolCallId: string): void {
  const map = questionsMap(doc);
  const existing = map.get(toolCallId);
  if (!existing) return;
  map.set(toolCallId, { ...existing, submitted: true });
}

/** How long an unbacked ("orphan") entry may live before it is closable. */
export const ORPHAN_QUESTION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Close (for the whole room) THIS owner's entries their chat log no longer
 * backs. Two classes, deliberately different rules:
 *
 * - SUPERSEDED (the log HAS the message, but a later delivered user message —
 *   e.g. a composer reply, an equally valid answer path per ADR-0012 — made it
 *   unanswerable): close immediately. The log in hand is proof.
 * - ORPHAN (no log message at all): close only past ORPHAN_QUESTION_TTL_MS
 *   (unstamped legacy entries count as ancient). Another tab with a stale
 *   in-memory log, or another device of the same user, legitimately lacks the
 *   asker's log — an aggressive orphan rule would close LIVE questions across
 *   tabs. The TTL keeps a persistent collab room from resurrecting zombie
 *   forms forever without racing living sessions.
 *
 * Only the owner closes their own entries — a teammate's log simply lacks the
 * message, which must never read as "stale".
 */
export function closeStaleRoomQuestions(
  doc: Doc,
  ownerId: string,
  supersededToolCallIds: ReadonlySet<string>,
  knownToolCallIds: ReadonlySet<string>,
  now: number = Date.now(),
): void {
  for (const entry of readRoomQuestions(doc)) {
    if (entry.submitted || entry.ownerId !== ownerId) continue;
    const superseded = supersededToolCallIds.has(entry.toolCallId);
    const orphanExpired =
      !knownToolCallIds.has(entry.toolCallId) &&
      (entry.askedAt === undefined || now - entry.askedAt > ORPHAN_QUESTION_TTL_MS);
    if (superseded || orphanExpired) closeRoomQuestion(doc, entry.toolCallId);
  }
}

/** Snapshot the room's questions in insertion order. */
export function readRoomQuestions(doc: Doc): RoomQuestion[] {
  return [...questionsMap(doc).values()];
}

/** Observe the room's questions map; returns an unsubscribe. */
export function observeRoomQuestions(doc: Doc, fn: () => void): () => void {
  const map = questionsMap(doc);
  map.observe(fn);
  return () => map.unobserve(fn);
}
