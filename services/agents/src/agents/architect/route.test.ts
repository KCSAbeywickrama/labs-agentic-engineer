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
 * Full-route SSE integration for the architect endpoint — boots the real
 * Express app with a MOCK model (no tokens) and asserts the EXACT wire frames
 * aep-api's `StreamGenerateDesign` parses (`design_service.go`): it proxies
 * every frame downstream but only assembles the design from `data-finish`
 * (`design.overview` + `design.components` as `[]models.DesignComponent`, so
 * each component MUST carry `componentType`/`openAPISpec`) and reads top-level
 * `error.errorText`. This is the deterministic cutover gate.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { LanguageModel } from "ai";
import { createApp } from "../../server.js";
import { listen0 } from "../../shared/listen.js";
import { InMemoryConversationStore } from "../../store/memory-store.js";
import { mockModel, type MockStep } from "../../shared/mock-model.js";

async function boot(model: LanguageModel) {
  const store = new InMemoryConversationStore();
  const app = createApp({ store, model });
  const { baseUrl, close } = await listen0(app.listen(0));
  return { baseUrl, close };
}

const jsonPost = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Parse `data: {json}` SSE lines into frame objects (ignores comments/[DONE]). */
function parseFrames(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice("data: ".length);
    if (payload === "[DONE]") continue;
    try {
      out.push(JSON.parse(payload));
    } catch {
      /* keep-alive or partial — ignore */
    }
  }
  return out;
}

const OPENAPI =
  "openapi: 3.0.3\n" +
  "info:\n  title: orders-api\n  version: 1.0.0\n" +
  "paths:\n  /health:\n    get:\n      responses:\n" +
  '        "200":\n          description: ok\n';

const SLIM = {
  name: "orders-api",
  componentType: "service",
  version: "0.1.0",
  language: "Go",
  dependencies: [],
  entrypoint: "deployment/service",
  buildpack: "docker",
  appPath: "orders-api",
  exposure: "internet",
  description: "Serves customer orders. Does not process payments.",
  componentAgentInstructions: "Implement a Go CRUD service.",
};

/** Drives the architect tool loop to a valid finalize(). */
const DESIGN_STEPS: MockStep[] = [
  { kind: "toolCall", toolCallId: "c0", toolName: "set_overview", input: { text: "Orders platform: one service." } },
  { kind: "toolCall", toolCallId: "c1", toolName: "add_component", input: SLIM },
  { kind: "toolCall", toolCallId: "c2", toolName: "set_openapi", input: { name: "orders-api", contents: OPENAPI } },
  { kind: "toolCall", toolCallId: "c3", toolName: "finalize", input: {} },
  // Defensive trailing step: finalize() aborts the loop, but if the SDK issues
  // one more model call before the abort propagates, it gets a clean stop.
  { kind: "text", text: "done" },
];

test("POST architect streams progress frames + data-finish (design.components carry componentType/openAPISpec) + [DONE]", async () => {
  const { baseUrl, close } = await boot(mockModel(DESIGN_STEPS));
  try {
    const res = await fetch(`${baseUrl}/internal/v1/agents/architect`, jsonPost({ projectName: "orders", spec: "# Orders\nOne service." }));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.equal(res.headers.get("x-vercel-ai-ui-message-stream"), "v1");

    const text = await res.text();
    assert.match(text, /data: \[DONE\]/);

    const frames = parseFrames(text);
    assert.ok(!frames.some((f) => f.type === "error"), "no error frame expected");

    // Progress frames the console renders (proxied downstream by the BFF).
    assert.ok(frames.some((f) => f.type === "data-overview"));
    assert.ok(frames.some((f) => f.type === "data-component-added"));
    assert.ok(frames.some((f) => f.type === "data-component-spec-updating"));

    // The ONE frame the BFF assembles the design from.
    const finish = frames.find((f) => f.type === "data-finish");
    assert.ok(finish, "expected a data-finish frame");
    const design = (finish!.data as { design: { overview: string; components: Array<Record<string, unknown>> } }).design;
    assert.equal(design.overview, "Orders platform: one service.");
    assert.equal(design.components.length, 1);

    const comp = design.components[0]!;
    // The exact fields models.DesignComponent decodes: componentType (NOT
    // `type`) + openAPISpec live on the wire; the Go codec renames/splits them.
    assert.equal(comp.name, "orders-api");
    assert.equal(comp.componentType, "service");
    assert.match(comp.openAPISpec as string, /openapi: 3\.0\.3/);
    assert.deepEqual(comp.dependencies, []);
  } finally {
    await close();
  }
});

test("data-finish dependencies never carry platform-computed status/reason", async () => {
  const withDep = {
    ...SLIM,
    dependencies: [
      { kind: "external", name: "openweather", description: "weather API", config: [{ key: "OPENWEATHER_API_KEY", secret: true }] },
    ],
  };
  const steps: MockStep[] = [
    { kind: "toolCall", toolCallId: "c0", toolName: "set_overview", input: { text: "ov" } },
    { kind: "toolCall", toolCallId: "c1", toolName: "add_component", input: withDep },
    { kind: "toolCall", toolCallId: "c2", toolName: "set_openapi", input: { name: "orders-api", contents: OPENAPI } },
    { kind: "toolCall", toolCallId: "c3", toolName: "finalize", input: {} },
    { kind: "text", text: "done" },
  ];
  const { baseUrl, close } = await boot(mockModel(steps));
  try {
    const res = await fetch(`${baseUrl}/internal/v1/agents/architect`, jsonPost({ projectName: "orders", spec: "# Orders" }));
    const frames = parseFrames(await res.text());
    const finish = frames.find((f) => f.type === "data-finish");
    assert.ok(finish);
    const deps = (finish!.data as { design: { components: Array<{ dependencies: Array<Record<string, unknown>> }> } }).design.components[0]!.dependencies;
    assert.equal(deps.length, 1);
    for (const d of deps) {
      assert.ok(!("status" in d), "dependency must not carry status");
      assert.ok(!("reason" in d), "dependency must not carry reason");
    }
  } finally {
    await close();
  }
});

test("POST architect → 400 on a malformed body (pre-stream, no SSE headers)", async () => {
  const { baseUrl, close } = await boot(mockModel(DESIGN_STEPS));
  try {
    const res = await fetch(`${baseUrl}/internal/v1/agents/architect`, jsonPost({ projectName: "orders" }));
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});

test("architect emits a top-level errorText frame when the loop ends without finalize()", async () => {
  // Model never calls finalize — just talks and stops. runArchitect returns
  // finalized:false, the route emits `{ type:'error', errorText }` (top-level,
  // the shape design_service.go reads).
  const { baseUrl, close } = await boot(mockModel([{ kind: "text", text: "I give up." }]));
  try {
    const res = await fetch(`${baseUrl}/internal/v1/agents/architect`, jsonPost({ projectName: "orders", spec: "# Orders" }));
    assert.equal(res.status, 200);
    const frames = parseFrames(await res.text());
    const err = frames.find((f) => f.type === "error");
    assert.ok(err, "expected an error frame");
    assert.equal(typeof err!.errorText, "string");
    assert.ok(!frames.some((f) => f.type === "data-finish"));
  } finally {
    await close();
  }
});
