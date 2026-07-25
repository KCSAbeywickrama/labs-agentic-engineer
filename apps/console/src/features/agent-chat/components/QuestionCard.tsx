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

// The ask_question / ask_questions card (ADR-0012 / #270): the agent's
// structured question(s) rendered natively in the activity stream. One question
// renders as a single card; several (ask_questions) render as a form with one
// submit. Options are radios (single-select) or checkboxes (multiSelect), the
// recommended answer is badged, and each question has an "Other…" free-text row.
// Read-only once answered or superseded (a typed composer reply is an equally
// valid answer path).

import { memo, useState } from "react";
import {
  alpha,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  Radio,
  Stack,
  TextField,
  Typography,
} from "@wso2/oxygen-ui";
import { CircleQuestionMark } from "@wso2/oxygen-ui-icons-react";
import type { AskQuestionInput, QuestionAnswer } from "@aep/agent-stream";
import type { ChatMessage } from "../chatStore";

export type QuestionMessage = Extract<ChatMessage, { role: "question" }>;

/** Draft answer state — one entry per question in the card. */
type Draft = { selected: string[]; note: string };

function OneQuestion({
  q,
  chosen,
  note,
  readOnly,
  busy,
  showHeader,
  onToggle,
  onNote,
}: {
  q: AskQuestionInput;
  /** The labels to render as chosen (recorded answer when read-only, else draft). */
  chosen: string[];
  /** The note to render/edit (recorded answer when read-only, else draft). */
  note: string;
  readOnly: boolean;
  busy: boolean;
  showHeader: boolean;
  onToggle: (label: string) => void;
  onNote: (note: string) => void;
}) {
  const multi = q.multiSelect === true;
  return (
    <Stack spacing={0.5}>
      {showHeader && (
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {q.question}
        </Typography>
      )}
      {q.options.map((opt) => {
        const isChosen = chosen.includes(opt.label);
        return (
          <Box
            key={opt.label}
            sx={{
              px: 1,
              borderRadius: 1.5,
              border: 1,
              borderColor: isChosen ? "primary.main" : "divider",
              bgcolor: isChosen
                ? (theme) => alpha(theme.palette.primary.main, 0.08)
                : "transparent",
            }}
          >
            <FormControlLabel
              disabled={readOnly || busy}
              sx={{ width: "100%", m: 0, py: 0.25 }}
              control={
                multi ? (
                  <Checkbox size="small" checked={isChosen} onChange={() => onToggle(opt.label)} />
                ) : (
                  <Radio size="small" checked={isChosen} onChange={() => onToggle(opt.label)} />
                )
              }
              label={
                <Stack sx={{ py: 0.5 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Typography variant="body2">{opt.label}</Typography>
                    {opt.recommended && (
                      <Chip size="small" color="primary" variant="outlined" label="Recommended" />
                    )}
                  </Stack>
                  {opt.description && (
                    <Typography variant="caption" color="text.secondary">
                      {opt.description}
                    </Typography>
                  )}
                </Stack>
              }
            />
          </Box>
        );
      })}
      {readOnly
        ? note && (
            <Typography variant="caption" color="text.secondary">
              Note: {note}
            </Typography>
          )
        : !multi && (
            <TextField
              fullWidth
              size="small"
              placeholder="Other / add a note…"
              value={note}
              disabled={busy}
              onChange={(e) => onNote(e.target.value)}
            />
          )}
    </Stack>
  );
}

// Memoized: the panel re-renders per streamed text-delta, but a card's props
// only change when its log entry does — settled cards skip reconciliation
// entirely (onAnswer is the hook's stable callback).
export const QuestionCard = memo(function QuestionCard({
  msg,
  answerable,
  busy,
  onAnswer,
}: {
  msg: QuestionMessage;
  /** Derived from the log: unanswered AND not superseded by a delivered user message. */
  answerable: boolean;
  /** A turn is in flight — keep the card visible but hold submissions. */
  busy: boolean;
  onAnswer: (msg: QuestionMessage, answers: QuestionAnswer[]) => void;
}) {
  const readOnly = !answerable;
  const isForm = msg.questions.length > 1;
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    msg.questions.map(() => ({ selected: [], note: "" })),
  );

  const toggle = (qi: number, label: string) => {
    if (readOnly || busy) return;
    setDrafts((prev) =>
      prev.map((d, i) => {
        if (i !== qi) return d;
        const multi = msg.questions[qi]!.multiSelect === true;
        const selected = multi
          ? d.selected.includes(label)
            ? d.selected.filter((l) => l !== label)
            : [...d.selected, label]
          : [label];
        return { ...d, selected };
      }),
    );
  };
  const setNote = (qi: number, note: string) => {
    setDrafts((prev) => prev.map((d, i) => (i === qi ? { ...d, note } : d)));
  };

  const answered = (d: Draft) => d.selected.length > 0 || d.note.trim().length > 0;
  const canSubmit = !readOnly && !busy && drafts.every(answered);

  const submit = () => {
    if (!canSubmit) return;
    onAnswer(
      msg,
      drafts.map((d) => ({
        selected: d.selected,
        ...(d.note.trim() ? { freeText: d.note.trim() } : {}),
      })),
    );
  };

  return (
    <Box
      data-testid="question-card"
      sx={{
        my: 0.5,
        px: 1.5,
        py: 1.25,
        borderRadius: 2,
        border: 1,
        borderColor: readOnly ? "divider" : "primary.main",
        bgcolor: "background.paper",
        opacity: readOnly && !msg.answers ? 0.7 : 1,
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start", mb: 1 }}>
        <CircleQuestionMark size={16} style={{ marginTop: 2, flexShrink: 0 }} />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {isForm ? `A few questions (${msg.questions.length})` : msg.questions[0]!.question}
        </Typography>
      </Stack>

      <Stack spacing={isForm ? 1.5 : 1}>
        {msg.questions.map((q, qi) => (
          <Box key={qi}>
            {isForm && qi > 0 && <Divider sx={{ mb: 1.5 }} />}
            <OneQuestion
              q={q}
              chosen={msg.answers ? (msg.answers[qi]?.selected ?? []) : drafts[qi]!.selected}
              note={msg.answers ? (msg.answers[qi]?.freeText ?? "") : drafts[qi]!.note}
              readOnly={readOnly}
              busy={busy}
              showHeader={isForm}
              onToggle={(label) => toggle(qi, label)}
              onNote={(note) => setNote(qi, note)}
            />
          </Box>
        ))}
      </Stack>

      {!readOnly && (
        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1.5 }}>
          <Button size="small" variant="contained" disabled={!canSubmit} onClick={submit}>
            {isForm ? "Submit answers" : "Answer"}
          </Button>
        </Stack>
      )}
    </Box>
  );
});
