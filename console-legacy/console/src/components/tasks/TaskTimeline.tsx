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

// TaskTimeline renders the task-log stream's unified timeline as collapsible
// per-attempt groups: one section per execution (oldest first), each expanding
// to that attempt's activity feed. This is the client-side replacement for the
// old "pick an execution to read its log" browser — the data is one `lines`
// array carrying each row's `executionId`, so grouping is a pure fold, no
// per-execution fetch. The running/newest attempt is expanded by default.

import { useMemo, useState } from 'react';
import { alpha, Box, Stack, Typography } from '@wso2/oxygen-ui';
import { ChevronDown, ChevronRight } from '@wso2/oxygen-ui-icons-react';
import type { ExecutionView, TimelineEvent } from '../../services/api';
import { formatElapsedSince } from '../../lib/relativeTime';
import { TaskActivityFeed } from './TaskActivityFeed';

interface Props {
  /** Every attempt, oldest first. */
  executions: ExecutionView[];
  /** The unified timeline across attempts (each line carries its executionId). */
  lines: TimelineEvent[];
}

const TERMINAL = new Set(['succeeded', 'failed', 'canceled']);

function toneFor(status: string): string {
  switch (status) {
    case 'succeeded': return 'success.main';
    case 'failed': return 'error.main';
    case 'running': return 'primary.main';
    case 'canceled': return 'text.disabled';
    default: return 'warning.main'; // queued
  }
}

export function TaskTimeline({ executions, lines }: Props) {
  // Group the flat timeline by attempt once per render.
  const byExec = useMemo(() => {
    const m = new Map<string, TimelineEvent[]>();
    for (const l of lines) {
      const arr = m.get(l.executionId);
      if (arr) arr.push(l);
      else m.set(l.executionId, [l]);
    }
    return m;
  }, [lines]);

  // Default-expand the newest attempt (the last in oldest-first order).
  const newestId = executions.length ? executions[executions.length - 1].id : undefined;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => expanded[id] ?? id === newestId;

  if (executions.length === 0) {
    return (
      <Typography variant="body2" color="text.disabled" sx={{ mt: 1 }}>
        No executions yet — Execute this task (or stamp <code>aep:execute</code> on the issue) to dispatch it.
      </Typography>
    );
  }

  return (
    <Stack spacing={0.75} sx={{ mt: 1 }}>
      {executions.map((exec) => {
        const open = isOpen(exec.id);
        const execLines = byExec.get(exec.id) ?? [];
        const tone = toneFor(exec.status);
        const started = formatElapsedSince(exec.startedAt ?? exec.createdAt);
        return (
          <Box key={exec.id} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
            <Box
              onClick={() => setExpanded((prev) => ({ ...prev, [exec.id]: !open }))}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                px: 1.25,
                py: 0.875,
                cursor: 'pointer',
                bgcolor: (t) => (open ? alpha(t.palette.text.primary, 0.03) : 'transparent'),
                '&:hover': { bgcolor: (t) => alpha(t.palette.text.primary, 0.05) },
              }}
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: tone, flexShrink: 0 }} />
              <Typography variant="body2" sx={{ fontWeight: 600, textTransform: 'capitalize', minWidth: 52 }}>{exec.kind}</Typography>
              <Typography variant="caption" sx={{ color: tone, fontWeight: 600, textTransform: 'uppercase', minWidth: 72 }}>
                {exec.status}
              </Typography>
              {exec.runName && (
                <Typography variant="caption" sx={{ color: 'text.disabled', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {exec.runName}
                </Typography>
              )}
              {!exec.runName && exec.reason && (
                <Typography variant="caption" sx={{ color: 'text.disabled', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {exec.reason}
                </Typography>
              )}
              {!exec.runName && !exec.reason && <Box sx={{ flex: 1 }} />}
              {execLines.length > 0 && (
                <Typography variant="caption" sx={{ color: 'text.disabled', flexShrink: 0 }}>{execLines.length} events</Typography>
              )}
              {started && (
                <Typography variant="caption" sx={{ color: 'text.disabled', flexShrink: 0 }}>{started} ago</Typography>
              )}
            </Box>
            {open && (
              <Box sx={{ px: 1.25, pb: 1.25, borderTop: '1px solid', borderColor: 'divider' }}>
                <TaskActivityFeed
                  lines={execLines}
                  final={TERMINAL.has(exec.status)}
                  emptyMessage={
                    exec.status === 'queued'
                      ? `Queued${exec.reason ? ` — ${exec.reason}` : ''}. Waiting to start…`
                      : exec.status === 'running'
                        ? 'Execution running — streaming activity will appear here…'
                        : 'No activity recorded for this execution.'
                  }
                />
              </Box>
            )}
          </Box>
        );
      })}
    </Stack>
  );
}
