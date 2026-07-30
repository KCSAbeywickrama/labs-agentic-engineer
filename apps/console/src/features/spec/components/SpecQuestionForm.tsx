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

// Collab question FORM (2026-07-23 spike): EVERY agent question — one or many —
// is answered here. The chat panel only points at it and the spec body is taken
// over by this full-panel form, so questions always appear in one consistent
// place instead of splitting between two surfaces.
//
// The form is driven by the room's shared Yjs `questions` map, so EVERY collab
// participant sees the questions and each other's selections live. Only the
// user who triggered the turn (`ownerId`) can submit or skip — they hold the
// SSE stream back to the agent; everyone else co-authors.

import { Box, Button, Checkbox, Chip, CircularProgress, Radio, Stack, TextField, Typography } from "@wso2/oxygen-ui";
import { Sparkles, Users } from "@wso2/oxygen-ui-icons-react";
import type { Doc } from "yjs";
import type { AskQuestionInput, QuestionAnswer } from "@aep/agent-stream";
import { serializeQuestionAnswer } from "../../agent-chat/questionCards";
import { chatKeyFor, setPendingSeed } from "../../agent-chat/chatStore";
import { useCurrentAuthor } from "../../agent-chat/currentUser";
import {
  closeRoomQuestion,
  setRoomAnswer,
  type RoomQuestion,
} from "../../agent-chat/questionRoom";

/**
 * One selectable option card: radio/checkbox, label, "Recommended" badge, and
 * the option's full description — always visible, so the user can weigh the
 * choices without hunting through tooltips.
 */
function OptionCard({
  opt,
  multi,
  isOn,
  disabled,
  onSelect,
}: {
  opt: AskQuestionInput["options"][number];
  multi: boolean;
  isOn: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const Control = multi ? Checkbox : Radio;
  return (
    <Box
      role={multi ? "checkbox" : "radio"}
      aria-checked={isOn}
      tabIndex={disabled ? -1 : 0}
      onClick={disabled ? undefined : onSelect}
      onKeyDown={
        disabled
          ? undefined
          : (e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                onSelect();
              }
            }
      }
      sx={{
        display: "flex",
        alignItems: "flex-start",
        gap: 1,
        p: 2,
        border: 1,
        borderColor: isOn ? "primary.main" : "divider",
        borderRadius: 2,
        bgcolor: isOn ? "action.selected" : "background.paper",
        cursor: disabled ? "default" : "pointer",
        transition: "border-color 120ms, background-color 120ms",
        "&:hover": disabled ? undefined : { borderColor: "primary.main" },
      }}
    >
      <Control size="small" checked={isOn} disabled={disabled} disableRipple sx={{ p: 0, mt: 0.25 }} />
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>
            {opt.label}
          </Typography>
          {opt.recommended && (
            <Chip label="Recommended" size="small" color="primary" variant="outlined" sx={{ height: 20 }} />
          )}
        </Stack>
        {opt.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {opt.description}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

/** One question block: heading, context detail, option cards, and an "Other…" free-text row. */
function QuestionBlock({
  q,
  answer,
  disabled,
  onSelect,
  onNote,
}: {
  q: AskQuestionInput;
  answer: QuestionAnswer | undefined;
  disabled: boolean;
  onSelect: (label: string) => void;
  onNote: (note: string) => void;
}) {
  const multi = q.multiSelect === true;
  const selected = answer?.selected ?? [];
  return (
    <Box sx={{ mb: 5 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        {q.question}
      </Typography>
      {q.detail && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {q.detail}
        </Typography>
      )}
      {multi && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          Pick as many as apply
        </Typography>
      )}
      <Stack spacing={1.5} role={multi ? "group" : "radiogroup"} aria-label={q.question} sx={{ mt: 1.5 }}>
        {q.options.map((opt) => (
          <OptionCard
            key={opt.label}
            opt={opt}
            multi={multi}
            isOn={selected.includes(opt.label)}
            disabled={disabled}
            onSelect={() => onSelect(opt.label)}
          />
        ))}
        <TextField
          size="small"
          placeholder="Other — describe your own answer, or add context to a choice…"
          value={answer?.freeText ?? ""}
          disabled={disabled}
          multiline
          onChange={(e) => onNote(e.target.value)}
          sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
        />
      </Stack>
    </Box>
  );
}

export function SpecQuestionForm({
  doc,
  entry,
  org,
  projectName,
}: {
  /** The live room Y.Doc — selections write straight into its shared map. */
  doc: Doc;
  /** The pending question entry from the room (one question or many). */
  entry: RoomQuestion;
  org: string;
  projectName: string;
}) {
  const me = useCurrentAuthor();
  const isOwner = entry.ownerId === me.id;
  const answers: QuestionAnswer[] =
    entry.answers ?? entry.questions.map(() => ({ selected: [] }));

  const write = (next: QuestionAnswer[]) => setRoomAnswer(doc, entry.toolCallId, next);

  const select = (qi: number, label: string) => {
    const multi = entry.questions[qi]!.multiSelect === true;
    write(
      answers.map((a, i) => {
        if (i !== qi) return a;
        const has = a.selected.includes(label);
        const selected = multi
          ? has
            ? a.selected.filter((l) => l !== label)
            : [...a.selected, label]
          : has
            ? []
            : [label];
        return { ...a, selected };
      }),
    );
  };

  const note = (qi: number, freeText: string) => {
    write(answers.map((a, i) => (i === qi ? { ...a, freeText } : a)));
  };

  const allAnswered = answers.every(
    (a) => a.selected.length > 0 || (a.freeText ?? "").trim().length > 0,
  );
  // While the batch is still streaming (#270 latency), the form is readable and
  // selectable but cannot submit or skip: the turn is still running, and more
  // questions may yet arrive. The final mirror clears the gate.
  const streaming = entry.streaming === true;
  const canSubmit = isOwner && allAnswered && !streaming;

  const submit = () => {
    if (!canSubmit) return;
    const cleaned = answers.map((a) => ({
      selected: a.selected,
      ...(a.freeText?.trim() ? { freeText: a.freeText.trim() } : {}),
    }));
    setPendingSeed(chatKeyFor(org, projectName), serializeQuestionAnswer(entry.questions, cleaned));
    closeRoomQuestion(doc, entry.toolCallId);
  };

  // Skip: close the form for the WHOLE room and tell the agent to stop asking
  // and proceed — otherwise the turn sits waiting on an answer that isn't
  // coming. Gated to the asker, same as submit (only they can drive the agent).
  const skip = () => {
    if (!isOwner) return;
    setPendingSeed(
      chatKeyFor(org, projectName),
      "Skip these questions — stop interviewing and proceed with your best assumptions, stating them.",
    );
    closeRoomQuestion(doc, entry.toolCallId);
  };

  return (
    <Box
      data-testid="spec-question-form"
      sx={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}
    >
      {/* Scrollable question list — a long interview scrolls here, the footer stays put. */}
      <Box sx={{ flexGrow: 1, overflowY: "auto", px: 5, py: 4 }}>
        <Box sx={{ maxWidth: 820, mx: "auto" }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
            <Sparkles size={18} color="var(--oxygen-palette-primary-main, currentColor)" />
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              Quick questions
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mb: 4 }}>
            <Users size={14} />
            <Typography variant="body2" color="text.secondary">
              {isOwner
                ? "Everyone on this project can answer together — you'll send the answers."
                : `Everyone on this project can answer together — ${entry.ownerId} sends them.`}
            </Typography>
          </Stack>

          {entry.questions.map((q, qi) => (
            <QuestionBlock
              key={qi}
              q={q}
              answer={answers[qi]}
              disabled={false}
              onSelect={(label) => select(qi, label)}
              onNote={(text) => note(qi, text)}
            />
          ))}
          {streaming && (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 4 }}>
              <CircularProgress size={14} aria-label="More questions arriving" />
              <Typography variant="body2" color="text.secondary">
                The agent is still writing questions — you can start answering.
              </Typography>
            </Stack>
          )}
        </Box>
      </Box>

      {/* Sticky footer — Continue sits bottom-right, gated to the asker. */}
      <Stack
        direction="row"
        spacing={2}
        sx={{
          alignItems: "center",
          justifyContent: "flex-end",
          px: 5,
          py: 2,
          borderTop: 1,
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        {!isOwner && (
          <Typography variant="caption" color="text.secondary">
            Your picks are shared live — only the person who asked can send them.
          </Typography>
        )}
        <Button variant="text" color="inherit" disabled={!isOwner || streaming} onClick={skip}>
          Skip questions
        </Button>
        <Button variant="contained" disabled={!canSubmit} onClick={submit}>
          Continue
        </Button>
      </Stack>
    </Box>
  );
}
