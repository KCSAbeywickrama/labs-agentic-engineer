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
 * The Issues chat's `classify_report` tool (`tools/classify-report.ts`): asks
 * aep-api, over the Issues chat's MCP route, what kind of report a message is
 * (aep-api asks Jev with the platform's key, which the pod never holds), and
 * decides here whether the agent must ask. Every failure degrades to
 * "unknown, ask": a classifier outage never fails a turn.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyReport, buildClassifyReportTool, CLASSIFY_REPORT } from "../src/tools/classify-report.js";
import type { McpTransport } from "../src/shared/mcp-client.js";
import { FakeToolsSocket } from "../src/tools-socket/fake.js";
import { mcpRoute } from "../src/shared/mcp-client.js";
import { issuesMcpPath } from "../src/conversations/issue-state.js";

const UNKNOWN = { kind: "unknown", confidence: 0, alternatives: [], needsClarification: true };

/** An Issues route whose classify_report answers `result` (a JSON-RPC result), recording each call's arguments. */
function route(result: unknown | (() => never)) {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const transport: McpTransport = {
    mcpFetch: (async (_path: unknown, init?: RequestInit) => {
      const req = JSON.parse(String(init?.body)) as { id: number; params: { name: string; arguments: Record<string, unknown> } };
      calls.push(req.params);
      if (typeof result === "function") (result as () => never)();
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  };
  return { transport, calls };
}

const answered = (cls: unknown) => ({ content: [{ type: "text", text: JSON.stringify(cls) }] });

test("asks the Issues route's classify_report with the message and the earlier ones", async () => {
  const { transport, calls } = route(answered({ kind: "bug", confidence: 1, alternatives: [{ kind: "bug", p: 1 }] }));
  await classifyReport(transport, { message: "the save button does nothing", recentMessages: ["hi"] });
  assert.deepEqual(calls, [{ name: CLASSIFY_REPORT, arguments: { message: "the save button does nothing", recentMessages: ["hi"] } }]);
});

test("a confident bug files without clarification", async () => {
  const { transport } = route(answered({ kind: "bug", confidence: 1, alternatives: [{ kind: "bug", p: 1 }, { kind: "feature", p: 0 }] }));
  const r = await classifyReport(transport, { message: "m" });
  assert.deepEqual(r, { kind: "bug", confidence: 1, alternatives: [{ kind: "bug", p: 1 }, { kind: "feature", p: 0 }], needsClarification: false });
});

test("below 0.8 asks; exactly 0.8 does not; a question never files", async () => {
  const low = await classifyReport(route(answered({ kind: "improvement", confidence: 0.75, alternatives: [] })).transport, { message: "m" });
  assert.equal(low.needsClarification, true);
  assert.deepEqual(low.alternatives, [{ kind: "improvement", p: 0.75 }], "no alternatives: the kind alone");
  assert.equal((await classifyReport(route(answered({ kind: "feature", confidence: 0.8, alternatives: [] })).transport, { message: "m" })).needsClarification, false);
  const q = await classifyReport(route(answered({ kind: "question", confidence: 0.97, alternatives: [] })).transport, { message: "m" });
  assert.equal(q.kind, "question");
  assert.equal(q.needsClarification, true);
});

test("unknown, a tool error, a malformed answer, a dead socket or no route -> unknown", async () => {
  assert.deepEqual(await classifyReport(route(answered({ kind: "unknown", confidence: 0, alternatives: [] })).transport, { message: "m" }), UNKNOWN);
  assert.deepEqual(await classifyReport(route({ content: [{ type: "text", text: "no" }], isError: true }).transport, { message: "m" }), UNKNOWN);
  assert.deepEqual(await classifyReport(route(answered({ kind: "chore", confidence: 1 })).transport, { message: "m" }), UNKNOWN);
  assert.deepEqual(await classifyReport(route({ content: [{ type: "text", text: "<html>" }] }).transport, { message: "m" }), UNKNOWN);
  const dead = route(() => {
    throw new TypeError("socket closed");
  });
  assert.deepEqual(await classifyReport(dead.transport, { message: "m" }), UNKNOWN);
  assert.deepEqual(await classifyReport(undefined, { message: "m" }), UNKNOWN);
});

test("through the tools socket fake: the Issues route classifies, an issue's route never offers it", async () => {
  const tools = new FakeToolsSocket({ projects: {}, skillsSha: "s", classification: { kind: "feature", confidence: 0.9, alternatives: [{ kind: "feature", p: 0.9 }] } });
  const r = await classifyReport(mcpRoute(tools, issuesMcpPath("greeter")), { message: "add CSV export" });
  assert.equal(r.kind, "feature");
  assert.equal(r.needsClarification, false);
  assert.ok(tools.toolCalls.some((c) => c.name === CLASSIFY_REPORT && c.route === "/projects/greeter/issues/mcp"));
  const off = new FakeToolsSocket({ projects: {}, skillsSha: "s" });
  assert.deepEqual(await classifyReport(mcpRoute(off, issuesMcpPath("greeter")), { message: "m" }), UNKNOWN, "no key on the install");
});

test("the tool classifies through the same path and validates its input", async () => {
  const { transport, calls } = route(answered({ kind: "bug", confidence: 1, alternatives: [] }));
  const t = buildClassifyReportTool(transport);
  const out = await t.execute!({ message: "it crashes" }, { toolCallId: "c1", messages: [], context: {} });
  assert.equal((out as { kind: string }).kind, "bug");
  assert.equal(calls[0]!.arguments.message, "it crashes");
  const schema = t.inputSchema as { safeParse: (v: unknown) => { success: boolean } };
  assert.equal(schema.safeParse({ message: "" }).success, false);
  assert.equal(schema.safeParse({ message: "x", recentMessages: Array(7).fill("a") }).success, false);
});
