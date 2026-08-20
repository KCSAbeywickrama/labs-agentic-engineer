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

import { client } from "../../../api/client";
import { apiErrorMessage } from "../../../api/errors";

// One agent turn on the wire (ADR-0020): the caller holds the issued
// conversationId and its own rendered transcript, and nothing else. No message
// array crosses the wire in either direction.
export interface ChatTurn {
  conversationId?: string;
  message: string;
}

export interface ChatWireReply {
  conversationId: string;
  text: string;
  toolCalls: unknown[];
}

/**
 * The outcome of one send, already reduced to the cases the tester renders.
 * The invoke call itself answering 200 only means the relay happened — the
 * agent's own status rides inside, so upstream and invoke-level failures are
 * separate variants here rather than one merged "error".
 */
export type ChatResult =
  | ({ kind: "reply" } & ChatWireReply)
  | { kind: "conversation-expired" }
  | { kind: "session-expired" }
  | { kind: "upstream-error"; status: number; body: string }
  | { kind: "not-reachable" }
  | { kind: "invoke-error"; message: string };

export async function sendChat(
  projectName: string,
  componentName: string,
  turn: ChatTurn,
): Promise<ChatResult> {
  const { data, error, response } = await client.POST(
    "/projects/{projectName}/components/{componentName}/invoke",
    {
      params: { path: { projectName, componentName } },
      body: {
        method: "POST",
        path: "/chat",
        contentType: "application/json",
        // An absent conversationId is omitted rather than sent as null: the
        // contract starts a new conversation on an omitted id.
        body: JSON.stringify(
          turn.conversationId
            ? { conversationId: turn.conversationId, message: turn.message }
            : { message: turn.message },
        ),
      },
    },
  );

  if (!data) {
    if (response?.status === 409) return { kind: "not-reachable" };
    return {
      kind: "invoke-error",
      message: apiErrorMessage(error, "Failed to reach the agent"),
    };
  }

  if (data.status === 404) return { kind: "conversation-expired" };
  if (data.status === 401) return { kind: "session-expired" };
  if (data.status !== 200) {
    return { kind: "upstream-error", status: data.status, body: data.body };
  }

  const reply = parseReply(data.body);
  return reply
    ? { kind: "reply", ...reply }
    : // A 200 the tester cannot read is still evidence — show it raw rather
      // than swallowing it into a generic failure.
      { kind: "upstream-error", status: 200, body: data.body };
}

function parseReply(body: string): ChatWireReply | null {
  try {
    const parsed = JSON.parse(body) as Partial<ChatWireReply>;
    if (typeof parsed.text !== "string" || typeof parsed.conversationId !== "string") {
      return null;
    }
    return {
      conversationId: parsed.conversationId,
      text: parsed.text,
      toolCalls: Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [],
    };
  } catch {
    return null;
  }
}
