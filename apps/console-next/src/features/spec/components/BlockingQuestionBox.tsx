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

import { useState, type FormEvent } from "react";
import { Box, Button, TextField, Typography } from "@wso2/oxygen-ui";
import type * as Y from "yjs";
import type { BlockingQuestion, SpecFeature } from "../api/specModel";
import { useAnswerBlockingQuestion } from "../useSpecActions";
import { soft } from "./Tag";

/**
 * The question a feature's interview waits on, on the feature's page: why it
 * blocks, the answers the agent offers, and room for the user's own. The
 * answer unblocks the feature and lands in its Decisions.
 */
export function BlockingQuestionBox({
  projectName,
  doc,
  feature,
  blocking,
}: {
  projectName: string;
  doc: Y.Doc;
  feature: Pick<SpecFeature, "id" | "path">;
  blocking: BlockingQuestion;
}) {
  const { answer, pending, error } = useAnswerBlockingQuestion(projectName, doc);
  const [own, setOwn] = useState("");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (own.trim()) void answer(feature, own.trim());
  };

  return (
    <Box
      data-anchor="blocking"
      component="section"
      aria-labelledby="blocking-question"
      sx={{
        mt: 2.25,
        maxWidth: "72ch",
        border: 1,
        borderColor: "warning.main",
        bgcolor: soft("warning"),
        borderRadius: 2.5,
        px: 1.75,
        py: 1.5,
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, letterSpacing: "0.02em", color: "warning.main" }}>
        BLOCKING QUESTION
      </Typography>
      <Typography id="blocking-question" component="h2" sx={{ fontWeight: 600, fontSize: "0.875rem" }}>
        {blocking.question}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {blocking.why} The interview waits for your answer. It does not stop a build of the other features.
      </Typography>
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.75 }}>
        {blocking.options.map((option) => (
          <Button
            key={option}
            size="small"
            variant="outlined"
            color="warning"
            disabled={pending}
            onClick={() => void answer(feature, option)}
            sx={{ textAlign: "start", justifyContent: "flex-start", bgcolor: "background.paper" }}
          >
            {option}
          </Button>
        ))}
      </Box>
      <Box component="form" onSubmit={onSubmit} sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, alignItems: "flex-start" }}>
        <TextField
          size="small"
          value={own}
          onChange={(e) => setOwn(e.target.value)}
          placeholder="Or answer in your own words"
          disabled={pending}
          slotProps={{ htmlInput: { "aria-label": "Your answer" } }}
          sx={{ flex: "1 1 220px", bgcolor: "background.paper" }}
        />
        <Button type="submit" size="small" variant="contained" disabled={pending || !own.trim()}>
          Answer
        </Button>
      </Box>
      {error && (
        <Typography role="alert" variant="body2" color="error">
          {error.message}. Try again.
        </Typography>
      )}
    </Box>
  );
}
