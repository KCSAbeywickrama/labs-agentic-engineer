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

// The project conversation's two reads on the org's design agent: resolve the
// project's current thread, then read its messages.

import type { components } from "../../../generated/ae-design-agent";
import { designAgentCall } from "../../../api/aeStudio";
import { wireQuery, type ChatRef } from "../chatRef";
import { IssueClosedError } from "./errors";
import { podFailure } from "./turns";

export type ConversationMessage = components["schemas"]["ConversationMessage"];

/**
 * The project's CURRENT thread id (#430): minted by the pod on first read and
 * kept for the project, so every member resolves the same one. Each chat has
 * its own: the Issues area's agent talks on a thread of its own, and so does
 * that area focused on each open issue; a closed issue has none (409
 * `issue_closed`).
 */
export async function fetchCurrentConversationId(projectName: string, chat?: ChatRef): Promise<string> {
  const fallback = "Couldn't open the project conversation";
  const query = wireQuery(chat);
  const { data, error, response } = await designAgentCall(fallback, (agent) =>
    agent.GET("/projects/{projectName}/conversations/current", {
      params: { path: { projectName }, ...(query ? { query } : {}) },
    }),
  );
  if (data === undefined) {
    if (response.status === 409 && (error as { code?: string } | undefined)?.code === "issue_closed") throw new IssueClosedError();
    throw podFailure(error, response, fallback);
  }
  return data.conversationId;
}

/**
 * The thread's history, as the pod persisted it. A turn's messages are
 * persisted when it ends, so a running turn is not in it: the chat attaches
 * to that one's stream instead.
 */
export async function fetchConversationMessages(
  projectName: string,
  conversationId: string,
): Promise<ConversationMessage[]> {
  const fallback = "Couldn't load the conversation";
  const { data, error, response } = await designAgentCall(fallback, (agent) =>
    agent.GET("/projects/{projectName}/conversations/{conversationId}/messages", {
      params: { path: { projectName, conversationId } },
    }),
  );
  if (data === undefined) throw podFailure(error, response, fallback);
  return data.messages;
}
