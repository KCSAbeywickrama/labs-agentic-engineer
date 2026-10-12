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

import { describe, expect, it } from "vitest";
import type { ChatItem } from "../../agent-chat/chatLog";
import { designQuestionsNote } from "./chatNote";

const user = (id: string, text: string): ChatItem => ({ kind: "user", id, text, state: "sent" });
const agent = (id: string, text: string): ChatItem => ({ kind: "agent", id, turnId: "t", text });
const run = (command: string) => [user("u1", command), agent("a1", "1 question for you on the Design card.")];

describe("the chat's pointer to the design's questions", () => {
  it("offers Answer N questions after a design run while questions wait and the Design card is closed", () => {
    for (const command of ["/design F1 F2", "/address-comments"]) {
      expect(designQuestionsNote({ items: run(command), running: false, questions: 2, designCardOpen: false })).toEqual({
        afterId: "a1",
        actions: [{ kind: "open-design", label: "Answer 2 questions" }],
      });
    }
  });

  it("says nothing on the open Design card, while the run runs, with no question, or after another exchange", () => {
    const base = { items: run("/address-comments"), running: false, questions: 1, designCardOpen: false };
    expect(designQuestionsNote({ ...base, designCardOpen: true })).toBeNull();
    expect(designQuestionsNote({ ...base, running: true })).toBeNull();
    expect(designQuestionsNote({ ...base, questions: 0 })).toBeNull();
    expect(designQuestionsNote({ ...base, items: [...base.items, user("u2", "thanks"), agent("a2", "You're welcome.")] })).toBeNull();
    expect(designQuestionsNote({ ...base, items: [user("u1", "/address-comments")] })).toBeNull();
  });
});
