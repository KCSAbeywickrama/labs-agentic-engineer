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
import { api } from '../services/api';
import type { ProjectBuildStatus, TaskView } from '../services/api';

export type TaskListState = 'open' | 'closed' | 'all';

const BUILD_POLL_MS = 3000;

/**
 * The tasks-page data hook: a live GitHub ⋈ executions list with a manual
 * refresh, plus the build watcher. Tasks are created server-side by the build
 * workflow (Build on the Design page → tag → plan → execute), so there is no
 * plan button here — while a build is active the hook polls its status every
 * ~3s and refreshes the task list alongside, then goes quiet on a terminal
 * status. `buildTagHint` (router state from the Build navigation) names the
 * build to watch; without it the latest spec tag is resolved from the server
 * so a reload keeps watching the same run.
 */
export function useProjectTasks(
  projectId: string | undefined,
  state: TaskListState = 'open',
  buildTagHint?: string,
) {
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buildTag, setBuildTag] = useState<string | null>(buildTagHint ?? null);
  const [build, setBuild] = useState<ProjectBuildStatus | null>(null);
  // The poller reads the tag from a ref so the interval survives re-renders.
  const buildTagRef = useRef<string | null>(buildTagHint ?? null);

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

  // Resolve which build to watch: the navigation hint, else the newest spec
  // tag (a page reload mid-build must keep watching the same run).
  useEffect(() => {
    if (!projectId) return;
    if (buildTagHint) {
      buildTagRef.current = buildTagHint;
      setBuildTag(buildTagHint);
      return;
    }
    let cancelled = false;
    void (async () => {
      const tags = await api.listProjectTags(projectId);
      if (cancelled || !tags?.latest) return;
      buildTagRef.current = tags.latest;
      setBuildTag(tags.latest);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, buildTagHint]);

  const isBuilding = build?.status === 'started' || build?.status === 'in_progress';

  // Watch the build: one immediate read, then a ~3s poll while non-terminal.
  // Each poll also refreshes the task list so workflow-created issues appear
  // without any button press. 404 (no build for the tag) ends the watch.
  useEffect(() => {
    if (!projectId || !buildTag) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      try {
        const status = await api.getProjectBuild(projectId, buildTag);
        if (cancelled) return;
        setBuild(status);
        void refresh();
        if (status.status === 'completed' || status.status === 'failed') {
          if (timer) clearInterval(timer);
        }
      } catch {
        // 404 → no build for this tag (or it aged out); stop watching.
        if (cancelled) return;
        setBuild(null);
        if (timer) clearInterval(timer);
      }
    };

    void poll();
    timer = setInterval(() => void poll(), BUILD_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [projectId, buildTag, refresh]);

  return {
    tasks,
    isLoading,
    error,
    refresh,
    build,
    buildTag,
    isBuilding,
  };
}
