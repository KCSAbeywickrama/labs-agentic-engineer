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

import { ADDRESS_COMMENTS_COMMAND, parseDesignCommand, parseRecreateCommand } from "@aep/contracts/commands";
import type { ChatItem, NoteAction } from "../../agent-chat/chatLog";

// The chat's pointer after a design run (L26, D07 rule 2): the chat reports
// and the card acts. When the last exchange was a design run (`/design`, or
// Address comments) and questions wait on the user, the chat offers the way
// to them, "Answer 1 question", unless the Design card is already open: then
// the agent's closing names the step in words and the card holds the primary.
// Worked out from the log and the questions, never posted.

export interface DesignQuestionsNote {
  /** The item the note follows: the exchange's last. */
  afterId: string;
  actions: NoteAction[];
}

function isDesignRun(text: string): boolean {
  const line = text.trim();
  return line === ADDRESS_COMMENTS_COMMAND || parseDesignCommand(line) !== null || parseRecreateCommand(line);
}

export function designQuestionsNote(input: {
  items: readonly ChatItem[];
  running: boolean;
  questions: number;
  designCardOpen: boolean;
}): DesignQuestionsNote | null {
  const { items, running, questions, designCardOpen } = input;
  if (running || questions === 0 || designCardOpen) return null;
  const last = items.at(-1);
  const asked = [...items].reverse().find((i) => i.kind === "user" && i.state !== "failed");
  if (!last || !asked || asked === last || asked.kind !== "user" || !isDesignRun(asked.text)) return null;
  return { afterId: last.id, actions: [{ kind: "open-design", label: `Answer ${questions} ${questions === 1 ? "question" : "questions"}` }] };
}
