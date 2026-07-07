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
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@wso2/oxygen-ui';
import { AlertCircle, ChevronDown, Cloud, ExternalLink, Laptop, Play, RefreshCw, Sparkles } from '@wso2/oxygen-ui-icons-react';
import { useOrgAnthropic } from '../../hooks/useOrgAnthropic';

interface TasksPageHeaderProps {
  projectId: string;
  totalTasks: number;
  isPlanning: boolean;
  isExecutingAll: boolean;
  isRefreshing: boolean;
  onPlan: () => void;
  onExecuteAll: () => void;
  onRefresh: () => void;
}

export function TasksPageHeader({
  projectId,
  totalTasks,
  isPlanning,
  isExecutingAll,
  isRefreshing,
  onPlan,
  onExecuteAll,
  onRefresh,
}: TasksPageHeaderProps) {
  const [implMenuAnchor, setImplMenuAnchor] = useState<HTMLElement | null>(null);
  const [showLocalGuide, setShowLocalGuide] = useState(false);
  const { orgId } = useParams();
  const { data: anthropicProj } = useOrgAnthropic(orgId);
  const anthropicReady = anthropicProj?.status === 'active';
  const settingsUrl = `/organizations/${orgId ?? 'default'}/settings/anthropic`;

  const handleRemoteImplementation = () => {
    setImplMenuAnchor(null);
    onExecuteAll();
  };

  const handleLocalImplementation = () => {
    setImplMenuAnchor(null);
    setShowLocalGuide(true);
  };

  return (
    <>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={700} sx={{ letterSpacing: '-0.02em', mb: 0.25 }}>
            Tasks
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Live from GitHub issues · {projectId}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} alignItems="center">
          <Tooltip title="Refresh">
            <span>
              <IconButton size="small" onClick={onRefresh} disabled={isRefreshing || isPlanning}>
                {isRefreshing ? <CircularProgress size={16} /> : <RefreshCw size={16} />}
              </IconButton>
            </span>
          </Tooltip>

          <Button
            variant={totalTasks === 0 ? 'contained' : 'outlined'}
            size="small"
            startIcon={isPlanning ? <CircularProgress size={14} color="inherit" /> : <Sparkles size={15} />}
            disabled={isPlanning}
            onClick={onPlan}
          >
            {isPlanning ? 'Planning…' : totalTasks === 0 ? 'Plan Tasks' : 'Re-plan'}
          </Button>

          {totalTasks > 0 && (
            <>
              <Button
                variant="contained"
                size="small"
                startIcon={isExecutingAll ? <CircularProgress size={14} color="inherit" /> : <Play size={14} />}
                endIcon={!isExecutingAll && <ChevronDown size={14} />}
                disabled={isExecutingAll || isPlanning}
                onClick={(e) => setImplMenuAnchor(e.currentTarget)}
                aria-haspopup="menu"
                aria-expanded={Boolean(implMenuAnchor)}
              >
                {isExecutingAll ? 'Starting…' : 'Execute all'}
              </Button>
              <Menu
                anchorEl={implMenuAnchor}
                open={Boolean(implMenuAnchor)}
                onClose={() => setImplMenuAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              >
                <Tooltip
                  title={
                    anthropicReady
                      ? ''
                      : 'Configure an Anthropic API key in Org Settings → Anthropic Integration to dispatch the remote coding agent.'
                  }
                  placement="left"
                  arrow
                  disableHoverListener={anthropicReady}
                >
                  <span>
                    <MenuItem
                      onClick={handleRemoteImplementation}
                      disabled={!anthropicReady}
                      sx={{ alignItems: 'flex-start', py: 1.5, gap: 1.5, minWidth: 320 }}
                    >
                      <Box sx={{ mt: 0.25, flexShrink: 0, display: 'flex' }}>
                        {anthropicReady ? <Cloud size={20} /> : <AlertCircle size={20} color="var(--color-warning, #d97706)" />}
                      </Box>
                      <Box>
                        <Typography variant="body2" fontWeight={600}>Execute via Remote Agents</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {anthropicReady
                            ? 'Stamps every eligible task for execution; the funnel dispatches coding agents in dependency order.'
                            : (
                              <>
                                Anthropic API key required —{' '}
                                <RouterLink to={settingsUrl} style={{ color: 'inherit', textDecoration: 'underline' }}>
                                  configure in Org Settings
                                </RouterLink>
                                .
                              </>
                            )}
                        </Typography>
                      </Box>
                    </MenuItem>
                  </span>
                </Tooltip>
                <MenuItem onClick={handleLocalImplementation} sx={{ alignItems: 'flex-start', py: 1.5, gap: 1.5, minWidth: 320 }}>
                  <Box sx={{ mt: 0.25, flexShrink: 0, display: 'flex' }}>
                    <Laptop size={20} />
                  </Box>
                  <Box>
                    <Typography variant="body2" fontWeight={600}>Implement Locally</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Work the GitHub issues yourself in a local Claude Code session.
                    </Typography>
                  </Box>
                </MenuItem>
              </Menu>
            </>
          )}
        </Stack>
      </Stack>

      <Dialog open={showLocalGuide} onClose={() => setShowLocalGuide(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Stack direction="row" spacing={1} alignItems="center">
            <Laptop size={20} />
            <Box>Implement Locally with Claude Code</Box>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Each task above is a GitHub issue (open the{' '}
            <Box component="span" sx={{ display: 'inline-flex', verticalAlign: 'middle', mx: 0.5 }}>
              <ExternalLink size={12} />
            </Box>
            {' '}link on a row). Work directly on GitHub from a regular Claude Code session — no platform plugin needed.
          </Typography>

          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>1. Clone the repo and create a task branch</Typography>
          <Box
            component="pre"
            sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1, fontSize: '0.8rem', overflowX: 'auto', fontFamily: 'monospace', m: 0 }}
          >
{`gh repo clone <repo>
cd <repo>
git checkout -b task-<issue-number>`}
          </Box>

          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>2. Implement, then open a PR that closes the issue</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Run Claude Code in the repo. When the work is done:
          </Typography>
          <Box
            component="pre"
            sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1, fontSize: '0.8rem', overflowX: 'auto', fontFamily: 'monospace', m: 0 }}
          >
{`git push origin HEAD
gh pr create --fill --body "Closes #<issue-number>"`}
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
            GitHub webhooks drive task status here — opening the PR ends the coding execution; merging it spawns the build automatically.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowLocalGuide(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
