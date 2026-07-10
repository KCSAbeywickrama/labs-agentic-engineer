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

// The reviewable agent-addition mark (#86 phase 6): applied by the agents
// service in the same transaction as the insertion, synced through Yjs like
// any formatting, stripped by markdown serialization so committed files stay
// clean. Accept = remove the mark (text stays); reject = delete the range.

import { Mark } from "@tiptap/core";

export const AGENT_INSERTION = "agentInsertion";

export interface AgentInsertionAttrs {
  agent: string;
  at: string;
}

export const AgentInsertion = Mark.create({
  name: AGENT_INSERTION,

  // Never the active input mark: a user typing at a highlight's edge writes
  // UNMARKED text — only the agent's own formatting creates highlights.
  inclusive: false,
  keepOnSplit: false,

  addAttributes() {
    return {
      agent: { default: "" },
      at: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-agent-insertion]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      {
        "data-agent-insertion": "",
        "data-agent": HTMLAttributes.agent ?? "",
        class: "agent-insertion",
      },
      0,
    ];
  },

  // Markdown passthrough (@tiptap/markdown): the mark contributes no syntax —
  // serialized output is the plain content, so git never sees review state.
  renderMarkdown: (node, h) => h.renderChildren(node),
});
