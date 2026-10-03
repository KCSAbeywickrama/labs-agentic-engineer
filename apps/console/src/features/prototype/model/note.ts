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

import { parsePrototypeCommand } from "@aep/contracts/commands";
import type { NoteAction } from "../../agent-chat/chatLog";

// The chat's line when a `/prototype` turn ends: where to look at the result.
// A turn for one web application opens its review; a bare `/prototype` (every
// one) opens the Prototype tab.

export interface PrototypeNote {
  text: string;
  actions: NoteAction[];
}

/** The note a finished turn's instruction earns, or null when it was not a prototype turn. */
export function prototypeNote(instruction: string | undefined): PrototypeNote | null {
  const turn = instruction ? parsePrototypeCommand(instruction) : null;
  if (!turn) return null;
  return turn.component
    ? {
        text: `The ${turn.component} prototype is ready to review.`,
        actions: [{ kind: "open-prototype", label: "Open prototype", component: turn.component }],
      }
    : {
        text: "The prototypes are ready to review.",
        actions: [{ kind: "open-prototype", label: "Open prototypes", component: null }],
      };
}
