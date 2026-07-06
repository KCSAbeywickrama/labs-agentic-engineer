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
 * Unit test for the `isAnthropicModel` gate that decides whether
 * `runArchitect` injects the provider-executed `web_search` tool
 * (Anthropic-only per the AI SDK; injecting it against another provider
 * would error the request, so this must degrade silently rather than
 * assume). Exercised directly against fake `LanguageModel`-shaped objects —
 * no real model call, no tokens.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { LanguageModel } from "ai";
import { isAnthropicModel } from "./run.js";

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
