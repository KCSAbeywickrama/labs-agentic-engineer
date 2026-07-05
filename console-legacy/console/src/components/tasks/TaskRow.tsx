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

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { alpha, Box, Button, CircularProgress, Collapse, IconButton, Tooltip, Typography } from '@wso2/oxygen-ui';
import { ChevronDown, ChevronRight, Github, Pause, Play } from '@wso2/oxygen-ui-icons-react';
import ReactMarkdown from 'react-markdown';
import { api, ApiError } from '../../services/api';
import type { TaskView } from '../../services/api';
import { projectTaskDetailPath } from '../../lib/paths';
import { FlagChip, TaskStatusPill } from './TaskStatusPill';
import { EXECUTABLE_STATUSES, HOLDABLE_STATUSES, type SectionConfig } from './types';

interface TaskRowProps {
  task: TaskView;
  section: SectionConfig;
  orgId: string;
  projectId: string;
  /** Ask the page to re-list after an execute/hold action lands. */
  onChanged: () => void;
  index: number;
}

const CARD_ANIMATION = {
  animation: 'taskFadeIn 0.22s ease both',
  '@keyframes taskFadeIn': {
    from: { opacity: 0, transform: 'translateY(5px)' },
    to:   { opacity: 1, transform: 'translateY(0)' },
  },
} as const;

export function TaskRow({ task, section, orgId, projectId, onChanged, index }: TaskRowProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<null | 'execute' | 'hold'>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const status = task.derivedStatus;
  const isFailed = status === 'failed' || status === 'rejected' || status === 'abandoned';

  const runAction = async (kind: 'execute' | 'hold', fn: () => Promise<void>) => {
    setBusy(kind);
    setActionError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const showExecute = !task.hold && EXECUTABLE_STATUSES.has(status);
  const canHold = HOLDABLE_STATUSES.has(status);

  return (
    <Box
      sx={{
        borderRadius: 1.25,
        border: '1px solid',
        borderColor: isFailed ? 'error.main' : expanded ? 'primary.main' : 'divider',
        ...(isFailed && { borderLeft: '3px solid', borderLeftColor: 'error.main' }),
        ...(!isFailed && section.borderColor && { borderLeft: '3px solid', borderLeftColor: section.borderColor }),
        ...(!isFailed && section.isPrimary && { borderLeft: '3px solid', borderLeftColor: 'primary.main' }),
        bgcolor: isFailed ? (t) => alpha(t.palette.error.main, 0.04) : 'background.paper',
        overflow: 'hidden',
        transition: 'border-color 0.15s, background-color 0.15s, box-shadow 0.15s',
        boxShadow: expanded ? (t) => `0 1px 3px ${alpha(t.palette.text.primary, 0.06)}` : 'none',
        '&:hover': { borderColor: isFailed ? 'error.dark' : expanded ? 'primary.main' : (t) => alpha(t.palette.text.primary, 0.13) },
        ...CARD_ANIMATION,
        animationDelay: `${index * 0.045}s`,
      }}
    >
      <Box
        onClick={() => setExpanded((p) => !p)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2,
          py: 1.5,
          cursor: 'pointer',
          transition: 'background-color 0.15s',
          '&:hover': { bgcolor: (t) => alpha(t.palette.text.primary, 0.02) },
        }}
      >
        {/* Title + deps / attention sublines */}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          <Typography
            variant="body2"
            sx={{
              fontWeight: 450,
              color: isFailed ? 'error.main' : 'text.primary',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            <Box component="span" sx={{ color: 'text.disabled', mr: 0.75 }}>#{task.issueNumber}</Box>
            {task.title}
          </Typography>
          {(status === 'pending' || status === 'on_hold') && task.dependsOn.length > 0 && (
            <Typography variant="caption" sx={{ color: 'warning.main', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Waiting for: {task.dependsOn.join(', ')}
            </Typography>
          )}
          {actionError && (
            <Typography variant="caption" sx={{ color: 'error.main' }}>{actionError}</Typography>
          )}
        </Box>

        {/* Standing flags */}
        {task.hold && <FlagChip label="On hold" tone="warning" />}
        {task.attention.map((flag) => (
          <FlagChip key={flag} label={flag} tone="error" />
        ))}

        {/* Derived status pill */}
        <TaskStatusPill status={status} live={section.isPrimary} />

        {/* Actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          {showExecute && (
            <Button
              variant="contained"
              size="small"
              startIcon={busy === 'execute' ? <CircularProgress size={12} color="inherit" /> : <Play size={12} />}
              disabled={busy !== null}
              onClick={() => runAction('execute', () => api.executeTask(projectId, task.issueNumber))}
              sx={{ minWidth: 0, px: 1.25, py: 0.25, fontSize: '0.7rem', textTransform: 'none' }}
            >
              {status === 'failed' || status === 'rejected' ? 'Retry' : 'Execute'}
            </Button>
          )}
          {task.hold ? (
            <Button
              variant="outlined"
              size="small"
              startIcon={busy === 'hold' ? <CircularProgress size={12} color="inherit" /> : <Play size={12} />}
              disabled={busy !== null}
              onClick={() => runAction('hold', () => api.unholdTask(projectId, task.issueNumber))}
              sx={{ minWidth: 0, px: 1.25, py: 0.25, fontSize: '0.7rem', textTransform: 'none' }}
            >
              Unhold
            </Button>
          ) : canHold ? (
            <Tooltip title="Hold — stop new dispatches for this task">
              <IconButton
                size="small"
                disabled={busy !== null}
                onClick={() => runAction('hold', () => api.holdTask(projectId, task.issueNumber))}
                sx={{ p: 0.5, color: 'text.disabled', '&:hover': { color: 'warning.main' } }}
              >
                {busy === 'hold' ? <CircularProgress size={14} color="inherit" /> : <Pause size={14} />}
              </IconButton>
            </Tooltip>
          ) : null}
        </Box>

        {/* GitHub issue link */}
        {task.issueUrl && (
          <Tooltip title="Open issue in GitHub">
            <IconButton
              component="a"
              href={task.issueUrl}
              target="_blank"
              rel="noopener noreferrer"
              size="small"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              sx={{ p: 0.5, color: 'text.disabled', '&:hover': { color: 'text.secondary' } }}
            >
              <Github size={14} />
            </IconButton>
          </Tooltip>
        )}

        {/* Expand indicator */}
        <Box sx={{ flexShrink: 0, color: 'text.disabled', display: 'flex' }}>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </Box>
      </Box>

      {/* Inline body panel — the GitHub issue body (machine block stripped) */}
      <Collapse in={expanded} timeout={220} unmountOnExit>
        <Box
          onClick={(e) => e.stopPropagation()}
          sx={{
            borderTop: '1px solid',
            borderColor: 'divider',
            px: 2,
            py: 1.75,
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
            bgcolor: (t) => alpha(t.palette.text.primary, 0.015),
          }}
        >
          {task.rationale && (
            <Typography
              variant="caption"
              sx={{
                color: 'text.disabled',
                fontStyle: 'italic',
                borderLeft: '3px solid',
                borderColor: 'divider',
                pl: 1.25,
              }}
            >
              {task.rationale}
            </Typography>
          )}
          {task.body ? (
            <Box
              sx={{
                maxHeight: 360,
                overflowY: 'auto',
                pr: 0.5,
                '&::-webkit-scrollbar': { width: 4 },
                '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
                '&::-webkit-scrollbar-thumb': {
                  bgcolor: (t) => alpha(t.palette.text.primary, 0.15),
                  borderRadius: 0.5,
                },
                '& .md-body': {
                  fontSize: '0.78rem',
                  color: 'text.secondary',
                  lineHeight: 1.65,
                  '& h1, & h2, & h3, & h4': {
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    color: 'text.primary',
                    mt: 1.25,
                    mb: 0.5,
                  },
                  '& p': { m: 0, mb: 0.75 },
                  '& ul, & ol': { pl: 2.25, m: 0, mb: 0.75 },
                  '& li': { mb: 0.25 },
                  '& code': {
                    fontFamily: 'monospace',
                    fontSize: '0.72rem',
                    bgcolor: (t) => alpha(t.palette.text.primary, 0.06),
                    px: 0.5,
                    py: 0.125,
                    borderRadius: 0.75,
                  },
                  '& pre': {
                    bgcolor: (t) => alpha(t.palette.text.primary, 0.04),
                    p: 1,
                    borderRadius: 1.5,
                    overflowX: 'auto',
                    mb: 0.75,
                    '& code': { bgcolor: 'transparent', p: 0 },
                  },
                  '& strong': { fontWeight: 600, color: 'text.primary' },
                  '& a': { color: 'primary.main' },
                  '& blockquote': {
                    borderLeft: '3px solid',
                    borderColor: 'divider',
                    pl: 1.25,
                    ml: 0,
                    color: 'text.disabled',
                  },
                },
              }}
            >
              <Box className="md-body">
                <ReactMarkdown>{task.body}</ReactMarkdown>
              </Box>
            </Box>
          ) : (
            <Typography variant="caption" color="text.disabled">
              No description on this task.
            </Typography>
          )}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="text"
              size="small"
              endIcon={<ChevronRight size={12} />}
              onClick={() => navigate(projectTaskDetailPath(orgId, projectId, String(task.issueNumber)))}
              sx={{ px: 1, py: 0.25, fontSize: '0.7rem', textTransform: 'none' }}
            >
              View details
            </Button>
          </Box>
        </Box>
      </Collapse>
    </Box>
  );
}
