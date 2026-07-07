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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  alpha,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  PageContent,
  Stack,
  Typography,
} from '@wso2/oxygen-ui';
import { ChevronLeft, Github } from '@wso2/oxygen-ui-icons-react';
import { api } from '../services/api';
import type { ExecutionView, TaskDetail, TaskStatus } from '../services/api';
import { useExecutionProgress } from '../hooks/useExecutionProgress';
import { TaskActivityFeed } from '../components/tasks/TaskActivityFeed';
import { TaskPipelineStrip } from '../components/tasks/TaskPipelineStrip';
import { FlagChip, TaskStatusPill } from '../components/tasks/TaskStatusPill';
import { IN_FLIGHT_TASK_STATUSES } from '../components/tasks/types';
import { projectTasksPath } from '../lib/paths';
import { formatElapsedSince } from '../lib/relativeTime';

// Terminal for polling. failed/rejected are NOT terminal — a retry can drive
// them to deployed — so the detail keeps polling through them; otherwise the
// header freezes on the failed attempt's stale attention flag after the task
// recovers (the list, which refetches, shows it correctly). Only deployed/
// abandoned truly settle.
const SETTLED_STATUSES = new Set<TaskStatus>(['deployed', 'abandoned']);
const POLL_MS = 5000;

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" sx={{ color: 'text.disabled', fontWeight: 600, display: 'block' }}>{label}</Typography>
      <Typography variant="body2" sx={{ color: 'text.primary', wordBreak: 'break-word' }}>{value}</Typography>
    </Box>
  );
}

export default function TaskDetailPage() {
  const { orgId, projectId, issueNumber } = useParams<{ orgId: string; projectId: string; issueNumber: string }>();
  const issueNum = Number(issueNumber);

  const [task, setTask] = useState<TaskDetail | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedExecId, setSelectedExecId] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!projectId || !Number.isFinite(issueNum)) return;
    try {
      const data = await api.getTask(projectId, issueNum);
      setTask(data);
      setError(null);
      // Default the progress feed to the most-recent execution.
      setSelectedExecId((prev) => prev ?? data.executionHistory[0]?.id);
    } catch (e) {
      setError((e as Error)?.message ?? 'Task not found.');
    } finally {
      setIsLoading(false);
    }
  }, [projectId, issueNum]);

  useEffect(() => {
    setIsLoading(true);
    void load();
  }, [load]);

  // Poll until the task settles — including through failed/rejected, which a
  // retry can still carry to deployed, so the header (status + attention) stays
  // consistent with the freshly-refetched list instead of freezing on a stale
  // attention flag from a since-recovered attempt.
  useEffect(() => {
    if (!task || SETTLED_STATUSES.has(task.derivedStatus)) return undefined;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [task, load]);

  const selectedExec = useMemo(
    () => task?.executionHistory.find((e) => e.id === selectedExecId),
    [task, selectedExecId],
  );
  const progress = useExecutionProgress(projectId, selectedExecId, selectedExec?.status === 'running');

  if (isLoading) {
    return (
      <PageContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 16, gap: 1.5 }}>
          <CircularProgress size={28} thickness={3} />
          <Typography variant="body2" color="text.disabled">Loading task…</Typography>
        </Box>
      </PageContent>
    );
  }

  if (error || !task) {
    return (
      <PageContent>
        <Box sx={{ pt: 8, textAlign: 'center' }}>
          <Typography variant="body2" color="error.main">{error ?? 'Task not found.'}</Typography>
          <Button
            component={RouterLink}
            to={projectTasksPath(orgId ?? '', projectId ?? '')}
            startIcon={<ChevronLeft size={14} />}
            size="small"
            sx={{ mt: 2 }}
          >
            Back to tasks
          </Button>
        </Box>
      </PageContent>
    );
  }

  return (
    <PageContent sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack spacing={2} sx={{ pb: 2 }}>
        {/* Header */}
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Button
            component={RouterLink}
            to={projectTasksPath(orgId ?? '', projectId ?? '')}
            startIcon={<ChevronLeft size={14} />}
            size="small"
            variant="text"
            sx={{ minWidth: 0, color: 'text.secondary' }}
          >
            Tasks
          </Button>
          <Typography variant="h6" sx={{ flex: 1, fontWeight: 600 }}>
            <Box component="span" sx={{ color: 'text.disabled', mr: 0.75 }}>#{task.issueNumber}</Box>
            {task.title}
          </Typography>
          {task.hold && <FlagChip label="On hold" tone="warning" />}
          {task.attention.map((flag) => <FlagChip key={flag} label={flag} tone="error" />)}
          <TaskStatusPill status={task.derivedStatus} live={IN_FLIGHT_TASK_STATUSES.has(task.derivedStatus)} />
          {task.issueUrl && (
            <Button
              component="a"
              href={task.issueUrl}
              target="_blank"
              rel="noopener noreferrer"
              size="small"
              variant="outlined"
              startIcon={<Github size={14} />}
            >
              Issue
            </Button>
          )}
        </Stack>

        {/* Pipeline */}
        <Card variant="outlined">
          <CardContent>
            <TaskPipelineStrip status={task.derivedStatus} />
          </CardContent>
        </Card>

        {/* Facts */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="overline" sx={{ color: 'text.disabled' }}>Task</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 1.5, mt: 1 }}>
              {task.component && <Fact label="Component" value={task.component} />}
              {task.operation && <Fact label="Operation" value={task.operation} />}
              {task.executorClass && <Fact label="Executor" value={task.executorClass} />}
              {task.origin && <Fact label="Origin" value={task.origin} />}
              <Fact label="Depends on" value={task.dependsOn.length ? task.dependsOn.join(', ') : '—'} />
              <Fact label="Spec" value={task.lineage.specTag || '—'} />
              <Fact label="Design" value={task.lineage.designTag || '—'} />
            </Box>
          </CardContent>
        </Card>

        {/* Executions + progress */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="overline" sx={{ color: 'text.disabled' }}>Executions</Typography>
            {task.executionHistory.length === 0 ? (
              <Typography variant="body2" color="text.disabled" sx={{ mt: 1 }}>
                No executions yet — Execute this task (or stamp <code>aep:execute</code> on the issue) to dispatch it.
              </Typography>
            ) : (
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                {task.executionHistory.map((exec) => (
                  <ExecutionRow
                    key={exec.id}
                    exec={exec}
                    selected={exec.id === selectedExecId}
                    onSelect={() => setSelectedExecId(exec.id)}
                  />
                ))}
              </Stack>
            )}

            {selectedExec && (
              <>
                <Divider sx={{ my: 1.5 }} />
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                  <Typography variant="overline" sx={{ color: 'text.disabled' }}>
                    {selectedExec.kind} progress
                  </Typography>
                  {selectedExec.status === 'running' && progress.lines.length > 0 && !progress.final && (
                    <Typography variant="caption" color="text.disabled">· live</Typography>
                  )}
                </Stack>
                <TaskActivityFeed
                  lines={progress.lines}
                  final={progress.final}
                  emptyMessage={
                    selectedExec.status === 'queued'
                      ? `Queued${selectedExec.reason ? ` — ${selectedExec.reason}` : ''}. Waiting to start…`
                      : selectedExec.status === 'running'
                        ? 'Execution running — streaming activity will appear here…'
                        : 'No activity recorded for this execution.'
                  }
                />
                {progress.error && (
                  <Typography variant="caption" color="warning.main" sx={{ mt: 1, display: 'block' }}>
                    Live progress unavailable — the execution status above remains accurate.
                  </Typography>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </Stack>
    </PageContent>
  );
}

function ExecutionRow({ exec, selected, onSelect }: { exec: ExecutionView; selected: boolean; onSelect: () => void }) {
  const tone =
    exec.status === 'succeeded' ? 'success.main'
    : exec.status === 'failed' ? 'error.main'
    : exec.status === 'running' ? 'primary.main'
    : exec.status === 'canceled' ? 'text.disabled'
    : 'warning.main'; // queued
  const started = formatElapsedSince(exec.startedAt ?? exec.createdAt);

  return (
    <Box
      onClick={onSelect}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        px: 1.25,
        py: 0.875,
        borderRadius: 1,
        cursor: 'pointer',
        border: '1px solid',
        borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: (t) => (selected ? alpha(t.palette.primary.main, 0.05) : 'transparent'),
        '&:hover': { bgcolor: (t) => alpha(t.palette.text.primary, 0.03) },
      }}
    >
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
      {exec.reason && !exec.runName && (
        <Typography variant="caption" sx={{ color: 'text.disabled', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {exec.reason}
        </Typography>
      )}
      {started && (
        <Typography variant="caption" sx={{ color: 'text.disabled', flexShrink: 0 }}>{started} ago</Typography>
      )}
    </Box>
  );
}
