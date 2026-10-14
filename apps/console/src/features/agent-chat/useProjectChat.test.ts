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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ISSUES_CHAT, issueChat, MAIN_CHAT, type ChatRef } from "./chatRef";

// Each chat's store talks to the server as its own chat: the Issues store
// reads its own thread and its own running turn, and starts its turns as an
// area turn (no spec room, no scope); the main store names no chat.

const conversationId = vi.fn<(projectName: string, chat?: ChatRef) => Promise<string>>();
const startTurn = vi.fn<(projectName: string, conversationId: string, body: unknown) => Promise<string>>();
const activeTurn = vi.fn<(projectName: string, chat?: ChatRef) => Promise<null>>();
vi.mock("./api/conversation", () => ({
  fetchCurrentConversationId: (p: string, c?: ChatRef) => conversationId(p, c),
  fetchConversationMessages: () => Promise.resolve([]),
}));
vi.mock("./api/turns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api/turns")>()),
  startTurn: (p: string, c: string, b: unknown) => startTurn(p, c, b),
  getActiveTurn: (p: string, c?: ChatRef) => activeTurn(p, c),
  getTurn: () => Promise.resolve(null),
  openTurnStream: () => Promise.reject(new Error("no stream")),
}));
vi.mock("../spec/collab/specRoom", () => ({ flushSpecRoom: vi.fn(() => Promise.resolve()) }));
vi.mock("../spec/collab/specDoc", () => ({ applyAgentWrite: vi.fn() }));

const { chatStore, chatStoreFor, forgetIssueChat } = await import("./useProjectChat");
const { IssueClosedError } = await import("./api/errors");
const { issueMarkedClosed } = await import("./closedIssues");

describe("chatStoreFor", () => {
  beforeEach(() => {
    conversationId.mockReset().mockResolvedValue("conv-1");
    startTurn.mockReset().mockRejectedValue(new Error("stop here"));
    activeTurn.mockReset().mockResolvedValue(null);
  });

  it("is the app's main store for the main chat", () => {
    expect(chatStoreFor(MAIN_CHAT)).toBe(chatStore);
    expect(chatStoreFor(ISSUES_CHAT)).not.toBe(chatStore);
    expect(chatStoreFor(ISSUES_CHAT)).toBe(chatStoreFor(ISSUES_CHAT));
  });

  it("reads the Issues area's thread and its running turn by its area", async () => {
    await chatStoreFor(ISSUES_CHAT).open("shop");
    expect(conversationId).toHaveBeenCalledWith("shop", ISSUES_CHAT);
    expect(activeTurn).toHaveBeenCalledWith("shop", ISSUES_CHAT);
  });

  it("starts an issues turn with the words alone, whatever scope the composer holds: its thread names its chat", async () => {
    await chatStoreFor(ISSUES_CHAT).open("shop-send");
    await chatStoreFor(ISSUES_CHAT).send("shop-send", "The login button is broken", { kind: "design" });
    expect(startTurn).toHaveBeenCalledWith("shop-send", "conv-1", { instruction: "The login button is broken" });
  });

  it("reads the main thread naming no chat and starts its turns as the composer built them", async () => {
    await chatStore.open("shop-main");
    await chatStore.send("shop-main", "Add approvals", { kind: "product" });
    expect(conversationId).toHaveBeenCalledWith("shop-main", undefined);
    expect(activeTurn).toHaveBeenCalledWith("shop-main", undefined);
    expect(startTurn).toHaveBeenCalledWith("shop-main", "conv-1", { instruction: "Add approvals" });
  });

  it("keeps one store per issue, made when first asked for, apart from the main and Issues stores", () => {
    const seven = chatStoreFor(issueChat(7));
    expect(chatStoreFor(issueChat(7))).toBe(seven);
    expect(chatStoreFor(issueChat(8))).not.toBe(seven);
    expect(seven).not.toBe(chatStore);
    expect(seven).not.toBe(chatStoreFor(ISSUES_CHAT));
  });

  it("reads an issue's own thread and running turn, by the area's focus on it", async () => {
    await chatStoreFor(issueChat(7)).open("shop-issue");
    expect(conversationId).toHaveBeenCalledWith("shop-issue", issueChat(7));
    expect(activeTurn).toHaveBeenCalledWith("shop-issue", issueChat(7));
  });

  it("starts an issue's turn with the words alone: its thread names the issue", async () => {
    await chatStoreFor(issueChat(7)).open("shop-issue-send");
    await chatStoreFor(issueChat(7)).send("shop-issue-send", "Comment that it is fixed", { kind: "product" });
    expect(startTurn).toHaveBeenCalledWith("shop-issue-send", "conv-1", { instruction: "Comment that it is fixed" });
  });

  it("marks the issue closed when its thread turns out removed (409 issue_closed), and that issue only", async () => {
    conversationId.mockRejectedValueOnce(new IssueClosedError());
    await chatStoreFor(issueChat(9)).open("shop-closed");
    expect(issueMarkedClosed("shop-closed", 9)).toBe(true);
    expect(issueMarkedClosed("shop-closed", 7)).toBe(false);
  });

  it("forgets the thread when a turn sent to it is refused as closed, so a reopen resolves a fresh one", async () => {
    await chatStoreFor(issueChat(10)).open("shop-closed-send");
    startTurn.mockRejectedValueOnce(new IssueClosedError());
    await chatStoreFor(issueChat(10)).send("shop-closed-send", "Hello", { kind: "product" });
    expect(issueMarkedClosed("shop-closed-send", 10)).toBe(true);
    expect(chatStoreFor(issueChat(10)).get("shop-closed-send")).toMatchObject({ status: "loading", items: [] });

    // Reopened: the issue's new thread, not the removed one.
    conversationId.mockResolvedValueOnce("conv-2");
    await chatStoreFor(issueChat(10)).open("shop-closed-send");
    expect(conversationId).toHaveBeenLastCalledWith("shop-closed-send", issueChat(10));
    expect(conversationId).toHaveBeenCalledTimes(2);
    expect(chatStoreFor(issueChat(10)).get("shop-closed-send")).toMatchObject({ status: "ready", items: [] });
  });

  it("forgets an issue's thread when told the issue was closed, that issue's only", async () => {
    await chatStoreFor(issueChat(11)).open("shop-list-closed");
    await chatStoreFor(issueChat(12)).open("shop-list-closed");
    forgetIssueChat("shop-list-closed", 11);
    expect(chatStoreFor(issueChat(11)).get("shop-list-closed").status).toBe("loading");
    expect(chatStoreFor(issueChat(12)).get("shop-list-closed").status).toBe("ready");
  });
});
