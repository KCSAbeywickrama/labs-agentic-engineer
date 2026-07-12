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

import { useEffect, useMemo, useRef } from "react";
import { Box, Typography } from "@wso2/oxygen-ui";
import type { components } from "../../../generated/aep-api";
import { formatLine, timelineEventKey } from "../lib/timeline";

type TimelineEvent = components["schemas"]["TimelineEvent"];

type Row =
  | { type: "divider"; key: string; label: string }
  | { type: "line"; key: string; text: string; tone: string };

// Attempts are numbered by first appearance in the stream; a divider row is
// injected whenever the executionId changes.
function toRows(lines: TimelineEvent[]): Row[] {
  const attemptNo = new Map<string, number>();
  const rows: Row[] = [];
  let current: string | undefined;
  for (const line of lines) {
    if (line.executionId !== current) {
      current = line.executionId;
      if (!attemptNo.has(line.executionId)) {
        attemptNo.set(line.executionId, attemptNo.size + 1);
      }
      rows.push({
        type: "divider",
        key: `div:${timelineEventKey(line)}`,
        label: `attempt ${attemptNo.get(line.executionId)} · ${line.executionKind}`,
      });
    }
    const { text, tone } = formatLine(line);
    rows.push({
      type: "line",
      key: timelineEventKey(line),
      text,
      tone,
    });
  }
  return rows;
}

export function TaskLogView({
  lines,
  tail,
}: {
  lines: TimelineEvent[];
  /** Extra status line rendered under the log (waiting / reconnecting / settled). */
  tail?: string;
}) {
  const rows = useMemo(() => toRows(lines), [lines]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Follow the stream like a terminal: stay pinned to the bottom unless the
  // user scrolled up to read; re-pin when they scroll back down.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [rows.length, tail]);

  return (
    <Box
      ref={scrollRef}
      onScroll={onScroll}
      sx={{
        bgcolor: "grey.900",
        borderRadius: 1,
        p: 2,
        overflowY: "auto",
        flexGrow: 1,
        minHeight: 0,
        fontFamily: "monospace",
        fontSize: "0.8125rem",
        lineHeight: 1.7,
      }}
    >
      {rows.map((row) =>
        row.type === "divider" ? (
          <Typography
            key={row.key}
            component="div"
            sx={{
              font: "inherit",
              color: "grey.500",
              mt: 1,
              "&:first-of-type": { mt: 0 },
            }}
          >
            {`── ${row.label} ${"─".repeat(Math.max(4, 40 - row.label.length))}`}
          </Typography>
        ) : (
          <Typography
            key={row.key}
            component="div"
            sx={{
              font: "inherit",
              color: row.tone,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {row.text}
          </Typography>
        ),
      )}
      {tail && (
        <Typography
          component="div"
          sx={{ font: "inherit", color: "grey.500", mt: 1 }}
        >
          {tail}
        </Typography>
      )}
    </Box>
  );
}
