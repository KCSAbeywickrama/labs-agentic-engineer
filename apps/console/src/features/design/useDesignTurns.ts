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

import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ADDRESS_COMMENTS_COMMAND, designCommand, RECREATE_COMMAND } from "@aep/contracts/commands";
import { canSend, chatStore, useProjectChat } from "../agent-chat/useProjectChat";
import { useProjectStatus } from "../deploy/api/deploy";
import { useSpecWorkspace } from "../spec/useSpecWorkspace";
import { useChatPanel } from "../shell/chatPanel";
import { designKey } from "./api/designModel";
import type { DesignReviewActions } from "./useDesignReview";

/**
 * The design review's two agent turns, from wherever they are offered: the
 * design (Next up, the Design card) and Address comments (the Overview).
 * Each is a turn in the project's chat, scoped to the design review: the
 * chat opens (that is where the agent says what it does), and the message
 * goes. While a turn runs they wait, as the composer does.
 *
 * Address comments sends the review, not words: every waiting comment is
 * marked sent in review.json (one write), then the bare `/address-comments`
 * line goes; the room is flushed before every turn, so the agent reads them.
 * Should the turn not start, the comments are put back as they were.
 */
export function useDesignTurns(projectName: string): {
  /** Send the design turn for the features that need it: `/design F1 F2`, or `/recreate` (below). */
  design: () => void;
  addressComments: (review: DesignReviewActions) => Promise<void>;
  /** Whether one can start now: the chat is loaded and no turn is running. */
  ready: boolean;
  /**
   * The design action is the first design of a product recreated from its
   * code (ADR-0053): the project was seeded from a spec bundle and nothing is
   * designed yet, so the action sends `/recreate` and reads "Recreate". Once a
   * design exists the project iterates with `/design` like any other.
   */
  recreate: boolean;
} {
  const chat = useProjectChat(projectName);
  const panel = useChatPanel();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toDesign = useSpecWorkspace(projectName).workspace?.design.toDesign ?? [];
  const status = useProjectStatus(projectName).data?.spec;
  const recreate = Boolean(status?.recreate) && !status?.design;

  const send = async (text: string): Promise<boolean> => {
    panel.open();
    const sent = await chatStore.send(projectName, text, { kind: "design" });
    // The design card shows the turn running as soon as the server has it.
    if (sent) void queryClient.invalidateQueries({ queryKey: designKey(projectName) });
    return sent;
  };

  return {
    ready: canSend(chat),
    recreate,
    design: () => {
      void navigate({ to: "/projects/$projectName/design", params: { projectName } });
      void send(recreate ? RECREATE_COMMAND : designCommand(toDesign));
    },
    addressComments: async (review) => {
      if (!canSend(chat)) return;
      const sent = review.sendWaiting();
      if (!sent || sent.length === 0) return;
      if (!(await send(ADDRESS_COMMENTS_COMMAND))) review.unsend(sent);
    },
  };
}
