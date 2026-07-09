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

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from '@wso2/oxygen-ui';
import { api } from '../../services/api';
import type { DevflowStatus } from '../../services/api';

// Terminal dev-workflow phases — polling stops once one is reached.
const TERMINAL_PHASES = new Set(['done', 'failed']);
const POLL_MS = 3000;

interface DevflowPanelProps {
  projectId: string;
}

/**
 * DevflowPanel is the old-console demo surface for the Temporal-backed
 * development workflow. It starts a dev workflow, polls its live status every
 * 3s (the same cadence as the execution-progress feed), and surfaces the
 * human-in-the-loop gate with an Approve/Reject control.
 */
export function DevflowPanel({ projectId }: DevflowPanelProps) {
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [status, setStatus] = useState<DevflowStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  // On mount, adopt an already-running dev workflow (survives a page reload).
  useEffect(() => {
    let cancelled = false;
    void api.listDevflows(projectId).then((runs) => {
      const running = runs.find((r) => r.status === 'running');
      if (!cancelled && running) setWorkflowId(running.workflowId);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [projectId]);

  // Poll the live status while a workflow is selected and not terminal.
  useEffect(() => {
    if (!workflowId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await api.getDevflow(projectId, workflowId);
        if (cancelled) return;
        setStatus(s);
        if (TERMINAL_PHASES.has(s.phase)) stopPolling();
      } catch {
        // Transient (e.g. 404 before the run is queryable) — keep polling.
      }
    };
    void tick();
    timer.current = setInterval(tick, POLL_MS);
    return () => { cancelled = true; stopPolling(); };
  }, [workflowId, projectId, stopPolling]);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await api.startDevflow(projectId);
      setStatus(null);
      setWorkflowId(res.workflowId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start the development workflow');
    } finally {
      setStarting(false);
    }
  }, [projectId]);

  const decide = useCallback(async (gate: string, approve: boolean) => {
    if (!workflowId) return;
    try {
      await api.decideDevflowGate(projectId, workflowId, gate, { approve });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit the gate decision');
    }
  }, [projectId, workflowId]);

  const running = status !== null && !TERMINAL_PHASES.has(status.phase);

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="h6">Development workflow</Typography>
          <Button
            variant="contained"
            size="small"
            disabled={starting || running}
            onClick={() => void start()}
          >
            {starting ? 'Starting…' : running ? 'Running…' : 'Start Dev Workflow'}
          </Button>
        </Stack>

        {error && (
          <Typography color="error" variant="body2" sx={{ mb: 1 }}>{error}</Typography>
        )}

        {!status && !workflowId && (
          <Typography variant="body2" color="text.secondary">
            Kick off the Temporal-driven build: tag → design → plan → tasks → validate.
          </Typography>
        )}

        {status && (
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" color="text.secondary">Phase</Typography>
              <Chip label={status.phase} size="small" />
              {status.tag && <Chip label={status.tag} size="small" variant="outlined" />}
              {running && <CircularProgress size={14} />}
            </Stack>

            {status.error && (
              <Typography color="error" variant="body2">{status.error}</Typography>
            )}

            {status.pendingGate && (
              <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="body2">
                    Waiting for approval at gate <strong>{status.pendingGate}</strong>
                  </Typography>
                  <Button size="small" variant="contained" onClick={() => void decide(status.pendingGate!, true)}>
                    Approve
                  </Button>
                  <Button size="small" variant="outlined" color="error" onClick={() => void decide(status.pendingGate!, false)}>
                    Reject
                  </Button>
                </Stack>
              </Box>
            )}

            {status.tasks && status.tasks.length > 0 && (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>Tasks</Typography>
                <Stack spacing={0.5}>
                  {status.tasks.map((t) => (
                    <Stack key={t.issue} direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2">#{t.issue}</Typography>
                      <Chip label={t.outcome || t.phase || 'pending'} size="small" variant="outlined" />
                    </Stack>
                  ))}
                </Stack>
              </Box>
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
