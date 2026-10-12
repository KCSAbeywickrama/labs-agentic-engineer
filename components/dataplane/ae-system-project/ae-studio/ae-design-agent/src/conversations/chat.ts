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
 * A project's chats. Each view of the console that owns an agent has a chat
 * of its own: the project's main (spec) chat, the Issues page's, and one for
 * each open issue. Each chat has its own current thread (`thread-book.ts`) and
 * runs one turn at a time (`turns/turn-desk.ts`), apart from the others: an
 * Issues turn never waits on the spec chat, nor one issue's on another's.
 */

/** The main chat, the Issues page's (`issues`), or one issue's. */
export type Chat = { view?: undefined } | { view: "issues" } | { view: "issue"; issueNumber: number };

/** The project's main (spec) chat. */
export const MAIN_CHAT: Chat = {};

/** The chat's key within its project: `""` (main), `issues`, `issue-<n>`. */
export function chatKey(chat: Chat): string {
  if (chat.view === undefined) return "";
  return chat.view === "issues" ? "issues" : `issue-${chat.issueNumber}`;
}

/** The view and issue number a request names no chat by (a 400 `invalid_chat`). */
export class ChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatError";
  }
}

const ISSUE_NUMBER_RE = /^[1-9][0-9]{0,8}$/;

/**
 * The chat a request's `view` and `issueNumber` query parameters name: none
 * is the main chat; `issues` the Issues page's; `issue` with a positive
 * `issueNumber` that issue's. A view outside those, an issue number without
 * `view=issue`, or `view=issue` without one throws `ChatError`.
 */
export function chatFromQuery(view: unknown, issueNumber: unknown): Chat {
  if (view === "issue") {
    if (typeof issueNumber !== "string" || !ISSUE_NUMBER_RE.test(issueNumber)) {
      throw new ChatError("issueNumber must be a positive integer with view=issue");
    }
    return { view: "issue", issueNumber: Number(issueNumber) };
  }
  if (issueNumber !== undefined) throw new ChatError("issueNumber is taken only with view=issue");
  if (view === undefined) return MAIN_CHAT;
  if (view === "issues") return { view: "issues" };
  throw new ChatError("view must be issues or issue");
}
