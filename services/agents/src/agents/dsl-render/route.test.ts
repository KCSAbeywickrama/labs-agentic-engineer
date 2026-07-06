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
 * Real-fetch integration test for `POST /internal/v1/dsl/render` — boots the
 * real Express app (a mock model is supplied only because `createApp`
 * requires one; this route never touches it) and asserts the exact org-less,
 * plain-JSON wire contract aep-api's `RenderDsl` (`client.go`) reads: a
 * `200 {excalidraw}` on success, `400 {error}` on a malformed body or a
 * transform failure. No SSE — this is the one route in the service that
 * isn't a stream.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { LanguageModel } from "ai";
import type { ExcalidrawScene } from "@aep/excalidraw-dsl";
import { createApp } from "../../server.js";
import { listen0 } from "../../shared/listen.js";
import { InMemoryConversationStore } from "../../store/memory-store.js";
import { mockModel } from "../../shared/mock-model.js";
import { registerDslRender } from "./route.js";

async function boot(model: LanguageModel = mockModel([{ kind: "text", text: "unused" }])) {
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

test("POST /internal/v1/dsl/render (wireframes) → 200 {excalidraw} that parses to a valid Excalidraw scene", async () => {
  const { baseUrl, close } = await boot();
  try {
    const dsl = 'screen Home\n  text "Welcome" 20,8\n  button "Continue" 20,60 160x40';
    const res = await fetch(`${baseUrl}/internal/v1/dsl/render`, jsonPost({ kind: "wireframes", dsl }));
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.headers.get("content-type") ?? "", /text\/event-stream/);

    const body = (await res.json()) as { excalidraw: string };
    const scene = JSON.parse(body.excalidraw) as ExcalidrawScene;
    assert.equal(scene.type, "excalidraw");
    assert.ok(Array.isArray(scene.elements) && scene.elements.length > 0);
  } finally {
    await close();
  }
});

test("POST /internal/v1/dsl/render (domain-model) → 200 {excalidraw} that parses to a valid Excalidraw scene", async () => {
  const { baseUrl, close } = await boot();
  try {
    const dsl = "entity User\n  id: uuid\n  email: string\n";
    const res = await fetch(`${baseUrl}/internal/v1/dsl/render`, jsonPost({ kind: "domain-model", dsl }));
    assert.equal(res.status, 200);

    const body = (await res.json()) as { excalidraw: string };
    const scene = JSON.parse(body.excalidraw) as ExcalidrawScene;
    assert.equal(scene.type, "excalidraw");
    assert.ok(Array.isArray(scene.elements) && scene.elements.length > 0);
  } finally {
    await close();
  }
});

test("POST /internal/v1/dsl/render → 400 with the exact error string on an invalid kind", async () => {
  const { baseUrl, close } = await boot();
  try {
    const res = await fetch(`${baseUrl}/internal/v1/dsl/render`, jsonPost({ kind: "not-a-kind", dsl: "x" }));
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "kind must be 'wireframes' or 'domain-model'; dsl must be a string");
  } finally {
    await close();
  }
});

test("POST /internal/v1/dsl/render → 400 with the exact error string when dsl is not a string", async () => {
  const { baseUrl, close } = await boot();
  try {
    const res = await fetch(`${baseUrl}/internal/v1/dsl/render`, jsonPost({ kind: "wireframes", dsl: 123 }));
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "kind must be 'wireframes' or 'domain-model'; dsl must be a string");
  } finally {
    await close();
  }
});

test("POST /internal/v1/dsl/render → 400 {error} when the transform throws", async () => {
  // `@aep/excalidraw-dsl`'s `dslToExcalidraw` is a total function — it never
  // throws for any hand-authored (even malformed) DSL string, so this
  // exercises the route's catch branch via the deps-injected `transform`
  // seam (see route.ts's `DslRenderDeps`) rather than a contrived DSL input.
  // The HTTP round trip (real Express app, real fetch) is otherwise identical
  // to the production wiring in server.ts.
  const app = express();
  app.use(express.json());
  registerDslRender(app, {
    transform: () => {
      throw new Error("boom: simulated transform failure");
    },
  });
  const { baseUrl, close } = await listen0(app.listen(0));
  try {
    const res = await fetch(`${baseUrl}/internal/v1/dsl/render`, jsonPost({ kind: "wireframes", dsl: "screen A\n" }));
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "boom: simulated transform failure");
  } finally {
    await close();
  }
});
