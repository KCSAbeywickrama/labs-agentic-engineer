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

// The `/chat` contract every platform ai-agent speaks (skills/agent-building)
// and every calling web app relies on (skills/react-webapp), pinned against
// the real AI SDK rather than described in prose. Two claims the skills make
// that a caller silently breaks on if false:
//
//   1. `messages` must be the FULL conversation — history in, then the trail —
//      because `memory.type: client` stores only what the agent returns.
//   2. `messages` is not renderable: after a tool step the assistant's
//      `content` is a parts array, and the tool message's always is. So the
//      reply must come from `text`.
//
// This drives one real generateText turn through a mock model that makes a
// tool call, then asserts the exact shape a compliant agent returns. If an SDK
// upgrade changes the ModelMessage layout, this fails before a generated agent
// does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateText, stepCountIs, tool, type ModelMessage } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

/** The exact return statement skills/agent-building prescribes. */
function agentResponse(
  history: ModelMessage[],
  result: {
    text: string;
    toolCalls: readonly unknown[];
    steps: ReadonlyArray<{ response: { messages: ModelMessage[] } }>;
  },
) {
  return {
    text: result.text,
    toolCalls: result.toolCalls,
    messages: [...history, ...result.steps.flatMap((s) => s.response.messages)],
  };
}

type Generated = Awaited<ReturnType<MockLanguageModelV3["doGenerate"]>>;

const usage: Generated["usage"] = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function toolCallingModel() {
  let call = 0;
  return new MockLanguageModelV3({
    doGenerate: async (): Promise<Generated> => {
      call += 1;
      if (call === 1) {
        return {
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "listHotels",
              input: JSON.stringify({ city: "Paris" }),
            },
          ],
          warnings: [],
        };
      }
      return {
        finishReason: { unified: "stop", raw: undefined },
        usage,
        content: [{ type: "text", text: "I found the Ritz in Paris." }],
        warnings: [],
      };
    },
  });
}

test("chat contract: messages is the full conversation, and the reply lives in text", async () => {
  const history: ModelMessage[] = [{ role: "user", content: "find me a hotel in Paris" }];

  const result = await generateText({
    model: toolCallingModel(),
    messages: history,
    tools: {
      listHotels: tool({
        inputSchema: z.object({ city: z.string() }),
        execute: async () => [{ id: "h1", name: "Ritz" }],
      }),
    },
    stopWhen: stepCountIs(5),
  });

  const res = agentResponse(history, result);

  // Claim 1 — the caller can replace its history with `messages` and lose nothing.
  assert.equal(res.messages[0], history[0], "the caller's own turn is first");
  assert.equal(res.messages.at(-1)?.role, "assistant", "the reply is last");
  assert.ok(
    res.messages.some((m) => m.role === "tool"),
    "the tool result is in the trail — an agent given only its prose re-looks-up",
  );

  // Claim 2 — `messages` is state, not display.
  const assistantAfterTool = res.messages.find(
    (m) => m.role === "assistant" && Array.isArray(m.content),
  );
  assert.ok(assistantAfterTool, "an assistant entry carries a parts array, not a string");
  const toolMsg = res.messages.find((m) => m.role === "tool");
  assert.ok(Array.isArray(toolMsg?.content), "a tool entry's content is always an array");

  // ...which is exactly why the reply must be read from `text`.
  assert.equal(res.text, "I found the Ritz in Paris.");
  assert.equal(res.toolCalls.length, 1);
  assert.equal((res.toolCalls[0] as { toolName: string }).toolName, "listHotels");
});

test("chat contract: a caller that renders only string content from messages shows nothing", async () => {
  // The bug that shipped: filter `messages` for string `content` and render.
  const history: ModelMessage[] = [{ role: "user", content: "find me a hotel in Paris" }];
  const result = await generateText({
    model: toolCallingModel(),
    messages: history,
    tools: {
      listHotels: tool({
        inputSchema: z.object({ city: z.string() }),
        execute: async () => [{ id: "h1", name: "Ritz" }],
      }),
    },
    stopWhen: stepCountIs(5),
  });
  const trailOnly = result.steps.flatMap((s) => s.response.messages);

  const rendered = trailOnly.filter(
    (m) => m.role === "assistant" && typeof m.content === "string",
  );

  // Every assistant/tool entry produced by a tool-using turn is a parts array,
  // so the "render messages" strategy shows an empty transcript — and, having
  // replaced its history with the trail alone, it has dropped the user's own
  // message too. This is the failure the skills now forbid.
  assert.equal(rendered.length, 0);
});
