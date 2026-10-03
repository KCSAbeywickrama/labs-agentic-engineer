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

import { PROTOTYPE_COMMAND, prototypeCommand } from "@aep/contracts/commands";
import { canSend, chatStore, useProjectChat } from "../agent-chat/useProjectChat";
import type { PrototypeFeedback } from "../agent-chat/turnScope";
import { useChatPanel } from "../shell/chatPanel";

/**
 * The prototype's two agent turns: Make (or Update) prototype, and a review's
 * Send all. Each is a `/prototype` turn in the project's chat: the chat opens
 * (that is where the agent says what it does) and the message goes. While a
 * turn runs they wait, as the composer does.
 */
export function usePrototypeTurns(projectName: string): {
  /** Make or update one web application's prototype, or every one's (none named). */
  make: (component?: string) => void;
  /** Send a review's requests as one revision; resolves false when it was not sent. */
  sendFeedback: (feedback: PrototypeFeedback) => Promise<boolean>;
  /** Whether one can start now: the chat is loaded and no turn is running. */
  ready: boolean;
} {
  const chat = useProjectChat(projectName);
  const panel = useChatPanel();
  return {
    ready: canSend(chat),
    make: (component) => {
      panel.open();
      const line = component ? prototypeCommand(component) : PROTOTYPE_COMMAND;
      void chatStore.send(projectName, line, { kind: "prototype" });
    },
    sendFeedback: async (feedback) => {
      panel.open();
      return chatStore.send(projectName, prototypeCommand(feedback.component), { kind: "prototype", feedback });
    },
  };
}
