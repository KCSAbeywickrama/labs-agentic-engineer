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

// Collab question cards spike (2026-07-23): render agent question cards as a
// floating OVERLAY inside the spec body, over the main content pane, from the
// shared Yjs `questions` map — so every room participant sees the pending
// question and CO-AUTHORS the answer live. The overlay floats (doesn't push the
// spec down) and scrolls internally to hold a long list of questions (batch
// form). Only the turn-owner (who holds the SSE stream back to the agent) can
// submit; the reply is handed off through the existing pendingSeed seam
// (AppLayout auto-opens the chat panel and its single turn-owner useAgentChat
// sends it). Non-owners co-edit but can't send. Reuses QuestionCard's
// controlled mode.

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

// The overlay covers the main content pane only — inset past the fixed-width
// file list on the left (SpecView's SpecFileList column).
const FILE_LIST_WIDTH = 280;

/** The live question to surface: the most recently mirrored, not-yet-submitted one. */
function activeQuestion(all: RoomQuestion[]): RoomQuestion | undefined {
  for (let i = all.length - 1; i >= 0; i--) if (!all[i]!.submitted) return all[i];
  return undefined;
}

export function SpecQuestionOverlay({
  doc,
  org,
  projectName,
}: {
  /** The live room Y.Doc (from useCollabSpec). */
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
  const msg: QuestionMessage = {
    id: active.toolCallId,
    role: "question",
    turnId: "collab",
    toolCallId: active.toolCallId,
    questions: active.questions,
  };

  const onDraftChange = (answers: QuestionAnswer[]) => setRoomAnswer(doc, active.toolCallId, answers);
  const onAnswer = (_m: QuestionMessage, answers: QuestionAnswer[]) => {
    if (!isOwner) return; // only the turn-owner can reply to the agent
    setPendingSeed(chatKeyFor(org, projectName), serializeQuestionAnswer(active.questions, answers));
    markRoomQuestionSubmitted(doc, active.toolCallId);
  };

  return (
    // Positioner: floats over the content pane; transparent to clicks except on
    // the card, so the spec behind stays usable.
    <Box
      sx={{
        position: "absolute",
        left: FILE_LIST_WIDTH,
        right: 0,
        bottom: 0,
        display: "flex",
        justifyContent: "center",
        p: 2,
        pointerEvents: "none",
        zIndex: 4,
      }}
    >
      <Box
        data-testid="spec-question-overlay"
        sx={{
          pointerEvents: "auto",
          width: "100%",
          maxWidth: 680,
          maxHeight: "60vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: 2,
          border: 1,
          borderColor: "primary.main",
          bgcolor: "background.paper",
          boxShadow: 8,
          overflow: "hidden",
        }}
      >
        {/* Sticky header; the questions below scroll. */}
        <Stack
          direction="row"
          spacing={0.75}
          sx={{
            alignItems: "center",
            px: 2,
            py: 1.25,
            borderBottom: 1,
            borderColor: "divider",
            color: "text.secondary",
            flexShrink: 0,
          }}
        >
          <Users size={14} />
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            The agent asked the team a question — answer together
          </Typography>
        </Stack>
        {/* Scroll region for the list of questions. */}
        <Box sx={{ overflowY: "auto", px: 1.5, py: 1 }}>
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
      </Box>
    </Box>
  );
}
