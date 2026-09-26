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
 * `modelProviderOptions` is model-aware: `@ai-sdk/anthropic` forwards `effort`
 * as `output_config.effort` without checking the model, and Haiku 4.5 /
 * Sonnet 4.5 reject it, so their turns carry no provider options at all.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/shared/config.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  anthropicConnection,
  connectionFingerprint,
  createModel,
  DEFAULT_CONNECTION_FINGERPRINT,
  isOfferedModel,
  modelProviderOptions,
  OFFERED_MODELS,
  resolveModelId,
  supportsEffort,
} from "../src/shared/model.js";
import { HostRefusedError } from "../src/shared/guarded-fetch.js";

test("Sonnet 5 turns carry the configured reasoning effort", () => {
  assert.deepEqual(modelProviderOptions("claude-sonnet-5"), { anthropic: { effort: config.reasoningEffort } });
});

test("Haiku 4.5 and Sonnet 4.5 turns carry no effort option", () => {
  assert.equal(modelProviderOptions("claude-haiku-4-5"), undefined);
  assert.equal(modelProviderOptions("claude-haiku-4-5-20251001"), undefined);
  assert.equal(supportsEffort("claude-sonnet-4-5"), false);
  assert.equal(supportsEffort("claude-opus-5"), true);
});

test("resolveModelId: the turn's model wins; none falls back to AGENT_MODEL", () => {
  assert.equal(resolveModelId({ model: "claude-haiku-4-5" }), "claude-haiku-4-5");
  assert.equal(resolveModelId(), config.model);
});

test("OFFERED_MODELS is the contract's AgentModel enum", () => {
  const spec = parse(
    readFileSync(fileURLToPath(new URL("../../../packages/contracts/api/v1/openapi.yaml", import.meta.url)), "utf8"),
  ) as { components: { schemas: { AgentModel: { enum: string[] } } } };
  assert.deepEqual([...OFFERED_MODELS].sort(), [...spec.components.schemas.AgentModel.enum].sort());
  assert.equal(isOfferedModel("claude-opus-5"), false);
});

const KEY = "sk-ant-test-key-000000000000";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch that records each request and answers a minimal Anthropic message. */
function recorder(): { calls: Captured[]; fetch: typeof globalThis.fetch } {
  const calls: Captured[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

test("anthropicConnection is today's connection: Anthropic's API, x-api-key, the resolved model", () => {
  assert.deepEqual(anthropicConnection(KEY, "claude-haiku-4-5"), {
    format: "anthropic",
    baseURL: "https://api.anthropic.com/v1",
    authScheme: "x-api-key",
    apiKey: KEY,
    model: "claude-haiku-4-5",
  });
  assert.equal(anthropicConnection(KEY).model, config.model);
});

// The Anthropic branch must send exactly what the stock provider sends, so
// moving onto the connection changes no request byte (and no cached prefix).
test("createModel on today's connection sends the stock Anthropic provider's request", async () => {
  const ours = recorder();
  const stock = recorder();
  const call = { system: "sys", prompt: "hello", maxOutputTokens: 64 };
  await generateText({ model: createModel(anthropicConnection(KEY, "claude-sonnet-5"), { fetch: ours.fetch }), ...call });
  await generateText({ model: createAnthropic({ apiKey: KEY, fetch: stock.fetch })("claude-sonnet-5"), ...call });
  assert.equal(ours.calls.length, 1);
  assert.deepEqual(ours.calls, stock.calls);
  assert.equal(ours.calls[0]!.url, "https://api.anthropic.com/v1/messages");
  assert.equal(ours.calls[0]!.headers["x-api-key"], KEY);
  assert.equal(ours.calls[0]!.headers.authorization, undefined);
});

test("a bearer connection sends the key as Authorization and no x-api-key", async () => {
  const rec = recorder();
  const conn = { ...anthropicConnection(KEY, "gpt-oss:20b"), baseURL: "https://ollama.com/v1", authScheme: "bearer" as const };
  await generateText({ model: createModel(conn, { fetch: rec.fetch }), prompt: "hello" });
  assert.equal(rec.calls[0]!.url, "https://ollama.com/v1/messages");
  assert.equal(rec.calls[0]!.headers.authorization, `Bearer ${KEY}`);
  assert.equal(rec.calls[0]!.headers["x-api-key"], undefined);
});

test("createModel sends through the host guard by default", async () => {
  // An IP literal is refused at connect, before any byte leaves.
  const conn = { ...anthropicConnection(KEY, "claude-sonnet-5"), baseURL: "https://169.254.169.254/v1" };
  await assert.rejects(generateText({ model: createModel(conn), prompt: "hello", maxRetries: 0 }), (err: unknown) => {
    const chain: unknown[] = [];
    for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) chain.push(e);
    return chain.some((e) => e instanceof HostRefusedError);
  });
});

test("connectionFingerprint is format@host", () => {
  assert.equal(DEFAULT_CONNECTION_FINGERPRINT, "anthropic@api.anthropic.com");
  assert.equal(connectionFingerprint({ format: "anthropic", baseURL: "https://ollama.com" }), "anthropic@ollama.com");
  assert.equal(connectionFingerprint({ format: "anthropic", baseURL: "https://llm.example:8443/v1" }), "anthropic@llm.example:8443");
});
