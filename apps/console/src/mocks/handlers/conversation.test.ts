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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAnswerInstruction } from "@aep/agent-stream";
import { chatOfConversation, conversationIdFor, runningTurn } from "../chatServer";
import { startMockTurn } from "./conversation";
import { issueThreadOpen, issuesOf } from "./issues";

// The Issues Page's chat is a second thread on the project, with its own agent.

describe("a turn for the Issues view", () => {
  const PROJECT = "acme-expenses";
  const REPORT = "The Save button on the expense form does nothing";
  const classifies = (turn: { frames: { part: { type: string; toolName?: string } }[] }) =>
    turn.frames.some((f) => f.part.type === "tool-call" && f.part.toolName === "classify_report");

  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers({ now: new Date("2026-10-06T10:00:00Z") });
  });
  afterEach(() => vi.useRealTimers());

  it("goes to the Issues agent, on its own conversation", () => {
    const turn = startMockTurn(PROJECT, { instruction: REPORT }, { view: "issues" });
    expect(turn.conversationId).toBe("conv-acme-expenses-issues");
    expect(turn.conversationId).toBe(conversationIdFor(PROJECT, "issues"));
    expect(turn.view).toBe("issues");
    expect(classifies(turn)).toBe(true);
  });

  it("is not what a main turn goes to", () => {
    const turn = startMockTurn(PROJECT, { instruction: REPORT });
    expect(turn.conversationId).toBe(conversationIdFor(PROJECT));
    expect(turn.view).toBeUndefined();
    expect(classifies(turn)).toBe(false);
  });

  it("is seen as running only by its own view", () => {
    const main = startMockTurn(PROJECT, { instruction: "Hello" });
    expect(runningTurn(PROJECT, "issues")).toBeUndefined();
    expect(runningTurn(PROJECT)?.turnId).toBe(main.turnId);
    vi.setSystemTime(Date.now() + 60_000);

    const issues = startMockTurn(PROJECT, { instruction: REPORT }, { view: "issues" });
    expect(runningTurn(PROJECT)).toBeUndefined();
    expect(runningTurn(PROJECT, "issues")?.turnId).toBe(issues.turnId);
  });

  it("files the issue the user's report drafted, shown in the list once the turn ends", () => {
    startMockTurn(PROJECT, { instruction: REPORT }, { view: "issues" });
    vi.setSystemTime(Date.now() + 60_000);
    const filing = startMockTurn(PROJECT, { instruction: buildAnswerInstruction("File this issue?", ["File it"]) }, { view: "issues" });
    expect(issuesOf(PROJECT).some((i) => i.Number === 15)).toBe(false);

    vi.setSystemTime(Date.now() + 60_000);
    expect(runningTurn(PROJECT, "issues")).toBeUndefined();
    const filed = issuesOf(PROJECT).find((i) => i.Number === 15);
    expect(filed).toMatchObject({ State: "open", Labels: ["bug", "src/user"] });
    expect(filed!.Title).toContain("Save button");
    expect(filing.reply).toBeDefined();
  });

  it("keeps a filed issue across a reload, and numbers the next after it", async () => {
    startMockTurn(PROJECT, { instruction: REPORT }, { view: "issues" });
    vi.setSystemTime(Date.now() + 60_000);
    startMockTurn(PROJECT, { instruction: buildAnswerInstruction("File this issue?", ["File it"]) }, { view: "issues" });
    vi.setSystemTime(Date.now() + 60_000);

    vi.resetModules();
    const reloaded = await import("./issues");
    expect(reloaded.issuesOf(PROJECT).map((i) => i.Number)).toEqual([15, 14, 12, 11, 9, 4, 3]);
    expect(reloaded.nextIssueNumber(PROJECT)).toBe(16);
    expect(reloaded.issuesOf("other-project")).toEqual([]);
  });
});

// Each open issue has a thread of its own, with its own agent; closing the
// issue removes it, so its thread is refused as the design agent refuses it (409).

describe("a turn for an issue's own view", () => {
  const PROJECT = "acme-expenses";

  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers({ now: new Date("2026-10-08T10:00:00Z") });
  });
  afterEach(() => vi.useRealTimers());

  it("goes to that issue's own conversation, whose id names its chat", () => {
    const turn = startMockTurn(PROJECT, { instruction: "What is this about?" }, { view: "issue", issueNumber: 11 });
    expect(turn.conversationId).toBe(conversationIdFor(PROJECT, "issue", 11));
    expect(turn.conversationId).not.toBe(conversationIdFor(PROJECT, "issue", 12));
    expect(chatOfConversation(PROJECT, turn.conversationId)).toEqual({ view: "issue", issueNumber: 11 });
    expect(chatOfConversation(PROJECT, conversationIdFor(PROJECT, "issues"))).toEqual({ view: "issues" });
    expect(chatOfConversation(PROJECT, conversationIdFor(PROJECT))).toEqual({ view: "main" });
    expect(chatOfConversation(PROJECT, "conv-other")).toBeNull();
  });

  it("is seen as running only by that issue's view", () => {
    const turn = startMockTurn(PROJECT, { instruction: "What is this about?" }, { view: "issue", issueNumber: 11 });
    expect(runningTurn(PROJECT, "issue", 11)?.turnId).toBe(turn.turnId);
    expect(runningTurn(PROJECT, "issue", 12)).toBeUndefined();
    expect(runningTurn(PROJECT, "issues")).toBeUndefined();
  });

  it("closes the issue when its agent's close turn ends, and the thread goes with it", () => {
    startMockTurn(PROJECT, { instruction: "Close it, finance no longer needs PDFs" }, { view: "issue", issueNumber: 11 });
    vi.setSystemTime(Date.now() + 60_000);
    startMockTurn(PROJECT, { instruction: buildAnswerInstruction("Close this issue?", ["Close it"]) }, { view: "issue", issueNumber: 11 });
    expect(issueThreadOpen(PROJECT, 11)).toBe(true);
    vi.setSystemTime(Date.now() + 60_000);
    expect(issuesOf(PROJECT).find((i) => i.Number === 11)?.State).toBe("closed");
    expect(issueThreadOpen(PROJECT, 11)).toBe(false);
    expect(issueThreadOpen(PROJECT, 12)).toBe(true);
  });
});
