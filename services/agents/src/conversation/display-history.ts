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
 * Display projection of a conversation (#463). The stored transcript's user
 * messages are COMPOSED MODEL PROMPTS (eager skill bodies + inlined files +
 * framing) — correct as the model's memory, wrong as a chat bubble. The
 * get-conversation read serves this projection instead: user rows carry the
 * turn journal's raw client-sent text + author; assistant/tool rows pass
 * through untouched (the UI projects their text and question tool-calls).
 *
 * Pairing is TAIL-ANCHORED: a turn appends exactly one user message and one
 * journal entry in the same save, but pre-journal turns appended messages with
 * no entry — so the LAST n user messages pair with the n entries, and earlier
 * user messages fall back to their raw stored content (a presence check, never
 * prompt-convention parsing).
 */

import type { ModelMessage } from "ai";
import type { Conversation } from "../store/conversation-store.js";

/** A transcript message as served on the wire: user rows may carry an author. */
export type DisplayMessage = ModelMessage | { role: "user"; content: string; author?: string };

export function projectDisplayHistory(conv: Conversation): DisplayMessage[] {
  const turns = conv.turns ?? [];
  const userCount = conv.messages.filter((m) => m.role === "user").length;
  let userIndex = 0;
  return conv.messages.map((m): DisplayMessage => {
    if (m.role !== "user") return m;
    // The i-th user message from the END pairs with the i-th entry from the
    // END; a negative index (pre-journal turn) reads as undefined → raw.
    const entry = turns[turns.length - userCount + userIndex];
    userIndex++;
    if (!entry) return m;
    return {
      role: "user",
      content: entry.text,
      ...(entry.author ? { author: entry.author } : {}),
    };
  });
}
