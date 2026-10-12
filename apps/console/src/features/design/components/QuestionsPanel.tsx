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

import { useState } from "react";
import { Box, Button, Popover, TextField, Typography } from "@wso2/oxygen-ui";
import type { DesignQuestion } from "../model/questions";
import type { DesignCard } from "../useDesignCard";

// "Answer N questions" (L19): the questions the design waits on the user for,
// each with a text box, in a small panel that drops down from the button.
// A review comment's question is answered for the agent, and goes with the
// next Address comments; a feature's question is answered into its file, and
// the next Design takes it. Answered, a question leaves the list, and the
// card's primary moves on to the step that sends the answer.

function plural(n: number): string {
  return `${n} ${n === 1 ? "question" : "questions"}`;
}

function QuestionForm({ question, title, ready, onAnswer }: { question: DesignQuestion; title: string; ready: boolean; onAnswer: (text: string) => void }) {
  const [own, setOwn] = useState("");
  const options = question.kind === "feature" ? question.options : [];
  return (
    <Box
      component="li"
      aria-label={question.question}
      sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, px: 1.5, py: 1.25, display: "flex", flexDirection: "column", gap: 0.75, bgcolor: "background.paper" }}
    >
      <Typography variant="caption" color="text.secondary">
        {question.kind === "comment" ? `On ${title} · ${question.author}'s comment: “${question.text}”` : `${question.featureName} (${question.featureId})`}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {question.question}
      </Typography>
      {options.length > 0 && (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.5 }}>
          {options.map((option) => (
            <Button key={option} size="small" variant="outlined" disabled={!ready} onClick={() => onAnswer(option)} sx={{ textAlign: "start", justifyContent: "flex-start" }}>
              {option}
            </Button>
          ))}
        </Box>
      )}
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (own.trim()) onAnswer(own);
        }}
        sx={{ display: "flex", gap: 0.75, alignItems: "flex-start", flexWrap: "wrap" }}
      >
        <TextField
          size="small"
          multiline
          minRows={1}
          value={own}
          onChange={(e) => setOwn(e.target.value)}
          placeholder={options.length > 0 ? "Or answer in your own words" : "Your answer"}
          slotProps={{ htmlInput: { "aria-label": `Your answer: ${question.question}` } }}
          sx={{ flex: "1 1 220px" }}
        />
        <Button type="submit" size="small" variant="outlined" disabled={!own.trim() || !ready}>
          Answer
        </Button>
      </Box>
      <Typography variant="caption" color="text.secondary">
        {question.kind === "comment"
          ? "Your answer goes to the agent with Address comments."
          : `Your answer becomes a decision in ${question.featureName}; the next design run takes it.`}
      </Typography>
    </Box>
  );
}

/** The Answer button, and its panel of questions. Nothing while no question waits. */
export function AnswerQuestions({ card, primary, ready }: { card: DesignCard; primary: boolean; ready: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { questions } = card;
  if (questions.length === 0) return null;
  const title = (path: string) => card.items.find((i) => i.path === path)?.title ?? path;
  return (
    <>
      <Button
        size="small"
        variant={primary ? "contained" : "outlined"}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        aria-expanded={Boolean(anchor)}
        aria-haspopup="dialog"
      >
        Answer {plural(questions.length)}
      </Button>
      <Popover
        open={anchor?.isConnected === true}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { role: "dialog", "aria-label": "Questions for you", sx: { width: 480, maxWidth: "calc(100vw - 32px)", p: 1.5, display: "flex", flexDirection: "column", gap: 1.25 } } }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {plural(questions.length)} for you
        </Typography>
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 0.75, maxHeight: 420, overflowY: "auto" }}>
          {questions.map((q) => (
            <QuestionForm
              key={q.key}
              question={q}
              title={q.kind === "comment" ? title(q.path) : ""}
              ready={ready}
              onAnswer={(text) => {
                // The last answer closes the panel: the card's primary is the next step now.
                if (card.answer(q, text) && questions.length === 1) setAnchor(null);
              }}
            />
          ))}
        </Box>
      </Popover>
    </>
  );
}
