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

/**
 * A project's chats (`conversations/chat.ts`): the main chat, the Issues
 * area's and the area's chat focused on each open issue have a thread and a
 * turn slot of their own; an
 * issue's chat exists only while its issue is open, and goes when aep-api
 * says the issue closed or reopened; the main chat is told what the Issues
 * chat came to meanwhile.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent, fetch as undiciFetch } from "undici";
import { mockModel } from "../src/shared/mock-model.js";
import { ChatError, chatFromQuery, chatKey, issueChat } from "../src/conversations/chat.js";
import { AREAS } from "../src/areas/profiles.js";
import { ThreadBook } from "../src/conversations/thread-book.js";
import { InMemoryConversationStore } from "../src/store/memory-store.js";
import { PROJECT, call, startEdge, streamOf, type Edge } from "./helpers/edge.js";

const text = (t: string) => mockModel([{ kind: "text", text: t }]);
const slow = (t: string) => mockModel([{ kind: "text", text: t }], { delayMs: 400 });

async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
}

async function withEdge(opts: Parameters<typeof startEdge>[0], body: (edge: Edge) => Promise<void>): Promise<void> {
  const edge = await startEdge(opts);
  try {
    await body(edge);
  } finally {
    await edge.close();
  }
}

/** The chat's current thread id, over `/v1`. */
async function current(edge: Edge, tok: string, query = ""): Promise<string> {
  const res = await call(edge, `/v1/projects/${PROJECT}/conversations/current${query}`, tok);
  assert.equal(res.status, 200, `current${query}`);
  return (await json<{ conversationId: string }>(res)).conversationId;
}

async function send(edge: Edge, tok: string, conversationId: string, instruction: string): Promise<Response> {
  return call(edge, `/v1/projects/${PROJECT}/conversations/${conversationId}/turns`, tok, { json: { instruction } });
}

/** DELETE on the Turn socket, as ae-studio-tools sends it. */
async function removeOnSocket(edge: Edge, path: string): Promise<number> {
  const res = await undiciFetch(`http://turn.sock${path}`, { method: "DELETE", dispatcher: new Agent({ connect: { socketPath: edge.turnSocket } }) });
  await res.text();
  return res.status;
}

test("chatFromQuery: none is the main chat; an area; the area focused on a positive issue", () => {
  assert.deepEqual(chatFromQuery({}), {});
  assert.deepEqual(chatFromQuery({ area: "issues" }), { area: "issues" });
  assert.deepEqual(chatFromQuery({ area: "issues", "focus[kind]": "issue", "focus[id]": "7" }), issueChat(7));
  assert.deepEqual(issueChat(7), { area: "issues", focus: { kind: "issue", id: 7 } });
});

test("chatKey: the thread's use case derives from the area and its focus", () => {
  assert.equal(chatKey({}), "");
  assert.equal(chatKey({ area: "issues" }), "issues");
  assert.equal(chatKey(issueChat(7)), "issue-7");
});

test("chatFromQuery refuses an unknown area, a focus without an area, and a focus the area does not declare or without a positive id", () => {
  const refused: Record<string, unknown>[] = [
    { area: "boards" },
    { area: "issue" },
    { area: "" },
    { area: ["issues", "issues"] },
    { "focus[kind]": "issue", "focus[id]": "3" },
    { area: "issues", "focus[kind]": "issue" },
    { area: "issues", "focus[id]": "3" },
    { area: "issues", "focus[kind]": "board", "focus[id]": "3" },
    { area: "issues", "focus[kind]": "constructor", "focus[id]": "3" },
    { area: "issues", "focus[kind]": "issue", "focus[id]": "0" },
    { area: "issues", "focus[kind]": "issue", "focus[id]": "-1" },
    { area: "issues", "focus[kind]": "issue", "focus[id]": "1.5" },
    { area: "issues", "focus[kind]": "issue", "focus[id]": "1e3" },
    { area: "issues", "focus[kind]": "issue", "focus[id]": "07" },
    { area: "issues", "focus[kind]": "issue", "focus[id]": ["3", "4"] },
    { area: "issues", focus: "issue" },
  ];
  for (const query of refused) assert.throws(() => chatFromQuery(query), ChatError, JSON.stringify(query));
});

test("chatFromQuery takes a focus only with an area whose profile declares that kind", () => {
  const unfocused = { issues: { id: AREAS.issues.id, label: AREAS.issues.label, base: AREAS.issues.base } };
  assert.deepEqual(chatFromQuery({ area: "issues" }, unfocused), { area: "issues" });
  assert.throws(() => chatFromQuery({ area: "issues", "focus[kind]": "issue", "focus[id]": "7" }, unfocused), ChatError);
});

test("ThreadBook: each chat has its own current thread, and an id names its chat", () => {
  const threads = new ThreadBook({ store: new InMemoryConversationStore() });
  const main = threads.current("greeter", "Ann").conversationId;
  const issues = threads.current("greeter", "Ann", { area: "issues" }).conversationId;
  const seven = threads.current("greeter", "Ann", issueChat(7)).conversationId;
  assert.equal(new Set([main, issues, seven]).size, 3);
  assert.deepEqual(threads.chatOf("greeter", main), {});
  assert.deepEqual(threads.chatOf("greeter", issues), { area: "issues" });
  assert.deepEqual(threads.chatOf("greeter", seven), issueChat(7));
  assert.equal(threads.chatOf("billing", seven), null, "an id never names another project's chat");
});

test("ThreadBook: branch notes count the Issues outcomes since the main turn and are taken once", () => {
  const threads = new ThreadBook({ store: new InMemoryConversationStore() });
  assert.deepEqual(threads.takeBranchNotes("greeter"), []);
  threads.noteOutcome("greeter", "Filed #3: Save fails");
  threads.noteOutcome("greeter", "Filed #4: Export");
  assert.deepEqual(threads.takeBranchNotes("greeter"), [{ area: "issues", turns: 2, outcome: "Filed #4: Export" }]);
  assert.deepEqual(threads.takeBranchNotes("greeter"), []);
});

test("ThreadBook: an issue's thread goes only when it predates the removal, and a deferred removal runs at its turn's end", async () => {
  let now = new Date("2026-10-08T10:00:00Z");
  const store = new InMemoryConversationStore();
  const threads = new ThreadBook({ store, now: () => now });
  const chat = issueChat(7);
  const old = threads.current("greeter", "Ann", chat).conversationId;
  assert.equal(await threads.removeIssueThread("greeter", 7, new Date("2026-10-08T09:00:00Z")), false, "a thread started after the event stays");
  assert.equal(threads.chatOf("greeter", old) !== null, true);

  threads.deferIssueRemoval("greeter", 7, old, new Date("2026-10-08T11:00:00Z"));
  assert.notEqual(threads.chatOf("greeter", old), null, "a deferred removal waits for the turn");
  await threads.turnEnded("greeter", old);
  assert.equal(threads.chatOf("greeter", old), null, "the turn's end removes it");

  now = new Date("2026-10-08T12:00:00Z");
  const fresh = threads.current("greeter", "Ann", chat).conversationId;
  assert.notEqual(fresh, old, "a reopened issue starts a fresh thread");
  assert.equal(await threads.removeIssueThread("greeter", 7, new Date("2026-10-08T13:00:00Z")), true);
  assert.equal(await threads.removeIssueThread("greeter", 7, new Date("2026-10-08T13:00:00Z")), false, "idempotent");
});

test("v1: the Issues chat runs beside the main chat on its own thread and route; the main chat's next turn is told its outcome", () =>
  withEdge({ models: [slow("main working"), text("Filed #12: Save does nothing"), text("ok")] }, async (edge) => {
    const tok = await edge.token({ sub: "u1", name: "Ann" });
    const main = await current(edge, tok);
    const issues = await current(edge, tok, "?area=issues");
    assert.notEqual(main, issues);

    const mainTurn = await json<{ turnId: string }>(await send(edge, tok, main, "add a login page"));
    const issuesRes = await send(edge, tok, issues, "/design the save button is broken");
    assert.equal(issuesRes.status, 202, "the Issues chat never waits on the main chat");
    const issuesTurn = await json<{ turnId: string }>(issuesRes);
    const active = await call(edge, `/v1/projects/${PROJECT}/turns/active?area=issues`, tok);
    assert.equal(active.status === 200 || active.status === 204, true);
    await streamOf(edge, tok, issuesTurn.turnId);
    await streamOf(edge, tok, mainTurn.turnId);

    await until(() => edge.tools.usage.length === 2, "both usage records");
    const issuesRecord = edge.tools.usage.find((r) => r.conversationId === issues)!;
    assert.equal(issuesRecord.area, "issues");
    assert.equal(issuesRecord.focus, undefined);
    assert.equal(issuesRecord.flow, "", "a typed /design is words for the Issues agent, not a flow");
    const mainRecord = edge.tools.usage.find((r) => r.conversationId === main)!;
    assert.equal(mainRecord.area, undefined);
    assert.equal(mainRecord.focus, undefined);

    const next = await json<{ turnId: string }>(await send(edge, tok, main, "what happened?"));
    await streamOf(edge, tok, next.turnId);
    const messages = await json<{ messages: unknown[] }>(await call(edge, `/v1/projects/${PROJECT}/conversations/${main}/messages`, tok));
    assert.equal(messages.messages.length, 4);
    const stored = (await edge.store.get(main))!.messages;
    assert.match(JSON.stringify(stored.at(-2)), /Meanwhile in Issues \(1 turn\): \\"Filed #12: Save does nothing\\"/);
  }));

test("v1: an open issue's chat has a thread; a closed one is 409 issue_closed and its thread goes; an unknown one is 404", () =>
  withEdge({ models: [text("ok")], issues: { 7: { state: "open" } } }, async (edge) => {
    const tok = await edge.token();
    const seven = await current(edge, tok, "?area=issues&focus[kind]=issue&focus[id]=7");
    assert.equal(await current(edge, tok, "?area=issues&focus%5Bkind%5D=issue&focus%5Bid%5D=7"), seven, "the focus's brackets may come encoded");
    const turn = await json<{ turnId: string }>(await send(edge, tok, seven, "summarise it"));
    await streamOf(edge, tok, turn.turnId);
    await until(() => edge.tools.usage.length === 1, "the usage record");
    assert.equal(edge.tools.usage[0]!.area, "issues");
    assert.deepEqual(edge.tools.usage[0]!.focus, { kind: "issue", id: 7 });
    assert.ok(edge.tools.toolCalls.some((c) => c.name === "get_issue" && c.route === `/projects/${PROJECT}/issues/7/mcp`));

    edge.tools.setIssueState(7, "closed");
    const closed = await call(edge, `/v1/projects/${PROJECT}/conversations/current?area=issues&focus[kind]=issue&focus[id]=7`, tok);
    assert.equal(closed.status, 409);
    assert.equal((await json<{ code: string }>(closed)).code, "issue_closed");
    const refused = await send(edge, tok, seven, "again");
    assert.equal(refused.status, 409);
    assert.deepEqual(await json(refused), { code: "conversation_rotated" }, "the closed issue's thread is gone");

    assert.equal((await call(edge, `/v1/projects/${PROJECT}/conversations/current?area=issues&focus[kind]=issue&focus[id]=8`, tok)).status, 404);
    for (const query of ["area=issues&focus[kind]=issue", "focus[kind]=issue&focus[id]=7", "area=issues&focus[kind]=issue&focus[id]=0", "area=issues&focus[kind]=board&focus[id]=7"]) {
      const bad = await call(edge, `/v1/projects/${PROJECT}/conversations/current?${query}`, tok);
      assert.equal(bad.status, 400, query);
      assert.equal((await json<{ code: string }>(bad)).code, "invalid_chat", query);
    }
    assert.equal((await call(edge, `/v1/projects/${PROJECT}/turns/active?area=boards`, tok)).status, 400);
    assert.equal((await call(edge, `/v1/projects/${PROJECT}/turns/active?focus[kind]=issue&focus[id]=7`, tok)).status, 400);
  }));

test("Turn socket: removing an issue's thread is 204, and waits for a turn running on it", () => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  return withEdge({ models: [mockModel([{ kind: "text", text: "working" }], { hold })], issues: { 7: { state: "open" } } }, async (edge) => {
    const tok = await edge.token();
    const seven = await current(edge, tok, "?area=issues&focus[kind]=issue&focus[id]=7");
    const turn = await json<{ turnId: string }>(await send(edge, tok, seven, "close it"));
    const later = new Date(Date.now() + 60_000).toISOString();
    assert.equal(await removeOnSocket(edge, `/projects/${PROJECT}/issues/7/thread?before=${later}`), 204);
    assert.notEqual(edge.threads.chatOf(PROJECT, seven), null, "the running turn keeps its thread");
    release();
    await streamOf(edge, tok, turn.turnId);
    await until(() => edge.threads.chatOf(PROJECT, seven) === null, "the removal at the turn's end");
    assert.equal(await removeOnSocket(edge, `/projects/${PROJECT}/issues/7/thread?before=${later}`), 204, "idempotent");
    assert.equal(await removeOnSocket(edge, `/projects/${PROJECT}/issues/0/thread?before=${later}`), 400);
    assert.equal(await removeOnSocket(edge, `/projects/${PROJECT}/issues/7/thread?before=never`), 400);
  });
});

test("ThreadBook: a deferred removal whose thread already went drops the turn's stored messages and its pending entry", async () => {
  const store = new InMemoryConversationStore();
  const threads = new ThreadBook({ store });
  const old = threads.current("greeter", "Ann", issueChat(7)).conversationId;
  threads.deferIssueRemoval("greeter", 7, old, new Date(Date.now() + 60_000));
  // The thread goes another way (rotated full) while its turn still runs; the turn then saves.
  threads.noteContextTokens("greeter", old, 900);
  assert.equal(await threads.admit("greeter", old, 1000), "rotated");
  const at = new Date();
  await store.save({ id: old, messages: [{ role: "user", content: "late" }], turns: [], status: "done", createdAt: at, updatedAt: at });
  await threads.turnEnded("greeter", old);
  assert.equal(await store.get(old), null, "no orphaned store entry");
});

test("v1: an issue closed while its turn runs keeps its thread until the turn ends; then nothing of it is stored", () => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  return withEdge({ models: [mockModel([{ kind: "text", text: "working" }], { hold })], issues: { 7: { state: "open" } } }, async (edge) => {
    const tok = await edge.token();
    const seven = await current(edge, tok, "?area=issues&focus[kind]=issue&focus[id]=7");
    const turn = await json<{ turnId: string }>(await send(edge, tok, seven, "summarise it"));
    edge.tools.setIssueState(7, "closed");
    const closed = await call(edge, `/v1/projects/${PROJECT}/conversations/current?area=issues&focus[kind]=issue&focus[id]=7`, tok);
    assert.equal(closed.status, 409);
    assert.equal((await json<{ code: string }>(closed)).code, "issue_closed");
    assert.equal((await send(edge, tok, seven, "again")).status, 409);
    assert.notEqual(edge.threads.chatOf(PROJECT, seven), null, "the running turn keeps its thread");
    release();
    await streamOf(edge, tok, turn.turnId);
    await until(() => edge.threads.chatOf(PROJECT, seven) === null, "the removal at the turn's end");
    for (let i = 0; i < 50 && (await edge.store.get(seven)) !== null; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(await edge.store.get(seven), null, "no orphaned store entry");
  });
});

test("v1: a main turn refused at its launch leaves the Issues chat's notes for the next main turn", () =>
  withEdge({ models: [] }, async (edge) => {
    const tok = await edge.token();
    const main = await current(edge, tok);
    edge.threads.noteOutcome(PROJECT, "Filed #3: Save fails");
    const held = edge.tools.holdLookups();
    const before = edge.tools.lookups.length;
    const sent = send(edge, tok, main, "what happened?");
    await until(() => edge.tools.lookups.length === before + 1, "the start to reach its lookup");
    edge.turns.refuse();
    held.release();
    assert.equal((await sent).status, 503);
    assert.deepEqual(edge.threads.takeBranchNotes(PROJECT), [{ area: "issues", turns: 1, outcome: "Filed #3: Save fails" }]);
  }));
