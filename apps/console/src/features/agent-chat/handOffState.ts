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

import { areaCommand, type AreaId } from "@aep/agent-stream";
import type { ProjectChat } from "./chatStore";
import type { TurnScope } from "./turnScope";

// What became of a hand-off the main chat announced, and the move Open <area>
// makes. The choice is this browser's: it is kept in localStorage, keyed by
// the project and the hand-off's call, and reads as pending wherever the
// browser keeps nothing (the card then offers the choice again).

export type HandOffState = "pending" | "continued" | "stayed";

const key = (projectName: string, toolCallId: string) => `aep:handoff:${projectName}:${toolCallId}`;

/** The user's choice on a hand-off; pending until they made one here. */
export function getHandOff(projectName: string, toolCallId: string): HandOffState {
  try {
    const kept = localStorage.getItem(key(projectName, toolCallId));
    return kept === "continued" || kept === "stayed" ? kept : "pending";
  } catch {
    return "pending";
  }
}

export function setHandOff(projectName: string, toolCallId: string, state: HandOffState): void {
  try {
    localStorage.setItem(key(projectName, toolCallId), state);
  } catch {
    /* not kept: the card shows the choice until the page goes */
  }
}

/**
 * The message a hand-off's request goes to the area's chat as: the area's
 * command (`/issue` for Issues) in the request's words. The request is the
 * model's, not typed by the user, so it must never reach the area's agent as a
 * bare message: one that reads `Answer to "File this issue?": File it` would
 * pass its go-ahead gate. A command never does, and the Issues agent drafts
 * it and asks before filing. A request that already starts with the command
 * keeps one.
 */
export function areaRequest(area: AreaId, request: string): string {
  const command = areaCommand(area);
  const words = request.trim();
  const rest = words.slice(command.length);
  const leading = words.startsWith(command) && (rest === "" || /^\s/.test(rest));
  return `${command} ${leading ? rest.trimStart() : words}`;
}

/** What the move asks of the area chat's store. */
interface AreaChatStore {
  open: (projectName: string) => Promise<void>;
  get: (projectName: string) => ProjectChat;
  send: (projectName: string, text: string, scope: TurnScope) => Promise<boolean>;
}

/**
 * Take a request on to an area's chat, as the area's command
 * (`areaRequest`): once its conversation has loaded (`open` resolves when it
 * is ready or failed), send it as its next message when it can take one;
 * otherwise (a turn running there, a thread that would not load, a send the
 * server refused) put it in that chat's composer, so the user's words are not
 * lost and nothing is sent unasked.
 */
export async function continueInArea(
  projectName: string,
  area: AreaId,
  request: string,
  deps: { store: AreaChatStore; compose: (text: string) => void },
): Promise<"sent" | "composed"> {
  const { store, compose } = deps;
  const message = areaRequest(area, request);
  await store.open(projectName);
  const chat = store.get(projectName);
  if (chat.status === "ready" && chat.turn.phase === "idle" && (await store.send(projectName, message, { kind: "product" }))) {
    return "sent";
  }
  compose(message);
  return "composed";
}
