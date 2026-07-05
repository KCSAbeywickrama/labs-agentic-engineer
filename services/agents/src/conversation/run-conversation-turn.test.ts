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
import { createServer } from "node:http";
import { runConversationTurn, TurnGuard, ConcurrentTurnError } from "./run-conversation-turn.js";
import { InMemoryConversationStore } from "../store/memory-store.js";
import { SEED_FILES } from "../agents/main/prompt.js";
import type { StreamPart } from "../agents/main/stream-types.js";
import { mockModel, type MockStep } from "../shared/mock-model.js";
import { listen0 } from "../shared/listen.js";

const OPENAPI = "specs/design/components/hello-api/openapi.yaml";

function collector(): { events: StreamPart[]; onEvent: (p: StreamPart) => void } {
  const events: StreamPart[] = [];
  return { events, onEvent: (p) => events.push(p) };
}

function textModel(text: string) {
  return mockModel([{ kind: "text", text }]);
}

function editModel(): ReturnType<typeof mockModel> {
  const steps: MockStep[] = [
    {
      kind: "toolCall",
      toolCallId: "c1",
      toolName: "editFile",
      input: { path: OPENAPI, oldString: 'example: "Hello, World!"', newString: 'example: "Hi there!"' },
    },
    { kind: "text", text: "done" },
  ];
  return mockModel(steps);
}

test("lazy-creates, runs server-side execute, persists, status done", async () => {
  const store = new InMemoryConversationStore();
  const guard = new TurnGuard();
  const { events, onEvent } = collector();

  const conv = await runConversationTurn({
    id: "conv1",
    instruction: "rename the hello message",
    files: SEED_FILES,
    model: editModel(),
    store,
    guard,
    onEvent,
  });

  assert.equal(conv.status, "done");
  assert.ok(events.some((e) => e.type === "tool-result"), "events streamed through onEvent");

  const stored = await store.get("conv1");
  assert.ok(stored);
  assert.equal(stored.status, "done");
  assert.ok(stored.messages.some((m) => m.role === "user"));
  assert.ok(stored.messages.some((m) => m.role === "tool"));
});

test("append-only across turns (resume on the same id)", async () => {
  const store = new InMemoryConversationStore();
  const guard = new TurnGuard();
  const { onEvent } = collector();

  await runConversationTurn({ id: "c", instruction: "one", files: SEED_FILES, model: textModel("a"), store, guard, onEvent });
  const afterFirst = (await store.get("c"))!.messages.length;

  await runConversationTurn({ id: "c", instruction: "two", files: SEED_FILES, model: textModel("b"), store, guard, onEvent });
  const stored = (await store.get("c"))!;

  assert.ok(stored.messages.length > afterFirst, "history grew");
  assert.equal(stored.messages[0]?.role, "user", "turn one's first user message preserved");
});

test("prepends the CURRENT-STATE-authoritative note when filesChangedExternally", async () => {
  const store = new InMemoryConversationStore();
  const guard = new TurnGuard();
  const { onEvent } = collector();

  await runConversationTurn({
    id: "c",
    instruction: "x",
    files: SEED_FILES,
    filesChangedExternally: true,
    model: textModel("ok"),
    store,
    guard,
    onEvent,
  });

  const firstUser = (await store.get("c"))!.messages.find((m) => m.role === "user");
  const content =
    typeof firstUser?.content === "string" ? firstUser.content : JSON.stringify(firstUser?.content);
  assert.match(content, /files were changed outside/);
});

test("default turn (no flag) carries no divergence note", async () => {
  const store = new InMemoryConversationStore();
  const guard = new TurnGuard();
  const { onEvent } = collector();

  await runConversationTurn({ id: "c", instruction: "x", files: SEED_FILES, model: textModel("ok"), store, guard, onEvent });

  const firstUser = (await store.get("c"))!.messages.find((m) => m.role === "user");
  const content =
    typeof firstUser?.content === "string" ? firstUser.content : JSON.stringify(firstUser?.content);
  assert.doesNotMatch(content, /files were changed outside/);
});

test("skills: loadSkill is registered, executes server-side, and its body reaches history", async () => {
  const store = new InMemoryConversationStore();
  const guard = new TurnGuard();
  const { events, onEvent } = collector();

  const model = mockModel([
    { kind: "toolCall", toolCallId: "s1", toolName: "loadSkill", input: { name: "component-architecture" } },
    {
      kind: "toolCall",
      toolCallId: "c1",
      toolName: "editFile",
      input: { path: OPENAPI, oldString: 'example: "Hello, World!"', newString: 'example: "Hi there!"' },
    },
    { kind: "text", text: "done" },
  ]);

  const conv = await runConversationTurn({
    id: "skilled",
    instruction: "derive a component using the skill",
    files: SEED_FILES,
    skills: [
      { name: "component-architecture", description: "deriving components", content: "Components live at specs/design/components/<name>/design.md." },
    ],
    model,
    store,
    guard,
    onEvent,
  });

  assert.equal(conv.status, "done");
  const loaded = events.find((e) => e.type === "tool-result" && e.toolName === "loadSkill");
  assert.ok(loaded, "loadSkill executed server-side and streamed a result");
  assert.match(JSON.stringify(loaded.output), /specs\/design\/components/);

  // The loaded body persists as a tool result in history (continuity across turns).
  const stored = await store.get("skilled");
  assert.match(JSON.stringify(stored!.messages), /specs\/design\/components/);
});

test("mcp omitted: no MCP fetch is attempted; tool set unchanged (byte-identical to today)", async () => {
  const store = new InMemoryConversationStore();
  const guard = new TurnGuard();
  const { onEvent } = collector();

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    fetchCalls++;
    return originalFetch(...args);
  }) as typeof fetch;
  try {
    const conv = await runConversationTurn({
      id: "no-mcp",
      instruction: "rename the hello message",
      files: SEED_FILES,
      model: editModel(),
      store,
      guard,
      onEvent,
    });
    assert.equal(conv.status, "done");
    assert.equal(fetchCalls, 0, "an mcp-free turn never calls fetch — no discovery round trip");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mcp: discovered tools merge into the turn's tool set and execute server-side", async () => {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c));
    req.on("end", () => {
      const { id, method } = JSON.parse(raw || "{}") as { id: unknown; method: string };
      res.writeHead(200, { "content-type": "application/json" });
      if (method === "tools/list") {
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              tools: [
                {
                  name: "list_external_resources",
                  description: "list registered external resources",
                  inputSchema: { type: "object", properties: {} },
                },
              ],
            },
          }),
        );
      } else if (method === "tools/call") {
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: '{"externalResources":[{"name":"openweather"}]}' }] },
          }),
        );
      } else {
        res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } }));
      }
    });
  });
  const { baseUrl, close } = await listen0(server.listen(0));

  try {
    const store = new InMemoryConversationStore();
    const guard = new TurnGuard();
    const { events, onEvent } = collector();

    const model = mockModel([
      { kind: "toolCall", toolCallId: "m1", toolName: "list_external_resources", input: {} },
      { kind: "text", text: "done" },
    ]);

    const conv = await runConversationTurn({
      id: "mcp-conv",
      instruction: "what external resources exist?",
      files: SEED_FILES,
      mcp: { url: baseUrl, token: "tok-abc" },
      model,
      store,
      guard,
      onEvent,
    });

    assert.equal(conv.status, "done");
    const result = events.find((e) => e.type === "tool-result" && e.toolName === "list_external_resources");
    assert.ok(result, "the MCP-discovered tool executed server-side and streamed a result");
    assert.match(JSON.stringify(result.output), /openweather/);
  } finally {
    await close();
  }
});

test("a concurrent turn for the same id rejects with ConcurrentTurnError (409 source)", async () => {
  const store = new InMemoryConversationStore();
  const guard = new TurnGuard();
  const { onEvent } = collector();

  const p1 = runConversationTurn({ id: "c", instruction: "a", files: SEED_FILES, model: textModel("a"), store, guard, onEvent });
  const p2 = runConversationTurn({ id: "c", instruction: "b", files: SEED_FILES, model: textModel("b"), store, guard, onEvent });

  await assert.rejects(p2, (e) => e instanceof ConcurrentTurnError);
  await p1;

  // After release, a fresh turn on the same id works again.
  await runConversationTurn({ id: "c", instruction: "c", files: SEED_FILES, model: textModel("c"), store, guard, onEvent });
  assert.ok((await store.get("c"))!.messages.length >= 4);
});
