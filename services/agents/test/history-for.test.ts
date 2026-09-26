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
 * `historyFor` leaves a conversation written by the current connection exactly
 * as stored — the same array, so the prompt stays byte-identical (the cached
 * prefix holds) and `runTurn`'s in-place append still lands in the transcript.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelMessage } from "ai";
import { historyFor } from "../src/conversation/history-for.js";

const MESSAGES: ModelMessage[] = [
  { role: "user", content: "first" },
  { role: "assistant", content: [{ type: "text", text: "one" }] },
  { role: "user", content: "second" },
  { role: "assistant", content: [{ type: "text", text: "two" }] },
];

test("every fingerprint matching returns the stored array itself", () => {
  const journal = [{ connection: "anthropic@ollama.com" }, { connection: "anthropic@ollama.com" }];
  assert.equal(historyFor(MESSAGES, journal, "anthropic@ollama.com"), MESSAGES);
});

test("a turn with no fingerprint counts as anthropic@api.anthropic.com", () => {
  const snapshot = structuredClone(MESSAGES);
  const journal = [{}, { connection: "anthropic@api.anthropic.com" }];
  const out = historyFor(MESSAGES, journal, "anthropic@api.anthropic.com");
  assert.equal(out, MESSAGES);
  assert.deepEqual(out, snapshot, "nothing was rewritten");
});

test("a conversation with no journal is replayed as stored", () => {
  assert.equal(historyFor(MESSAGES, [], "anthropic@api.anthropic.com"), MESSAGES);
});
