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

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OxygenTheme, OxygenUIThemeProvider } from "@wso2/oxygen-ui";
import { QuestionCard, type QuestionMessage } from "./QuestionCard";

const single = (over: Partial<QuestionMessage> = {}): QuestionMessage => ({
  id: "q1",
  role: "question",
  turnId: "t1",
  toolCallId: "tc-1",
  questions: [
    {
      question: "Who is the primary user?",
      options: [
        { label: "Consumers", description: "self-serve", recommended: true },
        { label: "Teams" },
      ],
    },
  ],
  ...over,
});

const batch = (): QuestionMessage => ({
  id: "q2",
  role: "question",
  turnId: "t1",
  toolCallId: "tc-2",
  questions: [
    { question: "Primary user?", options: [{ label: "Consumers" }, { label: "Teams" }] },
    { question: "Platform?", options: [{ label: "Web" }, { label: "Mobile" }] },
  ],
});

function renderCard(msg: QuestionMessage, answerable: boolean, onAnswer = vi.fn()) {
  render(
    <OxygenUIThemeProvider theme={OxygenTheme}>
      <QuestionCard msg={msg} answerable={answerable} busy={false} onAnswer={onAnswer} />
    </OxygenUIThemeProvider>,
  );
  return onAnswer;
}

afterEach(cleanup);

describe("QuestionCard — single", () => {
  it("renders the question, options, and the Recommended badge", () => {
    renderCard(single(), true);
    expect(screen.getByText("Who is the primary user?")).toBeTruthy();
    expect(screen.getByText("Consumers")).toBeTruthy();
    expect(screen.getByText("Recommended")).toBeTruthy();
  });

  it("submits the selected option's label", () => {
    const onAnswer = renderCard(single(), true);
    fireEvent.click(screen.getByText("Consumers"));
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    const [, answers] = onAnswer.mock.calls[0]!;
    expect(answers).toEqual([{ selected: ["Consumers"] }]);
  });

  it("disables submit until something is chosen", () => {
    renderCard(single(), true);
    expect((screen.getByRole("button", { name: "Answer" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("is read-only (no submit button) once answered, showing the recorded choice", () => {
    renderCard(single({ answers: [{ selected: ["Teams"] }] }), false);
    expect(screen.queryByRole("button", { name: "Answer" })).toBeNull();
  });
});

describe("QuestionCard — multiSelect", () => {
  const multi = (): QuestionMessage => ({
    id: "q3",
    role: "question",
    turnId: "t1",
    toolCallId: "tc-3",
    questions: [
      {
        question: "Which platforms?",
        multiSelect: true,
        options: [{ label: "Web" }, { label: "Mobile" }, { label: "Desktop" }],
      },
    ],
  });

  it("allows several selections plus an 'Other' free-text note", () => {
    const onAnswer = renderCard(multi(), true);
    fireEvent.click(screen.getByText("Web"));
    fireEvent.click(screen.getByText("Mobile"));
    // The "Other…" row must be offered on a multi-select question too — the
    // answer model carries freeText for any question (ADR-0012).
    fireEvent.change(screen.getByPlaceholderText("Other / add a note…"), {
      target: { value: "CLI" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    const [, answers] = onAnswer.mock.calls[0]!;
    expect(answers).toEqual([{ selected: ["Web", "Mobile"], freeText: "CLI" }]);
  });
});

describe("QuestionCard — batch (ask_questions)", () => {
  it("renders each question and requires all answered before submit", () => {
    const onAnswer = renderCard(batch(), true);
    expect(screen.getByText("Primary user?")).toBeTruthy();
    expect(screen.getByText("Platform?")).toBeTruthy();
    const submit = () => screen.getByRole("button", { name: "Submit answers" }) as HTMLButtonElement;
    fireEvent.click(screen.getByText("Consumers"));
    expect(submit().disabled).toBe(true); // second question still unanswered
    fireEvent.click(screen.getByText("Web"));
    expect(submit().disabled).toBe(false);
    fireEvent.click(submit());
    const [, answers] = onAnswer.mock.calls[0]!;
    expect(answers).toEqual([{ selected: ["Consumers"] }, { selected: ["Web"] }]);
  });
});
