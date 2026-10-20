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

import { type TaskLogPhase, useTaskLog } from "../hooks/useTaskLog";
import { taskLogLines } from "../model/run";
import { LogLines } from "./CardSection";

/** What an empty log says while its connection is open or reopening. */
const EMPTY: Record<Exclude<TaskLogPhase, "ended">, string> = {
  connecting: "Attaching to the task's log…",
  live: "Attached. Nothing logged for this task yet.",
  reconnecting: "Connection lost, reconnecting…",
};

/** Where a closed, empty task log's work is, by the task's kind. */
const ENDED: Record<string, string> = {
  development: "No log of its own: the coding agent's log has this task's work.",
  bug: "No log of its own: the coding agent's log has this task's work.",
  conflict: "No log of its own: the coding agent's log has this task's work.",
  validation: "No log of its own: the version's validation has this task's work.",
  provision: "No log: the platform resolves this gate itself.",
};

/** One task's live log, as the Build card's task row and the Issue card show it. */
export function TaskLog({ projectName, issueNumber }: { projectName: string; issueNumber: number }) {
  const log = useTaskLog(projectName, issueNumber);
  const empty = log.phase === "ended" ? (ENDED[log.kind ?? ""] ?? "Nothing logged for this task.") : EMPTY[log.phase];
  return <LogLines lines={taskLogLines(log.lines, log.executions)} empty={empty} maxHeight={260} />;
}

