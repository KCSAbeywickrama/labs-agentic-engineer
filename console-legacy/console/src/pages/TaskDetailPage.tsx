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

import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  PageContent,
  Stack,
  Typography,
} from '@wso2/oxygen-ui';
import { ChevronLeft, Github } from '@wso2/oxygen-ui-icons-react';
import { useTaskStream } from '../hooks/useTaskStream';
import { TaskTimeline } from '../components/tasks/TaskTimeline';
import { TaskPipelineStrip } from '../components/tasks/TaskPipelineStrip';
import { FlagChip, TaskStatusPill } from '../components/tasks/TaskStatusPill';
import { IN_FLIGHT_TASK_STATUSES } from '../components/tasks/types';
import { projectTasksPath } from '../lib/paths';

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

  // One SSE connection carries the Task's whole live state — header, executions,
  // and the unified timeline — replacing the task re-poll + per-execution cursor
  // poll + execution-selection the page used to run.
  const { task, executions, lines, settled, error } = useTaskStream(projectId, issueNum);

  const anyLive = !settled && executions.some((e) => e.status === 'running' || e.status === 'queued');

  if (error) {
    return (
      <PageContent>
        <Box sx={{ pt: 8, textAlign: 'center' }}>
          <Typography variant="body2" color="error.main">{error}</Typography>
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

  if (!task) {
    return (
      <PageContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 16, gap: 1.5 }}>
          <CircularProgress size={28} thickness={3} />
          <Typography variant="body2" color="text.disabled">Loading task…</Typography>
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

        {/* Executions + unified timeline (grouped by attempt) */}
        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="overline" sx={{ color: 'text.disabled' }}>Executions</Typography>
              {anyLive && <Typography variant="caption" color="text.disabled">· live</Typography>}
            </Stack>
            <TaskTimeline executions={executions} lines={lines} />
          </CardContent>
        </Card>
      </Stack>
    </PageContent>
  );
}
