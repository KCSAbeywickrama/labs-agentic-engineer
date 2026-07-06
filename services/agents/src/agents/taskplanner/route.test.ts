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
 * Full-route SSE integration for the task-planner endpoints — boots the real
 * Express app with MOCK models (no tokens) and asserts the exact wire frames
 * aep-api's task_stream parses. This is the deterministic cutover gate.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { LanguageModel } from "ai";
import { createApp } from "../../server.js";
import { listen0 } from "../../shared/listen.js";
import { InMemoryConversationStore } from "../../store/memory-store.js";
import { mockModel, mockObjectArrayModel } from "../../shared/mock-model.js";

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
function parseFrames(text: string): Array<{ type: string; data?: Record<string, unknown> }> {
  const out: Array<{ type: string; data?: Record<string, unknown> }> = [];
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

const PLAN_BODY = {
  projectName: "orders",
  spec: "# Orders",
  mode: "fresh",
  slimDesign: [
    { name: "orders-api", componentType: "service", language: "Go", dependsOn: [] },
    { name: "orders-web", componentType: "webapp", language: "TypeScript", dependsOn: ["orders-api"] },
  ],
};

test("POST task-planner/plan streams data-plan-item frames + data-plan-complete + [DONE]", async () => {
  const model = mockObjectArrayModel(
    [
      { componentName: "orders-api", title: "Build the orders API", rationale: "core service", dependsOn: [] },
      {
        componentName: "orders-web",
        title: "Build the orders web app",
        rationale: "UI over the API",
        dependsOn: ["Build the orders API"],
      },
    ],
    4, // chunked so the seal-rule advances progressively
  );
  const { baseUrl, close } = await boot(model);
  try {
    const res = await fetch(`${baseUrl}${"/internal/v1/agents/task-planner/plan"}`, jsonPost(PLAN_BODY));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.equal(res.headers.get("x-vercel-ai-ui-message-stream"), "v1");

    const text = await res.text();
    assert.match(text, /data: \[DONE\]/);

    const frames = parseFrames(text);
    const items = frames.filter((f) => f.type === "data-plan-item").map((f) => f.data!);
    assert.equal(items.length, 2);
    // Exactly the planItemFrame field set aep-api reads.
    assert.deepEqual(Object.keys(items[0]!).sort(), ["componentName", "dependsOn", "rationale", "tempId", "title"]);
    assert.equal(items[0]!.tempId, "p-0");
    assert.equal(items[1]!.tempId, "p-1");
    // Consumer carries the provider's title in dependsOn (ordering topology).
    assert.deepEqual(items[1]!.dependsOn, ["Build the orders API"]);

    assert.ok(frames.some((f) => f.type === "data-plan-complete"));
    assert.ok(!frames.some((f) => f.type === "error"));
  } finally {
    await close();
  }
});

test("POST task-planner/plan emits a plan-scope error frame (not plan-complete) on validator issues", async () => {
  // Unknown component → validatePlan flags unknown-component.
  const model = mockObjectArrayModel([
    { componentName: "ghost", title: "T", rationale: "r", dependsOn: [] },
  ]);
  const { baseUrl, close } = await boot(model);
  try {
    const res = await fetch(`${baseUrl}/internal/v1/agents/task-planner/plan`, jsonPost(PLAN_BODY));
    assert.equal(res.status, 200);
    const frames = parseFrames(await res.text());
    const err = frames.find((f) => f.type === "error");
    assert.ok(err, "expected an error frame");
    assert.equal((err!.data as { scope: string }).scope, "plan");
    assert.ok(!frames.some((f) => f.type === "data-plan-complete"));
  } finally {
    await close();
  }
});

test("POST task-planner/plan → 400 on a malformed body (pre-stream)", async () => {
  const { baseUrl, close } = await boot(mockObjectArrayModel([]));
  try {
    const res = await fetch(`${baseUrl}/internal/v1/agents/task-planner/plan`, jsonPost({ projectName: "x" }));
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});

test("POST task-planner/detail streams task-body-delta + task-body-complete + [DONE]", async () => {
  const model = mockModel([{ kind: "text", text: "## Overview\nBuild it.\n" }]);
  const { baseUrl, close } = await boot(model);
  try {
    const res = await fetch(
      `${baseUrl}/internal/v1/agents/task-planner/detail`,
      jsonPost({
        projectName: "orders",
        spec: "# Orders",
        items: [
          {
            taskId: "t1",
            componentName: "orders-api",
            title: "Build the orders API",
            rationale: "core",
            designSlice: '{"name":"orders-api"}',
            depSummaries: [],
            existingTitlesForComponent: [],
          },
        ],
      }),
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-vercel-ai-ui-message-stream"), "v1");
    const frames = parseFrames(await res.text());

    const complete = frames.find((f) => f.type === "data-task-body-complete");
    assert.ok(complete, "expected a task-body-complete frame");
    assert.equal((complete!.data as { taskId: string }).taskId, "t1");
    assert.match((complete!.data as { body: string }).body, /## Overview/);
    // At least one delta streamed before completion.
    assert.ok(frames.some((f) => f.type === "data-task-body-delta"));
  } finally {
    await close();
  }
});

test("POST task-planner/detail → 400 on a malformed body", async () => {
  const { baseUrl, close } = await boot(mockModel([{ kind: "text", text: "x" }]));
  try {
    const res = await fetch(
      `${baseUrl}/internal/v1/agents/task-planner/detail`,
      jsonPost({ projectName: "x", spec: "y", items: [{ taskId: "t1" }] }),
    );
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});
