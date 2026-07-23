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

// Collab question cards spike (2026-07-23): render agent question cards on the
// MAIN spec panel from the shared Yjs `questions` map, so every room participant
// sees the pending question and CO-AUTHORS the answer live. Only the turn-owner
// (who holds the SSE stream back to the agent) can submit — the reply is handed
// off through the existing pendingSeed seam (AppLayout auto-opens the chat panel
// and its single turn-owner useAgentChat sends it). Non-owners co-edit but can't
// send. Reuses the QuestionCard from the chat feature in its controlled mode.

import { useEffect, useState } from "react";
import { Box, Stack, Typography } from "@wso2/oxygen-ui";
import { Users } from "@wso2/oxygen-ui-icons-react";
import type { Doc } from "yjs";
import type { QuestionAnswer } from "@aep/agent-stream";
import { QuestionCard, type QuestionMessage } from "../../agent-chat/components/QuestionCard";
import { serializeQuestionAnswer } from "../../agent-chat/questionCards";
import { chatKeyFor, setPendingSeed } from "../../agent-chat/chatStore";
import { useCurrentAuthor } from "../../agent-chat/currentUser";
import {
  markRoomQuestionSubmitted,
  observeRoomQuestions,
  readRoomQuestions,
  setRoomAnswer,
  type RoomQuestion,
} from "../../agent-chat/questionRoom";

/** The live question to surface: the most recently mirrored, not-yet-submitted one. */
function activeQuestion(all: RoomQuestion[]): RoomQuestion | undefined {
  for (let i = all.length - 1; i >= 0; i--) if (!all[i]!.submitted) return all[i];
  return undefined;
}

export function SpecQuestionBanner({
  doc,
  org,
  projectName,
}: {
  /** The live room Y.Doc (from useCollabSpec's provider). */
  doc: Doc;
  org: string;
  projectName: string;
}) {
  const me = useCurrentAuthor();
  const [questions, setQuestions] = useState<RoomQuestion[]>(() => readRoomQuestions(doc));

  useEffect(() => {
    setQuestions(readRoomQuestions(doc));
    return observeRoomQuestions(doc, () => setQuestions(readRoomQuestions(doc)));
  }, [doc]);

  const active = activeQuestion(questions);
  if (!active) return null;

  const isOwner = active.ownerId === me.id;
  // A QuestionMessage view over the room entry — QuestionCard is agnostic to
  // where the entry came from (chat log vs collab map).
  const msg: QuestionMessage = {
    id: active.toolCallId,
    role: "question",
    turnId: "collab",
    toolCallId: active.toolCallId,
    questions: active.questions,
  };

  const onDraftChange = (answers: QuestionAnswer[]) => {
    setRoomAnswer(doc, active.toolCallId, answers);
  };
  const onAnswer = (_m: QuestionMessage, answers: QuestionAnswer[]) => {
    if (!isOwner) return; // only the turn-owner can reply to the agent
    // Hand the send off to the chat panel's single turn-owner instance.
    setPendingSeed(chatKeyFor(org, projectName), serializeQuestionAnswer(active.questions, answers));
    markRoomQuestionSubmitted(doc, active.toolCallId);
  };

  return (
    <Box
      data-testid="spec-question-banner"
      sx={{
        px: 2,
        py: 1.5,
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: "action.hover",
      }}
    >
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mb: 1, color: "text.secondary" }}>
        <Users size={14} />
        <Typography variant="caption" sx={{ fontWeight: 600 }}>
          The agent asked the team a question — answer together
        </Typography>
      </Stack>
      <QuestionCard
        msg={msg}
        answerable
        busy={false}
        onAnswer={onAnswer}
        controlledDraft={active.answers}
        onDraftChange={onDraftChange}
        canSubmitOverride={isOwner}
        {...(isOwner ? {} : { submitLabelOverride: "Only the asker can send" })}
      />
    </Box>
  );
}
