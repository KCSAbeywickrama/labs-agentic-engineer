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

import type { AreaId, Focus } from "@aep/agent-stream";
import type { ProjectCard, ProjectPage } from "../shell/scope";
import type { TurnBody } from "./turnScope";

// A project has a main chat and a chat per area of the main panel: the Issues
// Page's agent works on a thread of its own, and so does that area narrowed
// to each open issue (its focus), on the issue's card. Each area chat is a
// branch of the main chat, and takes the chat panel while its page is in
// view; everywhere else is the project's main chat. The design agent's
// contract names an area chat by its area and focus (its `area` and `focus`
// query): the main chat is the absence of an area, so it is never named on
// the wire.

/** A project's chat: the main chat (no area), an area's, or an area's narrowed to a focus. */
export type ChatRef = { readonly area?: undefined; readonly focus?: undefined } | { readonly area: AreaId; readonly focus?: Focus };

/** The project's main chat. */
export const MAIN_CHAT: ChatRef = {};

/** The Issues area's own chat, the Issues Page's. */
export const ISSUES_CHAT: ChatRef = { area: "issues" };

/** The Issues area's chat focused on issue `issueNumber`, on its card. */
export function issueChat(issueNumber: number): ChatRef {
  return { area: "issues", focus: { kind: "issue", id: issueNumber } };
}

/** The issue a chat is focused on, if it is. */
export function chatIssue(chat: ChatRef): number | undefined {
  return chat.focus?.kind === "issue" ? chat.focus.id : undefined;
}

/** Whether `a` and `b` are the same chat: the same area, focused on the same entity or on none. */
export function sameChat(a: ChatRef, b: ChatRef): boolean {
  return a.area === b.area && a.focus?.kind === b.focus?.kind && a.focus?.id === b.focus?.id;
}

/** The chat as one string, as its thread's use case reads (`main`, `issues`, `issue-7`): a key that compares by value. */
export function chatKey(chat: ChatRef): string {
  if (chat.area === undefined) return "main";
  return chat.focus === undefined ? chat.area : `${chat.focus.kind}-${chat.focus.id}`;
}

/**
 * The chat this page has: the Issues area's on the Issues Page with no card
 * open, or with its own Questions card open (the card answers this chat's
 * questions); the area focused on an issue on that issue's card, or on the
 * Questions card answering that issue's chat (`issueNumber`). The panel holds
 * it in place of the main chat.
 */
export function chatFor(page: ProjectPage, card: ProjectCard | null, issueNumber: number | null = null): ChatRef {
  if (page !== "issues") return MAIN_CHAT;
  if (card === "issue" || (card === "questions" && issueNumber !== null)) return issueNumber !== null ? issueChat(issueNumber) : MAIN_CHAT;
  return card === null || card === "questions" ? ISSUES_CHAT : MAIN_CHAT;
}

/** The Questions card a chat's questions are answered on (ADR-0002): over the page whose chat asked. */
export function questionsLink(projectName: string, chat: ChatRef) {
  if (chat.area === undefined) return { to: "/projects/$projectName/questions" as const, params: { projectName } };
  const issue = chatIssue(chat);
  return {
    to: "/projects/$projectName/issues/questions" as const,
    params: { projectName },
    ...(issue !== undefined ? { search: { issue } } : {}),
  };
}

/** The page a chat's Questions card closes back to: the one it is over, or the issue's card. */
export function homeLink(projectName: string, chat: ChatRef) {
  const issue = chatIssue(chat);
  if (issue !== undefined) {
    return { to: "/projects/$projectName/issues/$number" as const, params: { projectName, number: String(issue) } };
  }
  if (chat.area === "issues") return { to: "/projects/$projectName/issues" as const, params: { projectName } };
  return { to: "/projects/$projectName" as const, params: { projectName } };
}

/** A chat as the contract's query carries it: absent for the main chat; an area's, with its focus when it has one. */
export function wireQuery(chat?: ChatRef): { area: AreaId; focus?: Focus } | undefined {
  if (chat?.area === undefined) return undefined;
  return { area: chat.area, ...(chat.focus ? { focus: chat.focus } : {}) };
}

/**
 * A turn's body in a chat. An area's sub-agent has no spec room and no scope
 * (the design agent refuses a scope on an area chat's turn), so its turn is
 * the user's words alone: the thread it is sent to names its chat. The main
 * chat's body goes as built.
 */
export function areaTurnBody(chat: ChatRef, body: TurnBody): TurnBody {
  return chat.area === undefined ? body : { instruction: body.instruction };
}
