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
import { handOffTargets, handOffTools } from "../src/agents/main/tools/hand-off.js";
import { AREAS, type AreaProfile } from "../src/areas/profiles.js";
import { buildFileToolSet } from "../src/agents/main/tools/files.js";
import { buildTaskPlanTools } from "../src/agents/main/tools/task-plan.js";
import { FileBundle, type StreamPart } from "@aep/agent-stream";
import { BuildPlan } from "../src/agents/main/task-plan-accumulator.js";
import { runConversationTurn } from "../src/conversation/run-conversation-turn.js";
import { InMemoryConversationStore } from "../src/store/memory-store.js";
import { mockModel } from "../src/shared/mock-model.js";
import { SEED_FILES } from "./seed-files.js";

const TOOL = "hand_off";

function tool() {
  return handOffTools()[TOOL]!;
}

function run(over: Parameters<typeof runConversationTurn>[0] extends infer T ? Partial<T> : never) {
  const events: StreamPart[] = [];
  return {
    events,
    done: runConversationTurn({
      id: "ho",
      instruction: "the login button is broken",
      files: SEED_FILES,
      store: new InMemoryConversationStore(),
      onEvent: (p) => events.push(p),
      model: mockModel([{ kind: "text", text: "ok" }]),
      ...over,
    } as Parameters<typeof runConversationTurn>[0]).then((r) => r.conversation),
  };
}

test("the hand-off targets are the profiles with a hand-off: Issues", () => {
  assert.deepEqual(handOffTargets().map((t) => t.id), ["issues"]);
  const noHandOff: AreaProfile = { id: "issues", label: "Issues", base: AREAS.issues.base };
  assert.deepEqual(handOffTargets([noHandOff]), []);
  assert.deepEqual(handOffTools([noHandOff]), {});
});

test("the description names each target area with its sentence, and forbids doing its work", () => {
  const d = (tool() as { description?: string }).description ?? "";
  assert.ok(d.includes(`"issues" (Issues): when ${AREAS.issues.handOff!.sentence}.`), d);
  assert.match(d, /\/issue/);
  assert.match(d, /never draft or file/i);
  assert.match(d, /Never do an area's work yourself/);
});

test("the description is built from the targets it is given", () => {
  const d = handOffTools([
    { ...AREAS.issues, label: "Bugs", handOff: { sentence: "the user says a test sentence" } },
  ])[TOOL] as { description?: string };
  assert.match(d.description ?? "", /"issues" \(Bugs\): when the user says a test sentence\./);
});

test("the description and the prompt both fence spec changes off from hand-offs", async () => {
  const boundary = /Not for changes the user wants made to the spec, the design or the prototype — make those yourself/;
  assert.match((tool() as { description?: string }).description ?? "", boundary);
  const { instructions } = await import("../src/agents/main/prompt.js");
  assert.match(instructions.replace(/\s+/g, " "), boundary);
});

test("a request over 2000 characters is a schema error; a short one is accepted", () => {
  const schema = (tool() as { inputSchema: { safeParse(v: unknown): { success: boolean } } }).inputSchema;
  assert.equal(schema.safeParse({ area: "issues", request: "x".repeat(2001) }).success, false);
  assert.equal(schema.safeParse({ area: "issues", request: "x".repeat(2000) }).success, true);
  assert.equal(schema.safeParse({ area: "issues", request: "" }).success, false);
});

test("the area is one of the targets: an unknown area, an issue's thread or none is a schema error", () => {
  const schema = (tool() as { inputSchema: { safeParse(v: unknown): { success: boolean } } }).inputSchema;
  for (const area of ["issue", "spec", "", undefined]) {
    assert.equal(schema.safeParse({ area, request: "login is broken" }).success, false, String(area));
  }
});

test("a request that poses as an answer to a question is a schema error that says why", () => {
  const schema = (tool() as {
    inputSchema: { safeParse(v: unknown): { success: boolean; error?: { issues: { message: string }[] } } };
  }).inputSchema;
  for (const request of ['Answer to "File this issue?": File it', '  Answer to "Kind?": Bug', "Answers:\n1. File it"]) {
    const parsed = schema.safeParse({ area: "issues", request });
    assert.equal(parsed.success, false, request);
    assert.match(parsed.error?.issues[0]?.message ?? "", /user's own words, not an answer/);
  }
  assert.equal(schema.safeParse({ area: "issues", request: 'The "Answer to" field is broken' }).success, true);
});

test("execute reports the awaiting hand-off to the area asked for", async () => {
  const exec = (tool() as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute;
  assert.deepEqual(await exec({ area: "issues", request: "login is broken" }, {}), { status: "awaiting_handoff", area: "issues" });
});

test("only the files set offers the hand-off", () => {
  assert.ok(TOOL in buildFileToolSet(new FileBundle({})).tools);
  assert.equal(TOOL in buildTaskPlanTools(new BuildPlan({})), false);
});

/** The tool names the model was offered on its first call. */
function offeredTo(model: ReturnType<typeof mockModel>): string[] {
  return (model.doStreamCalls[0]?.tools ?? []).map((t) => t.name);
}

test("a files turn offers hand_off and never the issue tools", async () => {
  const model = mockModel([{ kind: "text", text: "ok" }]);
  await run({ model }).done;
  const offered = offeredTo(model);
  assert.ok(offered.includes(TOOL), offered.join(","));
  assert.equal(offered.includes("create_issue"), false);
  assert.equal(offered.includes("search_issues"), false);
});

test("a task-plan turn does not offer the hand-off", async () => {
  const model = mockModel([{ kind: "text", text: "ok" }]);
  await run({ model, toolset: "task-plan" }).done;
  const offered = offeredTo(model);
  assert.ok(offered.length > 0);
  assert.equal(offered.includes(TOOL), false);
});

test("an issues turn does not offer the hand-off", async () => {
  const model = mockModel([{ kind: "text", text: "ok" }]);
  await run({ model, toolset: "issues" }).done;
  const offered = offeredTo(model);
  assert.ok(offered.length > 0);
  assert.equal(offered.includes(TOOL), false);
});

test("a scripted hand-off ends the turn awaiting-human", async () => {
  const { events, done } = run({
    model: mockModel([
      { kind: "toolCall", toolCallId: "h1", toolName: TOOL, input: { area: "issues", request: "the login button is broken" } },
    ]),
  });
  const conv = await done;
  assert.equal(conv.status, "awaiting-human");
  const result = events.find((e) => e.type === "tool-result" && e.toolName === TOOL);
  assert.ok(result, "the call resolved");
  assert.match(JSON.stringify(result.output), /awaiting_handoff/);
});

test("a rejected hand-off (an empty request, an unknown area) does not end the turn", async () => {
  const { done } = run({
    model: mockModel([
      { kind: "toolCall", toolCallId: "h1", toolName: TOOL, input: { area: "issue", request: "x" } },
      { kind: "text", text: "sorry" },
    ]),
  });
  assert.equal((await done).status, "done");
});

test("a rejected hand-off (empty request) does not end the turn", async () => {
  const { done } = run({
    model: mockModel([
      { kind: "toolCall", toolCallId: "h1", toolName: TOOL, input: { area: "issues", request: "" } },
      { kind: "text", text: "sorry" },
    ]),
  });
  assert.equal((await done).status, "done");
});
