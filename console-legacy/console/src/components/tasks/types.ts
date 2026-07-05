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

import type { TaskStatus } from '../../services/api';

export type SectionKey = 'active' | 'pending' | 'onHold' | 'done' | 'blocked';

export interface SectionConfig {
  key: SectionKey;
  label: string;
  /** The derivedStatus values that fall into this section. */
  statuses: TaskStatus[];
  isPrimary: boolean;
  dotColor: string | null;
  borderColor: string | null;
}

/**
 * The task-page sections, in display order. Every derivedStatus maps to exactly
 * one section — the console groups client-side off the API's derivedStatus (§4,
 * §8 of docs/design/tasks-github-native.md).
 */
export const TASK_SECTIONS: SectionConfig[] = [
  { key: 'active',  label: 'In Progress',     statuses: ['in_progress', 'ready_for_review', 'merged', 'building'], isPrimary: true,  dotColor: 'primary',      borderColor: null },
  { key: 'pending', label: 'Pending',         statuses: ['pending'],                                               isPrimary: false, dotColor: null,           borderColor: null },
  { key: 'onHold',  label: 'On Hold',         statuses: ['on_hold'],                                               isPrimary: false, dotColor: 'warning.main', borderColor: 'warning.main' },
  { key: 'done',    label: 'Deployed',        statuses: ['deployed'],                                              isPrimary: false, dotColor: 'success.main', borderColor: null },
  { key: 'blocked', label: 'Needs attention', statuses: ['failed', 'rejected', 'abandoned'],                       isPrimary: false, dotColor: 'error.main',   borderColor: 'error.main' },
];

/**
 * derivedStatus values where a Task is still in-flight in the pipeline
 * (non-terminal / still moving or held). The single source of truth for
 * "is this task active?" — drives progress polling and the project stage's
 * `active` state. `deployed`/`rejected`/`abandoned`/`failed` are terminal.
 */
export const ACTIVE_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'pending',
  'on_hold',
  'in_progress',
  'ready_for_review',
  'merged',
  'building',
]);

/**
 * derivedStatus values where an execution is (or will be) moving through the
 * pipeline — ACTIVE_TASK_STATUSES minus `on_hold` (held work is active but not
 * in flight). Drives live pulses and progress polling.
 */
export const IN_FLIGHT_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set(
  [...ACTIVE_TASK_STATUSES].filter((s) => s !== 'on_hold'),
);

/**
 * derivedStatus values for which an Execute (dispatch/retry) is meaningful —
 * always paired with `!task.hold` by callers.
 */
export const EXECUTABLE_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'pending',
  'failed',
  'rejected',
]);

/** derivedStatus values that can still be held (not already terminal). */
export const HOLDABLE_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'pending',
  'in_progress',
  'ready_for_review',
  'merged',
  'building',
  'failed',
  'rejected',
]);

export type StatusTone = 'primary' | 'success' | 'warning' | 'error' | 'muted';

/** Per-derivedStatus pill label + tone (rows + detail header). */
export const STATUS_DISPLAY: Record<TaskStatus, { label: string; tone: StatusTone }> = {
  pending:          { label: 'Pending',          tone: 'muted'   },
  in_progress:      { label: 'In Progress',      tone: 'primary' },
  ready_for_review: { label: 'Ready for review', tone: 'primary' },
  merged:           { label: 'Merged',           tone: 'primary' },
  building:         { label: 'Building',         tone: 'primary' },
  deployed:         { label: 'Deployed',         tone: 'success' },
  rejected:         { label: 'Rejected',         tone: 'warning' },
  abandoned:        { label: 'Abandoned',        tone: 'muted'   },
  failed:           { label: 'Failed',           tone: 'error'   },
  on_hold:          { label: 'On Hold',          tone: 'muted'   },
};

/** MUI Chip color vocabulary the status tones map onto. */
export type StatusChipColor = 'default' | 'primary' | 'warning' | 'success' | 'error';

export const TONE_TO_CHIP: Record<StatusTone, StatusChipColor> = {
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  error: 'error',
  muted: 'default',
};

/**
 * Chip label + color for an effective status, which is either a Task
 * derivedStatus (all 10 handled via STATUS_DISPLAY) or a bare OC component
 * status like `created` when no Task exists yet.
 */
export function displayStatus(status: string): { label: string; color: StatusChipColor } {
  const d = (STATUS_DISPLAY as Record<string, { label: string; tone: StatusTone }>)[status];
  if (d) return { label: d.label, color: TONE_TO_CHIP[d.tone] };
  if (status === 'created') return { label: 'Created', color: 'default' };
  return { label: status, color: 'default' };
}
