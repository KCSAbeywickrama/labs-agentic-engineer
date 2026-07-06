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
 * Full-route SSE integration for the document-generation endpoint — boots
 * the real Express app with a MOCK model (no tokens) and asserts the EXACT
 * wire frames aep-api's `requirements_service.go` (`StreamGenerate`) and the
 * console's `generateRequirementFile` client parse: `text-delta` (`delta`,
 * optional `replace`), `finish` (optional `siblings`), and `error`
 * (`errorText`). This is the deterministic cutover gate.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { LanguageModel } from "ai";
import { createApp } from "../../server.js";
import { listen0 } from "../../shared/listen.js";
import { InMemoryConversationStore } from "../../store/memory-store.js";
import { mockModel } from "../../shared/mock-model.js";

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

interface Frame {
  type: string;
  delta?: string;
  replace?: boolean;
  errorText?: string;
  siblings?: Record<string, string>;
}

/** Parse `data: {json}` SSE lines into frame objects (ignores comments/[DONE]). */
function parseFrames(text: string): Frame[] {
  const out: Frame[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice("data: ".length);
    if (payload === "[DONE]") continue;
    try {
      out.push(JSON.parse(payload) as Frame);
    } catch {
      /* keep-alive or partial — ignore */
    }
  }
  return out;
}

test("POST document-generation/requirements-from-prompt streams text-delta* + finish + [DONE]", async () => {
  const doc = "# Overview\nA todo app for small teams.\n\n# Personas\n- member — manages their own tasks.\n\n# Features\n- A member adds a task.\n";
  const { baseUrl, close } = await boot(mockModel([{ kind: "text", text: doc }]));
  try {
    const res = await fetch(
      `${baseUrl}/internal/v1/agents/document-generation/requirements-from-prompt`,
      jsonPost({ prompt: "A todo app for small teams." }),
    );
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.equal(res.headers.get("x-vercel-ai-ui-message-stream"), "v1");

    const text = await res.text();
    assert.match(text, /data: \[DONE\]/);

    const frames = parseFrames(text);
    assert.ok(!frames.some((f) => f.type === "error"), "no error frame expected");

    const deltas = frames.filter((f) => f.type === "text-delta" && !f.replace);
    assert.ok(deltas.length > 0, "expected at least one text-delta frame");
    const accumulated = deltas.map((f) => f.delta ?? "").join("");
    assert.equal(accumulated, doc);

    // requirements-from-prompt has no postProcess — exactly one bare finish,
    // no siblings, and no replace:true delta.
    const finishes = frames.filter((f) => f.type === "finish");
    assert.equal(finishes.length, 1);
    assert.equal(finishes[0]!.siblings, undefined);
    assert.ok(!frames.some((f) => f.type === "text-delta" && f.replace === true));

    // finish comes after every delta (the [DONE] terminator check above
    // already proves the stream closed cleanly).
    const lastDeltaIdx = frames.map((f) => f.type).lastIndexOf("text-delta");
    const finishIdx = frames.map((f) => f.type).indexOf("finish");
    assert.ok(finishIdx > lastDeltaIdx, "finish must come after the last text-delta");
  } finally {
    await close();
  }
});

test("POST document-generation/{unknownSkill} → 404 error shape aep-api's client.go reads as a non-200 body", async () => {
  const { baseUrl, close } = await boot(mockModel([{ kind: "text", text: "x" }]));
  try {
    const res = await fetch(
      `${baseUrl}/internal/v1/agents/document-generation/not-a-real-skill`,
      jsonPost({ prompt: "hello" }),
    );
    assert.equal(res.status, 404);
    // Pre-stream failure — no SSE headers were ever sent.
    assert.doesNotMatch(res.headers.get("content-type") ?? "", /text\/event-stream/);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "unknown skill: not-a-real-skill");
  } finally {
    await close();
  }
});

test("POST document-generation/requirements-from-prompt → 400 on a malformed body (pre-stream, no SSE headers)", async () => {
  const { baseUrl, close } = await boot(mockModel([{ kind: "text", text: "x" }]));
  try {
    const res = await fetch(
      `${baseUrl}/internal/v1/agents/document-generation/requirements-from-prompt`,
      // `sources` values must be strings — 123 fails DocumentGenerationRequestBody.
      jsonPost({ sources: { "requirements.md": 123 } }),
    );
    assert.equal(res.status, 400);
    assert.doesNotMatch(res.headers.get("content-type") ?? "", /text\/event-stream/);
  } finally {
    await close();
  }
});

test("POST document-generation/wireframes: DSL streams, then a replace text-delta carries the Excalidraw JSON + finish carries the .dsl sibling", async () => {
  // No trailing newline in the raw model output — the postProcessor's
  // `stripFences` trims and re-appends exactly one, so the `.dsl` sibling
  // below is asserted as `dsl + "\n"`.
  const dsl = 'screen Home\n  text "Welcome" 20,8\n  button "Continue" 20,60 160x40';
  const { baseUrl, close } = await boot(mockModel([{ kind: "text", text: dsl }]));
  try {
    const res = await fetch(
      `${baseUrl}/internal/v1/agents/document-generation/wireframes`,
      jsonPost({ sources: { "requirements.md": "# Overview\nA todo app.\n" } }),
    );
    assert.equal(res.status, 200);
    const frames = parseFrames(await res.text());
    assert.ok(!frames.some((f) => f.type === "error"), "no error frame expected");

    // Live DSL deltas, concatenating back to the raw model output.
    const liveDeltas = frames.filter((f) => f.type === "text-delta" && !f.replace);
    assert.equal(liveDeltas.map((f) => f.delta ?? "").join(""), dsl);

    // The bare (natural) finish comes before the post-processed replace delta.
    const types = frames.map((f) => f.type);
    const bareFinishIdx = types.indexOf("finish");
    const replaceIdx = frames.findIndex((f) => f.type === "text-delta" && f.replace === true);
    assert.ok(bareFinishIdx >= 0 && replaceIdx > bareFinishIdx, "bare finish must precede the replace delta");

    // The replace delta carries the rendered Excalidraw scene.
    const replaceFrame = frames[replaceIdx]!;
    const scene = JSON.parse(replaceFrame.delta ?? "") as { type: string; elements: unknown[] };
    assert.equal(scene.type, "excalidraw");
    assert.ok(scene.elements.length > 0);

    // A second finish frame carries the `.dsl` sibling (the source of truth
    // alongside the rendered `.excalidraw`).
    const siblingFinish = frames.find((f) => f.type === "finish" && f.siblings !== undefined);
    assert.ok(siblingFinish, "expected a finish frame with siblings");
    assert.equal(siblingFinish!.siblings!["wireframes.dsl"], dsl + "\n");
  } finally {
    await close();
  }
});
