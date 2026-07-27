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

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AskQuestionOption, StreamPart } from "@aep/agent-stream";
import { pendingQuestions } from "../src/engine/questions.js";
import { parseSelection } from "../src/tui/questions.js";

const OPTIONS: AskQuestionOption[] = [
  { label: "Individual consumers", recommended: true },
  { label: "Enterprise teams", description: "B2B" },
  { label: "Both" },
];

function toolCall(toolName: string, input: unknown): StreamPart {
  return { type: "tool-call", toolCallId: "c1", toolName, input } as unknown as StreamPart;
}

// --- pendingQuestions --------------------------------------------------------

test("pendingQuestions: an ask_question call becomes a one-element list", () => {
  const pending = pendingQuestions([
    toolCall("editFile", { path: "x" }),
    toolCall("ask_question", { question: "Who?", options: OPTIONS }),
  ]);
  assert.ok(pending);
  assert.equal(pending.batch, false);
  assert.equal(pending.questions.length, 1);
  assert.equal(pending.questions[0]?.question, "Who?");
});

test("pendingQuestions: an ask_questions call unwraps the form's questions", () => {
  const pending = pendingQuestions([
    toolCall("ask_questions", { questions: [{ question: "A", options: OPTIONS }, { question: "B", options: OPTIONS }] }),
  ]);
  assert.ok(pending);
  assert.equal(pending.batch, true);
  assert.equal(pending.questions.length, 2);
});

test("pendingQuestions: no question tool-call ⇒ undefined (ordinary turn)", () => {
  assert.equal(pendingQuestions([toolCall("editFile", { path: "x" })]), undefined);
});

// --- parseSelection ----------------------------------------------------------

test("parseSelection: a single number picks that option's label", () => {
  assert.deepEqual(parseSelection("1", OPTIONS), { selected: ["Individual consumers"] });
});

test("parseSelection: comma/space lists pick several (multiSelect), de-duped", () => {
  assert.deepEqual(parseSelection("1, 2", OPTIONS), {
    selected: ["Individual consumers", "Enterprise teams"],
  });
  assert.deepEqual(parseSelection("2 2", OPTIONS), { selected: ["Enterprise teams"] });
});

test("parseSelection: a trailing em-dash note rides alongside the picks", () => {
  assert.deepEqual(parseSelection("1 — mobile-first", OPTIONS), {
    selected: ["Individual consumers"],
    freeText: "mobile-first",
  });
  // double-hyphen is accepted too (terminals without an em-dash key)
  assert.deepEqual(parseSelection("3 -- both markets", OPTIONS), {
    selected: ["Both"],
    freeText: "both markets",
  });
});

test("parseSelection: non-numeric input is taken verbatim as free text (the Other path)", () => {
  assert.deepEqual(parseSelection("hobbyists and students", OPTIONS), {
    selected: [],
    freeText: "hobbyists and students",
  });
});

test("parseSelection: an out-of-range number is not a clean pick → free text", () => {
  assert.deepEqual(parseSelection("9", OPTIONS), { selected: [], freeText: "9" });
});
