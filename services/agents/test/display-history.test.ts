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
 * `projectDisplayHistory` (#463): the get-conversation read serves the turn
 * journal's raw client-sent text for user rows — never the composed model
 * prompt — with a tail-anchored pairing so pre-journal turns fall back to
 * their raw stored content.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { projectDisplayHistory } from "../src/conversation/display-history.js";
import type { Conversation, TurnJournalEntry } from "../src/store/conversation-store.js";

const PROMPT_1 = "The following skill guidance is ALREADY LOADED…\n\n## Skill: start\n\nExisting files:…\n\nInstruction: /start";
const PROMPT_2 = "Existing files:…\n\nInstruction: Answers: …";

function entry(turnId: string, text: string, author?: string): TurnJournalEntry {
  return { turnId, kind: "chat", text, ...(author ? { author } : {}), createdAt: new Date("2026-01-01T00:00:00Z") };
}

function conv(messages: Conversation["messages"], turns: TurnJournalEntry[]): Conversation {
  return {
    id: "c1",
    messages,
    turns,
    status: "done",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

test("user rows carry the journal text + author; assistant rows pass through", () => {
  const out = projectDisplayHistory(
    conv(
      [
        { role: "user", content: PROMPT_1 },
        { role: "assistant", content: "made the PRD" },
      ],
      [entry("t1", "/start", "Admin")],
    ),
  );
  assert.deepEqual(out[0], { role: "user", content: "/start", author: "Admin" });
  assert.deepEqual(out[1], { role: "assistant", content: "made the PRD" });
});

test("pre-journal user rows fall back to their raw content (tail-anchored pairing)", () => {
  const out = projectDisplayHistory(
    conv(
      [
        { role: "user", content: PROMPT_1 }, // legacy turn: no entry
        { role: "assistant", content: "a" },
        { role: "user", content: PROMPT_2 }, // journaled turn
        { role: "assistant", content: "b" },
      ],
      [entry("t2", "Answers: lunch at noon")],
    ),
  );
  assert.equal((out[0] as { content: string }).content, PROMPT_1, "legacy turn stays raw");
  assert.deepEqual(out[2], { role: "user", content: "Answers: lunch at noon" });
});

test("a journal-less conversation projects byte-identically", () => {
  const messages: Conversation["messages"] = [
    { role: "user", content: PROMPT_1 },
    { role: "assistant", content: "a" },
  ];
  assert.deepEqual(projectDisplayHistory(conv(messages, [])), messages);
});

test("author is omitted, not empty, when the journal has none", () => {
  const out = projectDisplayHistory(conv([{ role: "user", content: PROMPT_1 }], [entry("t1", "hi")]));
  assert.deepEqual(out[0], { role: "user", content: "hi" });
  assert.ok(!("author" in (out[0] as object)));
});
