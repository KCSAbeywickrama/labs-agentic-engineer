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
import { runConversationTurn, TurnGuard, ConcurrentTurnError } from "./run-conversation-turn.js";
import { InMemoryConversationStore } from "../store/memory-store.js";
import type { Conversation } from "../store/conversation-store.js";
import { SEED_FILES } from "../agents/main/prompt.js";
import type { StreamPart } from "@aep/agent-stream";
import { sha256Hex } from "../shared/hash.js";
import { mockModel, type MockStep } from "../shared/mock-model.js";
import { testSkillSource } from "../testing/skill-source.js";

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

test("skills: loadSkill is registered over the skillSource, executes server-side, and its body reaches history", async () => {
  const store = new InMemoryConversationStore();
  const guard = new TurnGuard();
  const { events, onEvent } = collector();

  const model = mockModel([
    { kind: "toolCall", toolCallId: "s1", toolName: "loadSkill", input: { names: ["component-architecture"] } },
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
    skillSource: testSkillSource([
      { name: "component-architecture", description: "deriving components", content: "Components live at specs/design/components/<name>/design.md." },
    ]),
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

test("toolset task-plan runs planTask over the read-only snapshot (no file mutation)", async () => {
  const store = new InMemoryConversationStore();
  const guard = new TurnGuard();
  const { events, onEvent } = collector();

  // hello-api is a known component in SEED_FILES; the accumulator validates it.
  const model = mockModel([
    { kind: "toolCall", toolCallId: "p1", toolName: "planTask", input: { component: "hello-api", title: "Build hello-api", dependsOn: [], rationale: "core." } },
    { kind: "text", text: "planned" },
  ]);

  const conv = await runConversationTurn({
    id: "plan1",
    instruction: "plan the tasks",
    files: SEED_FILES,
    toolset: "task-plan",
    model,
    store,
    guard,
    onEvent,
  });

  assert.equal(conv.status, "done");
  const planned = events.find((e) => e.type === "tool-result" && e.toolName === "planTask");
  assert.ok(planned, "planTask executed server-side and streamed a result");
  assert.match(JSON.stringify(planned.output), /"ok":true/);
  // No file mutation tool ever ran.
  assert.equal(events.some((e) => e.toolName === "addFile" || e.toolName === "editFile"), false);
});

// --- The terminal manifest (D14) ---------------------------------------------

/** The manifest frame, asserted to be the LAST emitted event of the turn. */
function lastManifest(events: StreamPart[]): StreamPart {
  const last = events.at(-1);
  assert.ok(last, "turn emitted events");
  assert.equal(last.type, "manifest", `last event must be the manifest, got ${last.type}`);
  assert.equal(events.filter((e) => e.type === "manifest").length, 1, "exactly one manifest per turn");
  return last;
}

test("manifest: an applied edit yields touched-path → sha256 of the FINAL content", async () => {
  const store = new InMemoryConversationStore();
  const guard = new TurnGuard();
  const { events, onEvent } = collector();

  await runConversationTurn({ id: "m1", instruction: "rename", files: SEED_FILES, model: editModel(), store, guard, onEvent });

  const manifest = lastManifest(events);
  const expected = SEED_FILES[OPENAPI]!.replace('example: "Hello, World!"', 'example: "Hi there!"');
  assert.deepEqual(manifest.files, { [OPENAPI]: sha256Hex(expected) });
  assert.deepEqual(manifest.deleted, []);
});

test("manifest: a removed file lands in deleted; an added file is hashed", async () => {
  const store = new InMemoryConversationStore();
  const guard = new TurnGuard();
  const { events, onEvent } = collector();

  const model = mockModel([
    { kind: "toolCall", toolCallId: "r1", toolName: "removeFile", input: { path: OPENAPI } },
    { kind: "toolCall", toolCallId: "a1", toolName: "addFile", input: { path: "specs/notes.md", content: "note\n" } },
    { kind: "text", text: "done" },
  ]);
  await runConversationTurn({ id: "m2", instruction: "restructure", files: SEED_FILES, model, store, guard, onEvent });

  const manifest = lastManifest(events);
  assert.deepEqual(manifest.deleted, [OPENAPI]);
  assert.deepEqual(manifest.files, { "specs/notes.md": sha256Hex("note\n") });
});

test("manifest: a chat-only turn emits the EMPTY manifest (files toolset)", async () => {
  const store = new InMemoryConversationStore();
  const guard = new TurnGuard();
  const { events, onEvent } = collector();

  await runConversationTurn({ id: "m3", instruction: "just talk", files: SEED_FILES, model: textModel("hi"), store, guard, onEvent });

  const manifest = lastManifest(events);
  assert.deepEqual(manifest.files, {});
  assert.deepEqual(manifest.deleted, []);
});

test("manifest: a task-plan turn emits the EMPTY manifest (nothing mutates)", async () => {
  const store = new InMemoryConversationStore();
  const guard = new TurnGuard();
  const { events, onEvent } = collector();

  const model = mockModel([
    { kind: "toolCall", toolCallId: "p1", toolName: "planTask", input: { component: "hello-api", title: "Build hello-api", dependsOn: [], rationale: "core." } },
    { kind: "text", text: "planned" },
  ]);
  await runConversationTurn({ id: "m4", instruction: "plan", files: SEED_FILES, toolset: "task-plan", model, store, guard, onEvent });

  const manifest = lastManifest(events);
  assert.deepEqual(manifest.files, {});
  assert.deepEqual(manifest.deleted, []);
});

test("manifest: a rejected/noop op does not appear (touched = applied only)", async () => {
  const store = new InMemoryConversationStore();
  const guard = new TurnGuard();
  const { events, onEvent } = collector();

  const model = mockModel([
    // NOT_FOUND edit (rejected) + idempotent remove of an absent path (noop).
    { kind: "toolCall", toolCallId: "e1", toolName: "editFile", input: { path: OPENAPI, oldString: "no such anchor", newString: "x" } },
    { kind: "toolCall", toolCallId: "r1", toolName: "removeFile", input: { path: "specs/absent.md" } },
    { kind: "text", text: "done" },
  ]);
  await runConversationTurn({ id: "m5", instruction: "try", files: SEED_FILES, model, store, guard, onEvent });

  const manifest = lastManifest(events);
  assert.deepEqual(manifest.files, {});
  assert.deepEqual(manifest.deleted, []);
});

test("manifest: NOT emitted when the turn throws (severed/failed stream carries no manifest)", async () => {
  const guard = new TurnGuard();
  const { events, onEvent } = collector();
  const failingStore = {
    get: async (): Promise<Conversation | null> => null,
    save: async (): Promise<void> => {
      throw new Error("db down");
    },
  };

  await assert.rejects(
    runConversationTurn({ id: "m6", instruction: "x", files: SEED_FILES, model: textModel("ok"), store: failingStore, guard, onEvent }),
    /db down/,
  );
  assert.equal(events.some((e) => e.type === "manifest"), false, "no manifest on a failed turn");
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
