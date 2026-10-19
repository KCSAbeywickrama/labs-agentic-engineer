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
import { Box, Button, Typography } from "@wso2/oxygen-ui";
import { ArrowDown } from "@wso2/oxygen-ui-icons-react";
import { stepRows } from "@aep/progress-view";
import { useStickToBottom } from "../../../lib/useStickToBottom";
import type { StampedRunEvent } from "../hooks/useRunProgress";
import { toneColor } from "../model/tone";

// ONE agent's steps, oldest first in a pane of their own that follows the
// tail, as a terminal does: a new step lands below what the reader is reading,
// never on top of it, which is what lets a row grow (a long outcome, and later
// a call's input and result) without shoving the rest. Flat on purpose — a
// step here is always the selected agent's own, never another agent's line
// interleaved into it, which is the difference the crew view buys over a flat
// log. Each call is one row, its outcome (exit code, failure, slow duration,
// background status) right-aligned on the same row: `stepRows` in
// `@aep/progress-view` does the merging, for every surface.

/** Rows drawn before "Show earlier": a five-hour lead has thousands, and the newest are the ones being watched. */
const LAST_ROWS = 200;

function clock(ts: string | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Key it by the agent: another agent's steps open at their own tail. */
export function AgentSteps({ steps }: { steps: readonly StampedRunEvent[] }) {
  const tail = useStickToBottom();
  const [all, setAll] = useState(false);
  // Where the window stood when the reader scrolled up to read. Its first row
  // holds still until they come back down: sliding it with every arrival would
  // drop a row off the top and move what they are reading.
  const [reading, setReading] = useState<{ start: number; seen: number }>();
  const rows = stepRows(steps);
  const tailStart = Math.max(0, rows.length - LAST_ROWS);
  if (!tail.following && !reading) setReading({ start: tailStart, seen: rows.length });
  if (tail.following && reading) setReading(undefined);

  if (rows.length === 0) {
    // Real and common, not a failure: an agent can work entirely through
    // agents it spawned, or not have spoken yet.
    return (
      <Typography variant="caption" color="text.secondary">
        No steps from this agent yet.
      </Typography>
    );
  }
  const start = all ? 0 : (reading?.start ?? tailStart);
  const unseen = reading ? rows.length - reading.seen : 0;
  return (
    <Box sx={{ position: "relative" }}>
      <Box
        ref={tail.ref}
        sx={{
          maxHeight: 380,
          overflowY: "auto",
          border: 1,
          borderColor: "divider",
          borderRadius: 1.5,
          bgcolor: "background.paper",
          px: 1,
          py: 0.5,
        }}
      >
        {start > 0 && (
          <Button size="small" fullWidth onClick={() => setAll(true)}>
            Show {start} earlier steps
          </Button>
        )}
        <Box role="list" aria-label="Steps" sx={{ fontFamily: "monospace", fontSize: "0.72rem", lineHeight: 1.6 }}>
          {rows.slice(start).map((row) => (
            <Box role="listitem" key={row.key} sx={{ display: "flex", alignItems: "baseline", gap: 1.25 }}>
              <Box component="span" sx={{ color: "text.disabled", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                {clock(row.ts)}
              </Box>
              <Box component="span" sx={{ color: toneColor(row.tone), minWidth: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {row.text}
              </Box>
              {row.outcome.text && (
                <Box
                  component="span"
                  title={row.outcome.text}
                  sx={{ color: toneColor(row.outcome.tone), ml: "auto", flexShrink: 0, maxWidth: "40%", textAlign: "right", overflowWrap: "anywhere" }}
                >
                  {row.outcome.text}
                </Box>
              )}
            </Box>
          ))}
        </Box>
      </Box>
      {!tail.following && (
        <Button
          size="small"
          variant="contained"
          startIcon={<ArrowDown size={14} />}
          onClick={tail.jump}
          sx={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", borderRadius: 4, py: 0.25, boxShadow: 3 }}
        >
          Latest{unseen > 0 ? ` · ${String(unseen)} new` : ""}
        </Button>
      )}
    </Box>
  );
}
