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

// Collab question cards spike (2026-07-23): bridge + shared state for rendering
// agent question cards on the MAIN spec panel via the project's Yjs room, so all
// participants see and co-author them.
//
// The chat fold (runTurn.ts) receives the SSE ask_question tool-call, but the
// live Y.Doc is owned solely by SpecView (useCollabSpec) — a sibling subtree
// with no shared React reference. This module singleton is the bridge: SpecView
// publishes the live doc while it is mounted; the fold reads it to mirror a
// question into the shared `questions` map. Mirrors the existing chatStore
// module-store pattern. Null while the spec route isn't mounted (mirror no-ops).

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
}

// --- Doc bridge (SpecView publishes → the chat fold reads) ------------------

let liveDoc: Doc | null = null;
const listeners = new Set<() => void>();

/** SpecView publishes the live room doc on mount, and `null` on unmount. */
export function setQuestionDoc(doc: Doc | null): void {
  if (liveDoc === doc) return;
  liveDoc = doc;
  for (const fn of listeners) fn();
}

/** The live room doc, or null when the spec route isn't mounted. */
export function getQuestionDoc(): Doc | null {
  return liveDoc;
}

export function subscribeQuestionDoc(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
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
  entry: { toolCallId: string; questions: AskQuestionInput[]; ownerId: string },
): void {
  const map = questionsMap(doc);
  const existing = map.get(entry.toolCallId);
  map.set(entry.toolCallId, {
    ...entry,
    ownerId: existing?.ownerId ?? entry.ownerId,
    answers: existing?.answers ?? null,
    ...(existing?.submitted ? { submitted: true } : {}),
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
