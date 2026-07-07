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

import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { alpha, Box, ButtonBase, CircularProgress, IconButton, PageContent, Stack, Typography } from '@wso2/oxygen-ui';
import { Info, X } from '@wso2/oxygen-ui-icons-react';
import { api } from '../services/api';
import type { TaskView } from '../services/api';
import { useProjectTasks, type TaskListState } from '../hooks/useProjectTasks';
import { AnimatedBanner } from '../components/tasks/AnimatedBanner';
import { TaskSection } from '../components/tasks/TaskSection';
import { TasksPageHeader } from '../components/tasks/TasksPageHeader';
import { EXECUTABLE_STATUSES, TASK_SECTIONS, type SectionKey } from '../components/tasks/types';

const STATE_FILTERS: { key: TaskListState; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
];

function groupBySection(tasks: TaskView[]): Record<SectionKey, TaskView[]> {
  const groups = { active: [], pending: [], onHold: [], done: [], blocked: [] } as Record<SectionKey, TaskView[]>;
  for (const task of tasks) {
    const section = TASK_SECTIONS.find((s) => s.statuses.includes(task.derivedStatus));
    // Any unrecognized derivedStatus lands in "Needs attention" so nothing is
    // silently dropped from the board.
    groups[section?.key ?? 'blocked'].push(task);
  }
  return groups;
}

export default function ProjectTasksPage() {
  const { orgId, projectId } = useParams<{ orgId: string; projectId: string }>();
  // Default to "All": a PR merge auto-closes the issue, so a task whose build
  // then fails would be hidden under a default "Open" filter. The sections
  // already separate settled from active work; Open/Closed remain as filters.
  const [stateFilter, setStateFilter] = useState<TaskListState>('all');
  const [isExecutingAll, setIsExecutingAll] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    tasks,
    isLoading,
    error,
    refresh,
    plan,
    isPlanning,
    planError,
    clearPlanError,
  } = useProjectTasks(projectId, stateFilter);

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(TASK_SECTIONS.map((s) => [s.key, s.key === 'active' || s.key === 'pending'])),
  );

  const groups = useMemo(() => groupBySection(tasks), [tasks]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleExecuteAll = async () => {
    if (!projectId) return;
    // "Execute all" — the funnel handles deps, so we just stamp every
    // actionable, not-held task and let it order itself.
    const targets = tasks.filter((t) => !t.hold && EXECUTABLE_STATUSES.has(t.derivedStatus));
    if (targets.length === 0) return;
    setIsExecutingAll(true);
    try {
      // Fan out per task — there is no batch endpoint (§9.1); ordering emerges
      // from the funnel's dependency gates. Best-effort: one failure doesn't
      // abort the rest.
      await Promise.allSettled(targets.map((t) => api.executeTask(projectId, t.issueNumber)));
      await refresh();
    } finally {
      setIsExecutingAll(false);
    }
  };

  if (isLoading) {
    return (
      <PageContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 16, gap: 1.5 }}>
          <CircularProgress size={28} thickness={3} />
          <Typography variant="body2" color="text.disabled">Loading tasks…</Typography>
        </Box>
      </PageContent>
    );
  }

  return (
    <PageContent sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <TasksPageHeader
          projectId={projectId ?? ''}
          totalTasks={tasks.length}
          isPlanning={isPlanning}
          isExecutingAll={isExecutingAll}
          isRefreshing={isRefreshing}
          onPlan={plan}
          onExecuteAll={handleExecuteAll}
          onRefresh={handleRefresh}
        />

        {/* State filter */}
        <Stack direction="row" spacing={0.5} sx={{ mb: 2 }}>
          {STATE_FILTERS.map((f) => {
            const active = stateFilter === f.key;
            return (
              <ButtonBase
                key={f.key}
                onClick={() => setStateFilter(f.key)}
                sx={{
                  px: 1.5,
                  py: 0.5,
                  borderRadius: 1,
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  color: active ? 'primary.main' : 'text.secondary',
                  bgcolor: (t) => (active ? alpha(t.palette.primary.main, 0.1) : 'transparent'),
                  border: '1px solid',
                  borderColor: (t) => (active ? alpha(t.palette.primary.main, 0.3) : 'divider'),
                }}
              >
                {f.label}
              </ButtonBase>
            );
          })}
        </Stack>

        {/* Errors */}
        <AnimatedBanner show={!!planError}>
          <ErrorBanner message={planError ?? ''} onClose={clearPlanError} />
        </AnimatedBanner>
        <AnimatedBanner show={!!error}>
          <ErrorBanner message={error ?? ''} onClose={handleRefresh} />
        </AnimatedBanner>

        {/* Sections */}
        <Box sx={{ flex: 1, overflowY: 'auto', pr: 0.25 }}>
          {tasks.length === 0 && !isPlanning && (
            <EmptyState />
          )}
          {tasks.length === 0 && isPlanning && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, pt: 8 }}>
              <CircularProgress size={16} thickness={4} />
              <Typography variant="body2" color="text.disabled">
                Planning tasks — issues appear below as they are created…
              </Typography>
            </Box>
          )}

          {TASK_SECTIONS.map((section) => (
            <TaskSection
              key={section.key}
              section={section}
              tasks={groups[section.key]}
              orgId={orgId ?? ''}
              projectId={projectId ?? ''}
              onChanged={refresh}
              expanded={expandedSections[section.key] ?? false}
              onExpandedChange={(val) => setExpandedSections((s) => ({ ...s, [section.key]: val }))}
            />
          ))}
        </Box>
      </Box>
    </PageContent>
  );
}

function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 1.5,
        mb: 2,
        borderRadius: 1.25,
        bgcolor: (t) => alpha(t.palette.error.main, 0.08),
        border: '1px solid',
        borderColor: (t) => alpha(t.palette.error.main, 0.2),
      }}
    >
      <Typography variant="body2" sx={{ flex: 1, color: 'error.main', lineHeight: 1.3 }}>
        {message}
      </Typography>
      <IconButton size="small" onClick={onClose} sx={{ p: 0.5, color: 'error.main' }}>
        <X size={14} />
      </IconButton>
    </Box>
  );
}

function EmptyState() {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 1.5,
        mb: 2,
        borderRadius: 1.25,
        bgcolor: (t) => alpha(t.palette.info.main, 0.08),
        border: '1px solid',
        borderColor: (t) => alpha(t.palette.info.main, 0.2),
      }}
    >
      <Box sx={{ flexShrink: 0, display: 'flex', color: 'info.main' }}>
        <Info size={16} />
      </Box>
      <Box sx={{ flex: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 700, color: 'info.main', lineHeight: 1.3 }}>
          No tasks yet
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.primary', lineHeight: 1.3 }}>
          Plan tasks from the approved design to create the GitHub issues that drive implementation.
        </Typography>
      </Box>
    </Box>
  );
}
