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
import {
  ASK_QUESTION_TOOL,
  ASK_QUESTIONS_TOOL,
  buildAnswerInstruction,
  buildAnswersInstruction,
} from "@aep/agent-stream";
import {
  answerableQuestionIds,
  extractStreamingQuestions,
  isQuestionTool,
  parseQuestionsInput,
} from "./questionCards";
import type { ChatMessage } from "./chatStore";

const SINGLE = {
  question: "Which auth flow?",
  options: [
    { label: "OIDC", description: "Platform default", recommended: true },
    { label: "API keys" },
  ],
};

describe("parseQuestionsInput — ask_question (single)", () => {
  it("wraps a single question as a one-element list", () => {
    expect(parseQuestionsInput(ASK_QUESTION_TOOL, SINGLE)).toEqual([SINGLE]);
  });

  it("accepts the provider's stringified JSON", () => {
    expect(parseQuestionsInput(ASK_QUESTION_TOOL, JSON.stringify(SINGLE))).toEqual([SINGLE]);
  });

  it("keeps multiSelect only when explicitly true", () => {
    expect(parseQuestionsInput(ASK_QUESTION_TOOL, { ...SINGLE, multiSelect: true })![0]!.multiSelect).toBe(true);
    expect(parseQuestionsInput(ASK_QUESTION_TOOL, { ...SINGLE, multiSelect: "yes" })![0]!.multiSelect).toBeUndefined();
  });

  it("keeps detail only when a non-empty string", () => {
    expect(parseQuestionsInput(ASK_QUESTION_TOOL, { ...SINGLE, detail: "Why I ask." })![0]!.detail).toBe("Why I ask.");
    expect(parseQuestionsInput(ASK_QUESTION_TOOL, { ...SINGLE, detail: "" })![0]!.detail).toBeUndefined();
    expect(parseQuestionsInput(ASK_QUESTION_TOOL, { ...SINGLE, detail: 42 })![0]!.detail).toBeUndefined();
  });

  it("accepts empty options as a free-text question", () => {
    expect(parseQuestionsInput(ASK_QUESTION_TOOL, { question: "q", options: [] })).toEqual([
      { question: "q", options: [] },
    ]);
  });

  it.each([
    ["missing question", { options: SINGLE.options }],
    ["missing options", { question: "q" }],
    ["option without label", { question: "q", options: [{ description: "x" }] }],
    ["duplicate labels", { question: "q", options: [{ label: "a" }, { label: "a", description: "d" }] }],
    ["malformed JSON string", "{nope"],
    ["null", null],
  ])("rejects %s", (_name, value) => {
    expect(parseQuestionsInput(ASK_QUESTION_TOOL, value)).toBeNull();
  });
});

describe("parseQuestionsInput — ask_questions (batch)", () => {
  const BATCH = { questions: [SINGLE, { question: "Web or mobile?", options: [{ label: "Web" }, { label: "Mobile" }] }] };

  it("returns the full list", () => {
    expect(parseQuestionsInput(ASK_QUESTIONS_TOOL, BATCH)).toEqual(BATCH.questions);
  });

  it("rejects an empty questions list", () => {
    expect(parseQuestionsInput(ASK_QUESTIONS_TOOL, { questions: [] })).toBeNull();
  });

  it("rejects when ANY question is malformed", () => {
    expect(parseQuestionsInput(ASK_QUESTIONS_TOOL, { questions: [SINGLE, { question: "q" }] })).toBeNull();
  });

  it("rejects an unknown tool name", () => {
    expect(parseQuestionsInput("addFile", SINGLE)).toBeNull();
  });
});

describe("extractStreamingQuestions", () => {
  const BATCH_JSON = JSON.stringify({
    questions: [
      SINGLE,
      { question: "Which platform?", detail: "Sets the UI stack.", options: [{ label: "Web" }, { label: "Mobile" }] },
    ],
  });

  it("returns [] before the first question object closes", () => {
    const cut = BATCH_JSON.indexOf("}") - 1; // inside the first option object
    expect(extractStreamingQuestions(ASK_QUESTIONS_TOOL, BATCH_JSON.slice(0, cut))).toEqual([]);
  });

  it("returns each question as soon as its object closes", () => {
    // Cut right after the first question's closing brace (before the comma).
    const firstClose = BATCH_JSON.indexOf('},{"question"') + 1;
    const got = extractStreamingQuestions(ASK_QUESTIONS_TOOL, BATCH_JSON.slice(0, firstClose));
    expect(got).toEqual([SINGLE]);
  });

  it("returns all questions from a complete (or fully-buffered) input", () => {
    expect(extractStreamingQuestions(ASK_QUESTIONS_TOOL, BATCH_JSON)).toHaveLength(2);
    // Also when the closing ]} hasn't arrived yet.
    const noTail = BATCH_JSON.slice(0, BATCH_JSON.lastIndexOf("]"));
    expect(extractStreamingQuestions(ASK_QUESTIONS_TOOL, noTail)).toHaveLength(2);
  });

  it("is not confused by braces and escaped quotes inside strings", () => {
    const tricky = JSON.stringify({
      questions: [
        { question: 'Use "brace {} style" config?', options: [{ label: "Yes", description: 'It means {"a":1} literally \\ everywhere' }] },
        SINGLE,
      ],
    });
    const firstClose = tricky.indexOf('},{"question"') + 1;
    const got = extractStreamingQuestions(ASK_QUESTIONS_TOOL, tricky.slice(0, firstClose));
    expect(got).toHaveLength(1);
    expect(got[0]!.question).toBe('Use "brace {} style" config?');
  });

  it("skips a malformed question object but keeps later valid ones", () => {
    const buf = JSON.stringify({ questions: [{ options: [{ label: "orphan" }] }, SINGLE] });
    expect(extractStreamingQuestions(ASK_QUESTIONS_TOOL, buf)).toEqual([SINGLE]);
  });

  it("returns [] for the single-question tool and unknown tools", () => {
    expect(extractStreamingQuestions(ASK_QUESTION_TOOL, JSON.stringify(SINGLE))).toEqual([]);
    expect(extractStreamingQuestions("addFile", BATCH_JSON)).toEqual([]);
    expect(extractStreamingQuestions(undefined, BATCH_JSON)).toEqual([]);
  });

  it("returns [] for garbage before the questions array", () => {
    expect(extractStreamingQuestions(ASK_QUESTIONS_TOOL, '{"other": [')).toEqual([]);
    expect(extractStreamingQuestions(ASK_QUESTIONS_TOOL, "")).toEqual([]);
  });
});

describe("isQuestionTool", () => {
  it("recognizes both question tools and nothing else", () => {
    expect(isQuestionTool(ASK_QUESTION_TOOL)).toBe(true);
    expect(isQuestionTool(ASK_QUESTIONS_TOOL)).toBe(true);
    expect(isQuestionTool("addFile")).toBe(false);
    expect(isQuestionTool(undefined)).toBe(false);
  });
});

describe("buildAnswerInstruction / buildAnswersInstruction (wire contract)", () => {
  it("serializes a single selection", () => {
    expect(buildAnswerInstruction("Which auth flow?", ["OIDC"])).toBe('Answer to "Which auth flow?": OIDC');
  });

  it("combines labels and a free-text note", () => {
    expect(buildAnswerInstruction("Which?", ["A", "B"], "prefer A")).toBe('Answer to "Which?": A, B — prefer A');
  });

  it("serializes a batch as a bulleted list under the Answers: header", () => {
    const out = buildAnswersInstruction([
      { question: "Q1", selected: ["A"] },
      { question: "Q2", selected: ["X", "Y"], freeText: "note" },
    ]);
    expect(out).toBe('Answers:\n- "Q1": A\n- "Q2": X, Y — note');
  });
});

function question(id: string, answered = false): ChatMessage {
  return {
    id,
    role: "question",
    turnId: "t1",
    toolCallId: `tc-${id}`,
    questions: [SINGLE],
    ...(answered ? { answers: [{ selected: ["OIDC"] }] } : {}),
  };
}

function user(id: string, status: "completed" | "failed" = "completed"): ChatMessage {
  return { id, role: "user", content: "text", status };
}

describe("answerableQuestionIds", () => {
  it("keeps an unanswered trailing question answerable", () => {
    expect(answerableQuestionIds([user("u1"), question("q1")])).toEqual(new Set(["q1"]));
  });

  it("excludes a question the card already answered", () => {
    expect(answerableQuestionIds([question("q1", true)])).toEqual(new Set());
  });

  it("is superseded by any later delivered user message", () => {
    expect(answerableQuestionIds([question("q1"), user("u2")])).toEqual(new Set());
  });

  it("is NOT superseded by a failed send — the agent never saw it", () => {
    expect(answerableQuestionIds([question("q1"), user("u2", "failed")])).toEqual(new Set(["q1"]));
  });

  it("supersedes earlier questions but not later ones, in one pass", () => {
    expect(answerableQuestionIds([question("q1"), user("u1"), question("q2")])).toEqual(new Set(["q2"]));
  });
});
