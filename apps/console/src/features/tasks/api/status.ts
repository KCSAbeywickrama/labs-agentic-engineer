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

// The four chip states of the task list (#173 decisions): the user watches
// chips go green; failures must stand out (humans intervene on failure).
// An unknown derivedStatus renders red with its raw value so nothing hides.
export interface TaskChip {
  label: string;
  color: "default" | "info" | "success" | "error";
}

const CHIP_BY_STATUS: Record<string, TaskChip> = {
  pending: { label: "Pending", color: "default" },
  on_hold: { label: "Pending", color: "default" },
  in_progress: { label: "Ongoing", color: "info" },
  ready_for_review: { label: "Ongoing", color: "info" },
  merged: { label: "Ongoing", color: "info" },
  building: { label: "Ongoing", color: "info" },
  deployed: { label: "Done", color: "success" },
  failed: { label: "Failed", color: "error" },
  rejected: { label: "Failed", color: "error" },
  abandoned: { label: "Failed", color: "error" },
};

export function taskChip(derivedStatus: string): TaskChip {
  return CHIP_BY_STATUS[derivedStatus] ?? { label: derivedStatus, color: "error" };
}

// Non-terminal statuses: while any task is in one of these, the list keeps
// polling; once everything settles, polling stops (#173 decisions).
const ACTIVE_STATUSES = new Set([
  "pending",
  "on_hold",
  "in_progress",
  "ready_for_review",
  "merged",
  "building",
]);

export function isActiveStatus(derivedStatus: string): boolean {
  return ACTIVE_STATUSES.has(derivedStatus);
}
