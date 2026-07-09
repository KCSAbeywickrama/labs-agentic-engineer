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

import { api } from '../services/api';
import { useCursorPolling } from './useCursorPolling';

// useExecutionProgress polls the Task log feed (/tasks/{issueNumber}/log),
// pinned to the selected execution and kind-agnostic (the BFF selects the
// source — coding-agent pod logs, synthetic build steps, etc. — from the
// execution's kind). It fetches once for any execution (so a terminal one
// shows its historical feed) and only polls while `isRunning`; a final:true
// response freezes the feed.
export function useExecutionProgress(
  projectId: string | undefined,
  issueNumber: number | undefined,
  executionId: string | undefined,
  isRunning: boolean,
) {
  const { lines, phase, final, isLoading, error } = useCursorPolling({
    queryKey: ['executionProgress', projectId, issueNumber, executionId],
    fetcher: (cursor) => api.getExecutionProgress(projectId!, issueNumber!, cursor, executionId),
    enabled: !!projectId && Number.isFinite(issueNumber) && !!executionId,
    isLive: isRunning,
    taskIdentity: executionId,
    trackPhase: true,
  });

  return { lines, phase, final, isLoading, error };
}
