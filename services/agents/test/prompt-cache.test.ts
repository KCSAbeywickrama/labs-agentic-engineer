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
 * Prompt-cache breakpoints. Anthropic caches nothing unless the request carries
 * a `cache_control` marker, so an unmarked turn re-bills its whole prefix on
 * every step of the tool loop — measured live at ~1.07M input tokens across one
 * 19-step turn, all uncached. These assert the marker reaches the provider and,
 * just as importantly, never reaches the conversation we persist.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelMessage } from "ai";
import { runTurn } from "../src/agents/main/run-turn.js";
import { mockModel } from "../src/shared/mock-model.js";

const BREAKPOINT = { anthropic: { cacheControl: { type: "ephemeral" } } };

/** The prompt the model actually received for `callIndex`. */
function promptAt(model: ReturnType<typeof mockModel>, callIndex: number): ModelMessage[] {
  return model.doStreamCalls[callIndex]!.prompt as unknown as ModelMessage[];
}

test("the cache breakpoint rides the system block and the last message", async () => {
  const model = mockModel([{ kind: "text", text: "Done." }]);
  const messages: ModelMessage[] = [
    { role: "user", content: "earlier turn" },
    { role: "assistant", content: "earlier reply" },
  ];

  await runTurn({
    model,
    instructions: "You are a spec agent.",
    tools: {},
    messages,
    prompt: "this turn",
    cacheBreakpoint: BREAKPOINT,
  });

  const prompt = promptAt(model, 0);
  const system = prompt.filter((m) => m.role === "system");
  assert.equal(system.length, 1, "instructions should reach the model as one system block");
  assert.deepEqual(
    system[0]!.providerOptions,
    BREAKPOINT,
    "the system block carries the breakpoint (it fronts the stable tools+system prefix)",
  );

  // Anthropic caches UP TO the marked block, so marking the final message caches
  // the entire prefix for every later step of this turn's loop.
  const last = prompt[prompt.length - 1]!;
  assert.deepEqual(last.providerOptions, BREAKPOINT, "the last message carries the breakpoint");
});

test("the breakpoint never reaches the persisted conversation", async () => {
  const model = mockModel([{ kind: "text", text: "Done." }]);
  const messages: ModelMessage[] = [{ role: "user", content: "earlier turn" }];

  await runTurn({
    model,
    instructions: "You are a spec agent.",
    tools: {},
    messages,
    prompt: "this turn",
    cacheBreakpoint: BREAKPOINT,
  });

  // `messages` is the aggregate the store writes. A marker left behind here
  // would accumulate one breakpoint per turn and eventually exceed the
  // provider's per-request limit — the failure would surface as a 400 on a
  // long-running conversation, far from this code.
  for (const m of messages) {
    assert.equal(
      m.providerOptions,
      undefined,
      `persisted ${m.role} message must carry no cache marker`,
    );
  }
});

test("no breakpoint leaves the request untouched", async () => {
  const model = mockModel([{ kind: "text", text: "Done." }]);
  const messages: ModelMessage[] = [{ role: "user", content: "earlier turn" }];

  await runTurn({
    model,
    instructions: "You are a spec agent.",
    tools: {},
    messages,
    prompt: "this turn",
  });

  for (const m of promptAt(model, 0)) {
    assert.equal(m.providerOptions, undefined, `${m.role} must be unmarked when caching is off`);
  }
});
