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

import { useRef, useState } from "react";
import { Box, Button, ButtonBase, InputBase, Typography } from "@wso2/oxygen-ui";
import { Check } from "@wso2/oxygen-ui-icons-react";
import type { AskQuestionInput, AskQuestionOption, QuestionAnswer } from "@aep/agent-stream";
import type { QuestionItem } from "../chatLog";
import {
  applyNote,
  applySelection,
  isFreeTextOption,
  isQuestionAnswered,
  normalizeAnswers,
} from "../questionCards";

// The agent's question, as a card in the chat: its options, and a free answer
// in the user's own words. Widgets after the old console's SpecQuestionForm
// (QuestionBlock, OptionCard), cut down to the chat's width.

function OptionButton({
  opt,
  multi,
  on,
  disabled,
  onSelect,
}: {
  opt: AskQuestionOption;
  multi: boolean;
  on: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <ButtonBase
      role={multi ? "checkbox" : "radio"}
      aria-checked={on}
      disabled={disabled}
      onClick={onSelect}
      sx={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        textAlign: "start",
        gap: 0.25,
        px: 1.25,
        py: 0.875,
        border: 1,
        borderRadius: 2,
        borderColor: on ? "primary.main" : "divider",
        bgcolor: on ? "rgba(var(--oxygen-palette-primary-mainChannel) / 0.08)" : "transparent",
        "&:hover": { bgcolor: on ? undefined : "action.hover" },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, width: "100%" }}>
        <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
          {opt.label}
        </Typography>
        {opt.recommended && (
          <Typography variant="caption" sx={{ color: "primary.main", flexShrink: 0 }}>
            Recommended
          </Typography>
        )}
        {on && <Check size={14} aria-hidden />}
      </Box>
      {opt.description && (
        <Typography variant="caption" color="text.secondary">
          {opt.description}
        </Typography>
      )}
    </ButtonBase>
  );
}

function QuestionBlock({
  q,
  answer,
  disabled,
  onSelect,
  onNote,
}: {
  q: AskQuestionInput;
  answer: QuestionAnswer;
  disabled: boolean;
  onSelect: (label: string) => void;
  onNote: (text: string) => void;
}) {
  const note = useRef<HTMLTextAreaElement | null>(null);
  const multi = q.multiSelect === true;
  const freeOnly = q.options.length === 0;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {q.question}
      </Typography>
      {q.detail && (
        <Typography variant="caption" color="text.secondary">
          {q.detail}
        </Typography>
      )}
      {!freeOnly && (
        <Box
          role={multi ? "group" : "radiogroup"}
          aria-label={q.question}
          sx={{ display: "flex", flexDirection: "column", gap: 0.625 }}
        >
          {q.options.map((opt) => (
            <OptionButton
              key={opt.label}
              opt={opt}
              multi={multi}
              on={answer.selected.includes(opt.label)}
              disabled={disabled}
              onSelect={() => {
                const turningOn = !answer.selected.includes(opt.label);
                onSelect(opt.label);
                // An "Other" option's real answer is the text: go there.
                if (turningOn && isFreeTextOption(opt)) note.current?.focus();
              }}
            />
          ))}
        </Box>
      )}
      <InputBase
        multiline
        maxRows={4}
        disabled={disabled}
        value={answer.freeText ?? ""}
        onChange={(e) => onNote(e.target.value)}
        inputRef={note}
        placeholder={freeOnly ? "Your answer…" : "Or answer in your own words…"}
        inputProps={{ "aria-label": freeOnly ? q.question : `Your own answer to: ${q.question}` }}
        sx={{
          fontSize: "0.8125rem",
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          px: 1.25,
          py: 0.625,
          bgcolor: "background.paper",
        }}
      />
    </Box>
  );
}

/**
 * One card. Answerable while it is the question the conversation waits on;
 * once answered (here, or by a later message) it folds to its question, and
 * the answer reads as the user's message below it.
 */
export function QuestionCard({
  item,
  answerable,
  sending,
  onAnswer,
}: {
  item: QuestionItem;
  answerable: boolean;
  /** An answer is on its way: freeze the card. */
  sending: boolean;
  onAnswer: (answers: QuestionAnswer[]) => void;
}) {
  const [draft, setDraft] = useState<QuestionAnswer[]>([]);
  const answers = normalizeAnswers(item.questions, draft);
  const complete = item.questions.every((q, i) => isQuestionAnswered(q, answers[i]));

  if (!answerable || item.answers) {
    return (
      <Box sx={{ borderLeft: 2, borderColor: "divider", pl: 1.25, display: "flex", flexDirection: "column", gap: 0.25 }}>
        {item.questions.map((q, i) => (
          <Typography key={i} variant="caption" color="text.secondary" component="p">
            {q.question}
          </Typography>
        ))}
      </Box>
    );
  }

  const frozen = item.streaming || sending;
  return (
    <Box
      component="section"
      aria-label="The agent's question"
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 2.5,
        bgcolor: "background.paper",
        p: 1.5,
        display: "flex",
        flexDirection: "column",
        gap: 1.75,
      }}
    >
      {item.questions.map((q, qi) => (
        <QuestionBlock
          key={qi}
          q={q}
          answer={answers[qi]!}
          disabled={frozen}
          onSelect={(label) => setDraft(applySelection(item.questions, answers, qi, label))}
          onNote={(text) => setDraft(applyNote(item.questions, answers, qi, text))}
        />
      ))}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1 }}>
        {item.streaming && (
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            Still asking…
          </Typography>
        )}
        <Button
          size="small"
          variant="contained"
          disabled={!complete || frozen}
          loading={sending}
          onClick={() => onAnswer(answers)}
        >
          Send answer
        </Button>
      </Box>
    </Box>
  );
}
