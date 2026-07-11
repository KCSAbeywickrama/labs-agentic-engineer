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

// Presentational grouping for the agent chat panel: multiple tool calls that
// hit the same file (e.g. a burst of edits to one design.json) collapse into a
// single disclosure card instead of stacking as N separate rows. Purely a view
// concern — the chat store stays a flat, append-only log.

import type { ChatMessage } from "./chatStore";

/** The tool-card variant of a chat message (the only one carrying a `path`). */
export type ToolMessage = Extract<ChatMessage, { role: "tool" }>;

/** A renderable unit: either a plain message, or a run of same-file tool cards. */
export type ChatItem =
  | { kind: "message"; message: ChatMessage }
  | { kind: "tool-group"; id: string; path: string; tools: ToolMessage[] };

/**
 * Fold the flat message log into render items, merging each *run* of
 * consecutive tool cards that target the same file into one group.
 *
 * Only consecutive same-path tools merge: any non-tool message (narration, a
 * user turn, an error) or a switch to a different file closes the current
 * group. That keeps the timeline order intact — a group never reaches across
 * the text that explains it, and repeated edits to one file (the common case)
 * still coalesce because the agent works a file in a burst. The group's `id`
 * is its first member's id, so it stays stable as later same-file edits stream
 * in and extend the run.
 */
export function groupChatItems(messages: ChatMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  for (const message of messages) {
    if (message.role !== "tool") {
      items.push({ kind: "message", message });
      continue;
    }
    const last = items[items.length - 1];
    if (last?.kind === "tool-group" && last.path === message.path) {
      last.tools.push(message);
    } else {
      items.push({
        kind: "tool-group",
        id: message.id,
        path: message.path,
        tools: [message],
      });
    }
  }
  return items;
}
