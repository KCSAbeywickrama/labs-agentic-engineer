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

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ISSUES_CHAT, issueChat, MAIN_CHAT } from "../chatRef";

// The project conversation's two reads, on the org's design agent.

vi.mock("../../../auth/token", () => ({
  getAccessToken: () => Promise.resolve(null),
  renewAccessToken: () => Promise.resolve(null),
  redirectToSignIn: () => undefined,
}));

const { AE_STUDIO_RESTARTING, setAeStudioUrls } = await import("../../../api/aeStudio");
const { fetchConversationMessages, fetchCurrentConversationId } = await import("./conversation");
const { IssueClosedError } = await import("./errors");

const POD = "http://ae-design-agent.mock/v1";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => setAeStudioUrls({ designAgent: "http://ae-design-agent.mock" }));
afterEach(() => {
  server.resetHandlers();
  setAeStudioUrls(null);
});
afterAll(() => server.close());

describe("fetchCurrentConversationId", () => {
  it("is the project's current thread, as the pod names it", async () => {
    server.use(
      http.get(`${POD}/projects/shop/conversations/current`, () =>
        HttpResponse.json({ conversationId: "conv-1", createdAt: "2026-10-07T09:00:00Z", current: true }),
      ),
    );
    expect(await fetchCurrentConversationId("shop")).toBe("conv-1");
  });

  it("says AE Studio is restarting when the pod answers 503", async () => {
    server.use(
      http.get(`${POD}/projects/shop/conversations/current`, () =>
        HttpResponse.json({ type: "about:blank", title: "x", status: 503, code: "idp_unavailable" }, { status: 503 }),
      ),
    );
    await expect(fetchCurrentConversationId("shop")).rejects.toThrow(AE_STUDIO_RESTARTING);
  });
  it("reads an area chat's own thread by its area and focus, and never puts the main chat on the wire", async () => {
    const seen: string[] = [];
    server.use(
      http.get(`${POD}/projects/shop/conversations/current`, ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json({ conversationId: "conv-v", createdAt: "2026-10-07T09:00:00Z", current: true });
      }),
    );
    await fetchCurrentConversationId("shop", MAIN_CHAT);
    await fetchCurrentConversationId("shop", ISSUES_CHAT);
    await fetchCurrentConversationId("shop", issueChat(7));
    expect(seen).toEqual(["", "?area=issues", "?area=issues&focus[kind]=issue&focus[id]=7"]);
  });

  it("reads a 409 issue_closed as the issue being closed: it has no thread", async () => {
    server.use(
      http.get(`${POD}/projects/shop/conversations/current`, () =>
        HttpResponse.json({ type: "about:blank", title: "Conflict", status: 409, code: "issue_closed" }, { status: 409 }),
      ),
    );
    await expect(fetchCurrentConversationId("shop", issueChat(7))).rejects.toBeInstanceOf(IssueClosedError);
  });

  it("carries the pod's words for a chat it no longer knows (400 invalid_chat), so a tab older than the pod is told to reload", async () => {
    const detail = "view no longer names a chat: this page is out of date, reload it";
    server.use(
      http.get(`${POD}/projects/shop/conversations/current`, () =>
        HttpResponse.json({ type: "about:blank", title: "Bad Request", status: 400, code: "invalid_chat", detail }, { status: 400 }),
      ),
    );
    await expect(fetchCurrentConversationId("shop", ISSUES_CHAT)).rejects.toThrow(detail);
  });
});

describe("fetchConversationMessages", () => {
  it("is the thread's history, oldest first", async () => {
    const messages = [
      { role: "user", content: "Hi", author: { id: "sub-1", displayName: "Dev" }, scope: { kind: "design-review" } },
      { role: "assistant", content: "Hello" },
    ];
    server.use(http.get(`${POD}/projects/shop/conversations/conv-1/messages`, () => HttpResponse.json({ messages })));
    expect(await fetchConversationMessages("shop", "conv-1")).toEqual(messages);
  });

  it("carries the pod's words for a refusal", async () => {
    server.use(
      http.get(`${POD}/projects/shop/conversations/conv-1/messages`, () =>
        HttpResponse.json(
          { type: "about:blank", title: "Not Found", status: 404, code: "conversation_unknown", detail: "no such conversation" },
          { status: 404 },
        ),
      ),
    );
    await expect(fetchConversationMessages("shop", "conv-1")).rejects.toThrow("no such conversation");
  });
});
