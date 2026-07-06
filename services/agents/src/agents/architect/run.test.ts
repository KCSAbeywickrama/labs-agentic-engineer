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
 * The `isAnthropicModel` gate + its OBSERVABLE consequence on the assembled
 * architect tool set: the provider-executed `web_search` tool is injected iff
 * the resolved model is an Anthropic model (injecting it against another
 * provider errors, so it must degrade silently). We assert this against the
 * EXACT tools the model was handed (`MockLanguageModelV4.doStreamCalls`), not
 * just a side effect — no real model call, no tokens.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { LanguageModel } from "ai";
import { runArchitect, isAnthropicModel } from "./run.js";
import type { SseSink, FinalizeResolver } from "./tools.js";
import type { ArchitectInput } from "./schema.js";
import { mockModel } from "../../shared/mock-model.js";

test("isAnthropicModel: true for a model whose provider starts with 'anthropic'", () => {
  const model = { provider: "anthropic.messages", modelId: "claude-sonnet-4-6" } as unknown as LanguageModel;
  assert.equal(isAnthropicModel(model), true);
});

test("isAnthropicModel: false for a non-Anthropic provider", () => {
  const model = { provider: "openai.chat", modelId: "gpt-5" } as unknown as LanguageModel;
  assert.equal(isAnthropicModel(model), false);
});

test("isAnthropicModel: false when provider is absent or not a string", () => {
  assert.equal(isAnthropicModel({} as unknown as LanguageModel), false);
  assert.equal(isAnthropicModel({ provider: 42 } as unknown as LanguageModel), false);
});

const INPUT: ArchitectInput = { projectName: "orders", spec: "# Orders" };

/** A no-op sink + finalizer so `runArchitect` can drive a single model call. */
function harness(): { sink: SseSink; finalizer: FinalizeResolver } {
  return {
    sink: { send() {}, isClosed: () => false },
    finalizer: { finalized: false, resolve() {} },
  };
}

/** The tool names the model was actually handed on its first call. */
function toolNames(model: { doStreamCalls: Array<{ tools?: unknown }> }): string[] {
  const tools = (model.doStreamCalls[0]?.tools ?? []) as Array<{ name?: string; id?: string }>;
  return tools.map((t) => t.name ?? t.id ?? "");
}

test("web_search IS injected into the tool set for an Anthropic model", async () => {
  const model = mockModel([{ kind: "text", text: "thinking" }], { provider: "anthropic.messages" });
  const { sink, finalizer } = harness();
  await runArchitect({ model, input: INPUT, sink, finalizer, abortSignal: new AbortController().signal });

  const names = toolNames(model);
  assert.ok(
    names.some((n) => n === "web_search" || n.includes("web_search")),
    `expected web_search in the tool set, got: ${names.join(", ")}`,
  );
  // The design tools are always present alongside it.
  assert.ok(names.includes("set_overview") && names.includes("add_component") && names.includes("finalize"));
});

test("web_search is NOT injected for a non-Anthropic model (silent degrade)", async () => {
  const model = mockModel([{ kind: "text", text: "thinking" }]); // default mock-provider
  const { sink, finalizer } = harness();
  await runArchitect({ model, input: INPUT, sink, finalizer, abortSignal: new AbortController().signal });

  const names = toolNames(model);
  assert.ok(!names.some((n) => n === "web_search" || n.includes("web_search")), `web_search must be absent, got: ${names.join(", ")}`);
  // The design tools are still there — only the provider tool is gated off.
  assert.ok(names.includes("set_overview") && names.includes("add_component"));
});

test("extraTools (MCP discovery) merge into the tool set without shadowing design tools", async () => {
  const { tool } = await import("ai");
  const { z } = await import("zod");
  const model = mockModel([{ kind: "text", text: "thinking" }]);
  const { sink, finalizer } = harness();
  await runArchitect({
    model,
    input: INPUT,
    sink,
    finalizer,
    abortSignal: new AbortController().signal,
    extraTools: {
      list_external_resources: tool({ description: "d", inputSchema: z.object({}), execute: async () => ({}) }),
    },
  });

  const names = toolNames(model);
  assert.ok(names.includes("list_external_resources"), "discovery tool must be present");
  assert.ok(names.includes("finalize"), "core design tools remain present");
});
