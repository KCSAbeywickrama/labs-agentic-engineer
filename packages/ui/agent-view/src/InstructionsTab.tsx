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

import { useState, type ReactNode } from "react";
import { Alert, Button, Stack, TextField, Typography } from "@wso2/oxygen-ui";

import { mono, Panel } from "./parts.js";

/**
 * The prompt body as one card, read-only until a caller supplies a way to save
 * it. No card title: the tab already says what this is.
 *
 * Editing works on the RAW body rather than the parsed sections: the sections
 * are a reading of the document, and writing one back would normalise spacing
 * and quietly drop anything the reader did not recognise as a heading. One box
 * over the whole body keeps the author's text exactly as they wrote it.
 */
export function InstructionsTab({
  body,
  onSaveBehaviour,
  renderMarkdown,
}: {
  body: string;
  onSaveBehaviour?: ((body: string) => Promise<void>) | undefined;
  renderMarkdown?: ((markdown: string) => ReactNode) | undefined;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    if (draft === null || !onSaveBehaviour) return;
    setSaving(true);
    setError(null);
    try {
      await onSaveBehaviour(draft.trim());
      setDraft(null);
      setSaved(true);
    } catch (err) {
      // The draft stays open on failure: a write that did not land must not
      // also cost the author what they typed.
      setError(err instanceof Error ? err.message : "Could not save the instructions");
    } finally {
      setSaving(false);
    }
  };

  if (draft !== null) {
    return (
      <Stack spacing={1}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="Instructions"
          multiline
          minRows={14}
          fullWidth
          value={draft}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          slotProps={{ input: { sx: mono } }}
        />
        <Stack direction="row" spacing={1}>
          <Button variant="contained" size="small" onClick={() => void save()} disabled={saving}>
            Save
          </Button>
          <Button size="small" onClick={() => setDraft(null)} disabled={saving}>
            Cancel
          </Button>
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      {saved && (
        // An edited prompt is compiled into the agent's code at build time, so
        // the deployed agent answers exactly as before until it is rebuilt.
        // Without saying so, a correct save looks like a broken feature.
        <Alert severity="info">
          Saved to the design. Rebuild and redeploy the agent for this to change how it answers.
        </Alert>
      )}
      <Panel
        action={
          onSaveBehaviour ? (
            <Button size="small" onClick={() => setDraft(body)}>
              Edit
            </Button>
          ) : undefined
        }
      >
        {body.trim() === "" ? (
          <Typography variant="body2" color="text.secondary">
            No instructions yet.
          </Typography>
        ) : renderMarkdown ? (
          renderMarkdown(body)
        ) : (
          // Plain pre-wrapped text is also exactly what the model receives.
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {body}
          </Typography>
        )}
      </Panel>
    </Stack>
  );
}
