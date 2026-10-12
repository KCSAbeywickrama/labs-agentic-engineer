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
 * A project's chats. The project's main (spec) chat, and one per area (a
 * main-panel page whose chat has a sub-agent of its own, `areas/profiles.ts`):
 * the Issues area's, and that area narrowed to each open issue by a focus.
 * Each chat has its own current thread (`thread-book.ts`) and runs one turn
 * at a time (`turns/turn-desk.ts`), apart from the others: an Issues turn
 * never waits on the spec chat, nor one issue's on another's.
 */

import { isAreaId, type AreaId, type Focus, type FocusKind } from "@aep/agent-stream";
import { AREAS, type AreaProfile } from "../areas/profiles.js";

/** An area's chat, narrowed to a focus or not. */
export interface AreaChat {
  area: AreaId;
  focus?: Focus;
}

/** The main chat (no area), or an area's. */
export type Chat = { area?: undefined; focus?: undefined } | AreaChat;

/** The project's main (spec) chat. */
export const MAIN_CHAT: Chat = {};

/** The Issues area's chat focused on issue `number`. */
export function issueChat(number: number): AreaChat {
  return { area: "issues", focus: { kind: "issue", id: number } };
}

/** The issue a chat is focused on, if it is. */
export function issueOf(chat: Chat): number | undefined {
  return chat.focus?.kind === "issue" ? chat.focus.id : undefined;
}

/**
 * The chat's key within its project, the thread's use case: `""` (main), the
 * area's id for its own chat (`issues`), `<kind>-<id>` for a focused one
 * (`issue-12`).
 */
export function chatKey(chat: Chat): string {
  if (chat.area === undefined) return "";
  return chat.focus === undefined ? chat.area : `${chat.focus.kind}-${chat.focus.id}`;
}

/** The query a request names no chat by (a 400 `invalid_chat`). */
export class ChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatError";
  }
}

const FOCUS_ID_RE = /^[1-9][0-9]{0,8}$/;

/**
 * The chat a request's query names: no `area` is the main chat; `area` alone
 * that area's own chat; `area` with `focus[kind]` and `focus[id]` (the
 * contract's deepObject focus) the area narrowed to that entity. Refused
 * (`ChatError`): an area outside `profiles`, a focus without an area, a focus
 * of a kind the area's profile does not declare, and an id that is not a
 * positive integer.
 */
export function chatFromQuery(query: Record<string, unknown>, profiles: Readonly<Record<AreaId, AreaProfile>> = AREAS): Chat {
  const { area } = query;
  const kind = query["focus[kind]"];
  const id = query["focus[id]"];
  if (query.focus !== undefined) throw new ChatError("focus is sent as focus[kind] and focus[id]");
  const focused = kind !== undefined || id !== undefined;
  if (area === undefined) {
    if (focused) throw new ChatError("a focus is taken only with an area");
    return MAIN_CHAT;
  }
  if (!isAreaId(area) || !Object.hasOwn(profiles, area)) throw new ChatError(`unknown area ${JSON.stringify(area)}`);
  if (!focused) return { area };
  if (typeof kind !== "string" || !Object.hasOwn(profiles[area].focus ?? {}, kind)) {
    throw new ChatError(`the ${area} area takes no focus of kind ${JSON.stringify(kind)}`);
  }
  if (typeof id !== "string" || !FOCUS_ID_RE.test(id)) throw new ChatError("focus[id] must be a positive integer");
  return { area, focus: { kind: kind as FocusKind, id: Number(id) } };
}
