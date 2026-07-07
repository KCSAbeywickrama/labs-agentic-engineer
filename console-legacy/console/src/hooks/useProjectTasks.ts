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
import type { PlanTaskResult, UpdateTaskResult } from '@aep/agent-stream';
import { api } from '../services/api';
import type { TaskView } from '../services/api';
import { planTasks, planErrorMessage } from '../services/api/plan';

export type TaskListState = 'open' | 'closed' | 'all';

const PLAN_REFRESH_MS = 5000;

/**
 * The tasks-page data hook: a live GitHub ⋈ executions list with a manual
 * refresh, plus the plan turn. There is no always-on poll (§8). While a plan
 * SSE is active the list refreshes on every ok `planTask`/`updateTask` result
 * frame — the BFF tap performs the GitHub write BEFORE forwarding the frame,
 * so the refresh lands the new/updated issue directly in the list (no draft
 * cards). A slow ~5s poll runs alongside as a backstop, then goes quiet again.
 */
export function useProjectTasks(projectId: string | undefined, state: TaskListState = 'open') {
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const planAbort = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setIsLoading(false);
      return;
    }
    try {
      const data = await api.listTasks(projectId, state);
      setTasks(data);
      setError(null);
    } catch (err) {
      console.error('Failed to load tasks:', err);
      setError('Failed to load tasks');
    } finally {
      setIsLoading(false);
    }
  }, [projectId, state]);

  // Initial load + reload when the state filter changes.
  useEffect(() => {
    setIsLoading(true);
    void refresh();
  }, [refresh]);

  // Auto-refresh only while a plan is streaming, so issues surface live (§8).
  useEffect(() => {
    if (!isPlanning) return undefined;
    const t = setInterval(() => void refresh(), PLAN_REFRESH_MS);
    return () => clearInterval(t);
  }, [isPlanning, refresh]);

  const plan = useCallback(async () => {
    if (!projectId || isPlanning) return;
    setPlanError(null);
    setIsPlanning(true);
    const ctrl = new AbortController();
    planAbort.current = ctrl;
    try {
      const result = await planTasks(
        projectId,
        {
          // The tap wrote the issue before this frame arrived — pull it into
          // the list so it materializes in the pending section right away.
          onPlanTaskResult: (_id, r: PlanTaskResult) => {
            if (r.ok) void refresh();
          },
          onUpdateTaskResult: (_id, r: UpdateTaskResult) => {
            if (r.ok) void refresh();
          },
        },
        ctrl.signal,
      );
      if (!result.ok) setPlanError(planErrorMessage(result));
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'Task planning failed.');
    } finally {
      setIsPlanning(false);
      planAbort.current = null;
      await refresh(); // final pull for the last issues created before [DONE]
    }
  }, [projectId, isPlanning, refresh]);

  // Abort the plan fetch on unmount — the BFF drains the upstream to completion
  // regardless, so no issues are orphaned by a tab close.
  useEffect(() => () => planAbort.current?.abort(), []);

  return {
    tasks,
    isLoading,
    error,
    refresh,
    plan,
    isPlanning,
    planError,
    clearPlanError: () => setPlanError(null),
  };
}
