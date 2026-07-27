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

// The pending multi-question entry for the spec body's question form (spike):
// observes the room's shared `questions` map, and back-fills it from this
// client's own chat log so a question that arrived while the user was off the
// spec route still surfaces when they navigate to it.

import { useEffect, useState } from "react";
import type { Doc } from "yjs";
import { getMessages } from "./chatStore.js";
import { answerableQuestionIds } from "./questionCards.js";
import { useCurrentAuthor } from "./currentUser.js";
import {
  mirrorQuestion,
  observeRoomQuestions,
  readRoomQuestions,
  type RoomQuestion,
} from "./questionRoom.js";

/** The newest still-open question entry in the room, if any. */
function pendingQuestion(all: RoomQuestion[]): RoomQuestion | undefined {
  for (let i = all.length - 1; i >= 0; i--) {
    const e = all[i]!;
    if (!e.submitted) return e;
  }
  return undefined;
}

export function useRoomQuestion(doc: Doc | null, chatKey: string): RoomQuestion | undefined {
  const me = useCurrentAuthor();
  const [entry, setEntry] = useState<RoomQuestion | undefined>(undefined);

  // Back-fill: mirror any question from this client's own chat log into the
  // room (idempotent by toolCallId). Covers the case where the question
  // streamed in while the spec route — which owns the doc — was not mounted,
  // so the fold had nowhere to mirror it. The `ownerId: me.id` claim assumes
  // "my log ⇒ my turn", which holds across real users (separate browsers don't
  // share localStorage) but NOT across two tabs of one browser with different
  // `aep:mock:user` identities — there, whichever tab back-fills first claims
  // ownership (mirrorQuestion is first-writer-wins, so it can't be stolen
  // later). Acceptable for a dev-only setup.
  useEffect(() => {
    if (!doc) return;
    const messages = getMessages(chatKey);
    // Only questions the log still considers ANSWERABLE (no later delivered
    // user message). The room's `submitted` flag lives in an ephemeral doc
    // (rooms unload when empty), but the submitted/skipped answer persists in
    // the log as the user message right after the question — so this check is
    // what stops a fresh doc from resurrecting an already-answered form.
    const answerable = answerableQuestionIds(messages);
    for (const m of messages) {
      if (m.role !== "question" || !m.questions?.length) continue;
      if (!m.toolCallId || !answerable.has(m.id)) continue;
      mirrorQuestion(doc, {
        toolCallId: m.toolCallId,
        questions: m.questions,
        ownerId: me.id, // it's this client's log, so this client ran the turn
      });
    }
  }, [doc, chatKey, me.id]);

  useEffect(() => {
    if (!doc) {
      setEntry(undefined);
      return;
    }
    const read = () => setEntry(pendingQuestion(readRoomQuestions(doc)));
    read();
    return observeRoomQuestions(doc, read);
  }, [doc]);

  return entry;
}
