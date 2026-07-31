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
import { Doc } from "yjs";
import {
  ORPHAN_QUESTION_TTL_MS,
  closeStaleRoomQuestions,
  mirrorQuestion,
  readRoomQuestions,
  updateRoomAnswer,
} from "./questionRoom";
import { applySelection } from "./questionCards";

const Q = { question: "Which auth flow?", options: [{ label: "OIDC" }] };

function entryOf(doc: Doc, toolCallId: string) {
  return readRoomQuestions(doc).find((e) => e.toolCallId === toolCallId);
}

describe("closeStaleRoomQuestions", () => {
  it("closes this owner's entry once its question is no longer answerable (composer answer)", () => {
    const doc = new Doc();
    mirrorQuestion(doc, { toolCallId: "tc-1", questions: [Q], ownerId: "me" });
    expect(entryOf(doc, "tc-1")?.submitted).toBeUndefined();

    closeStaleRoomQuestions(doc, "me", new Set(["tc-1"]), new Set(["tc-1"]));
    expect(entryOf(doc, "tc-1")?.submitted).toBe(true);
  });

  it("orphans (no backing log message) close only past the TTL — never a live cross-tab question", () => {
    const doc = new Doc();
    mirrorQuestion(doc, { toolCallId: "tc-fresh", questions: [Q], ownerId: "me" });
    // Another tab whose log lacks the message must NOT close a fresh entry…
    closeStaleRoomQuestions(doc, "me", new Set(), new Set(["tc-other"]));
    expect(entryOf(doc, "tc-fresh")?.submitted).toBeUndefined();
    // …but once the entry is older than the TTL it is a zombie and closes.
    const askedAt = entryOf(doc, "tc-fresh")!.askedAt!;
    closeStaleRoomQuestions(doc, "me", new Set(), new Set(), askedAt + ORPHAN_QUESTION_TTL_MS + 1);
    expect(entryOf(doc, "tc-fresh")?.submitted).toBe(true);
  });

  it("treats an unstamped legacy entry as an ancient zombie", () => {
    const doc = new Doc();
    doc.getMap("questions").set("tc-legacy", {
      toolCallId: "tc-legacy", questions: [Q], ownerId: "me", answers: null,
    });
    closeStaleRoomQuestions(doc, "me", new Set(), new Set());
    expect(entryOf(doc, "tc-legacy")?.submitted).toBe(true);
  });

  it("never closes another owner's entry (their log is authoritative, not mine)", () => {
    const doc = new Doc();
    mirrorQuestion(doc, { toolCallId: "tc-2", questions: [Q], ownerId: "teammate" });
    closeStaleRoomQuestions(doc, "me", new Set(["tc-2"]), new Set());
    expect(entryOf(doc, "tc-2")?.submitted).toBeUndefined();
  });

  it("leaves live and already-submitted entries alone", () => {
    const doc = new Doc();
    mirrorQuestion(doc, { toolCallId: "tc-3", questions: [Q], ownerId: "me" });
    closeStaleRoomQuestions(doc, "me", new Set(), new Set(["tc-3"]));
    expect(entryOf(doc, "tc-3")?.submitted).toBeUndefined();

    closeStaleRoomQuestions(doc, "me", new Set(["tc-3"]), new Set(["tc-3"]));
    const after = entryOf(doc, "tc-3");
    expect(after?.submitted).toBe(true);
    // Idempotent: a second pass keeps answers/ownership intact.
    closeStaleRoomQuestions(doc, "me", new Set(["tc-3"]), new Set(["tc-3"]));
    expect(entryOf(doc, "tc-3")).toEqual(after);
  });
});

describe("updateRoomAnswer (live-state edits)", () => {
  const QS = [
    { question: "q0", options: [{ label: "A" }, { label: "B" }] },
    { question: "q1", options: [{ label: "A" }, { label: "B" }] },
  ];

  it("two edits between renders both survive (no stale-snapshot clobber)", () => {
    const doc = new Doc();
    mirrorQuestion(doc, { toolCallId: "tc", questions: QS, ownerId: "me" });
    // Both calls run before any re-render — each must see the other's write.
    updateRoomAnswer(doc, "tc", (live) => applySelection(live.questions, live.answers, 0, "A"));
    updateRoomAnswer(doc, "tc", (live) => applySelection(live.questions, live.answers, 1, "B"));
    const answers = readRoomQuestions(doc)[0]!.answers!;
    expect(answers[0]!.selected).toEqual(["A"]);
    expect(answers[1]!.selected).toEqual(["B"]);
  });

  it("aligns to the LIVE question count when the batch grew since render", () => {
    const doc = new Doc();
    mirrorQuestion(doc, { toolCallId: "tc", questions: QS, ownerId: "me" });
    updateRoomAnswer(doc, "tc", (live) => applySelection(live.questions, live.answers, 0, "A"));
    // The batch streams two more questions in…
    const grown = [...QS, { question: "q2", options: [{ label: "A" }] }, { question: "q3", options: [{ label: "A" }] }];
    mirrorQuestion(doc, { toolCallId: "tc", questions: grown, ownerId: "me" });
    // …and a late question is still editable.
    updateRoomAnswer(doc, "tc", (live) => applySelection(live.questions, live.answers, 3, "A"));
    const answers = readRoomQuestions(doc)[0]!.answers!;
    expect(answers).toHaveLength(4);
    expect(answers[3]!.selected).toEqual(["A"]);
    expect(answers[0]!.selected).toEqual(["A"]);
  });

  it("is a no-op for an unknown card", () => {
    const doc = new Doc();
    updateRoomAnswer(doc, "missing", () => [{ selected: ["X"] }]);
    expect(readRoomQuestions(doc)).toEqual([]);
  });
});
