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
import { chatFor, chatIssue, chatKey, homeLink, ISSUES_CHAT, issueChat, MAIN_CHAT, questionsLink, sameChat, areaTurnBody, wireQuery } from "./chatRef";

// A project has a main chat and a chat per area: the Issues Page talks to its
// own agent on its own thread, and each issue's card to that area narrowed to
// the issue; everywhere else is the main chat.

describe("chatFor", () => {
  it("is the Issues area's chat on the Issues Page with no card open", () => {
    expect(chatFor("issues", null)).toEqual(ISSUES_CHAT);
  });

  it("is the Issues area focused on the issue on an Issue card", () => {
    expect(chatFor("issues", "issue", 7)).toEqual({ area: "issues", focus: { kind: "issue", id: 7 } });
  });

  it("is the Issues area focused on the issue on the Questions card answering that issue's chat", () => {
    expect(chatFor("issues", "questions", 7)).toEqual(issueChat(7));
  });

  it("is the main chat on an Issue card that names no issue", () => {
    expect(chatFor("issues", "issue")).toEqual(MAIN_CHAT);
  });

  it("is the Issues area's chat on the Questions card over the Issues Page, and the main chat on the one over the overview", () => {
    expect(chatFor("issues", "questions")).toEqual(ISSUES_CHAT);
    expect(chatFor("overview", "questions")).toEqual(MAIN_CHAT);
  });

  it("is the main chat on every other Page", () => {
    expect(chatFor("overview", null)).toEqual(MAIN_CHAT);
    expect(chatFor("builds", null)).toEqual(MAIN_CHAT);
    expect(chatFor("deploy", null)).toEqual(MAIN_CHAT);
  });
});

describe("a chat's identity", () => {
  it("names the issue a chat is focused on, and none otherwise", () => {
    expect(chatIssue(issueChat(7))).toBe(7);
    expect(chatIssue(ISSUES_CHAT)).toBeUndefined();
    expect(chatIssue(MAIN_CHAT)).toBeUndefined();
  });

  it("keys a chat by its area and focus", () => {
    expect(chatKey(MAIN_CHAT)).toBe("main");
    expect(chatKey(ISSUES_CHAT)).toBe("issues");
    expect(chatKey(issueChat(7))).toBe("issue-7");
  });

  it("compares chats by area and focus", () => {
    expect(sameChat(issueChat(7), issueChat(7))).toBe(true);
    expect(sameChat(issueChat(7), issueChat(8))).toBe(false);
    expect(sameChat(issueChat(7), ISSUES_CHAT)).toBe(false);
    expect(sameChat(ISSUES_CHAT, { area: "issues" })).toBe(true);
    expect(sameChat(MAIN_CHAT, {})).toBe(true);
    expect(sameChat(MAIN_CHAT, ISSUES_CHAT)).toBe(false);
  });
});

describe("where a chat's questions are answered, and where it closes back to", () => {
  it("is the overview's card for the main chat", () => {
    expect(questionsLink("shop", MAIN_CHAT)).toEqual({ to: "/projects/$projectName/questions", params: { projectName: "shop" } });
    expect(homeLink("shop", MAIN_CHAT)).toEqual({ to: "/projects/$projectName", params: { projectName: "shop" } });
  });

  it("is the Issues Page's card for the Issues area's chat", () => {
    expect(questionsLink("shop", ISSUES_CHAT)).toEqual({ to: "/projects/$projectName/issues/questions", params: { projectName: "shop" } });
    expect(homeLink("shop", ISSUES_CHAT)).toEqual({ to: "/projects/$projectName/issues", params: { projectName: "shop" } });
  });

  it("is the Issues Page's card, naming the issue, for an issue's chat, which closes back to the issue's card", () => {
    expect(questionsLink("shop", issueChat(7))).toEqual({
      to: "/projects/$projectName/issues/questions",
      params: { projectName: "shop" },
      search: { issue: 7 },
    });
    expect(homeLink("shop", issueChat(7))).toEqual({
      to: "/projects/$projectName/issues/$number",
      params: { projectName: "shop", number: "7" },
    });
  });
});

describe("wireQuery", () => {
  it("names an area's own chat by its area: the main chat is the absence of one", () => {
    expect(wireQuery(ISSUES_CHAT)).toEqual({ area: "issues" });
    expect(wireQuery(MAIN_CHAT)).toBeUndefined();
    expect(wireQuery(undefined)).toBeUndefined();
  });

  it("names an issue's chat by the area and its focus", () => {
    expect(wireQuery(issueChat(7))).toEqual({ area: "issues", focus: { kind: "issue", id: 7 } });
  });
});

describe("areaTurnBody", () => {
  const roomTurn = { instruction: "Go", collab: true, scope: { kind: "design-review" as const } };

  it("leaves a main-chat turn as it is", () => {
    expect(areaTurnBody(MAIN_CHAT, roomTurn)).toBe(roomTurn);
  });

  it("sends an area chat's turn as the words alone: it has no spec room and no scope, and its thread names its chat", () => {
    expect(areaTurnBody(ISSUES_CHAT, roomTurn)).toEqual({ instruction: "Go" });
    expect(areaTurnBody(issueChat(7), roomTurn)).toEqual({ instruction: "Go" });
  });
});
