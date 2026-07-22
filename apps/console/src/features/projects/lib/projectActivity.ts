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

import type { StatusTone } from "../../../components/StatusChip";
import type { components } from "../../../generated/aep-api";
import { taskChip } from "../../tasks/api/status";

type TaskView = components["schemas"]["TaskView"];

// The overview's "agent activity" feed and per-component roll-up are both
// DERIVED from the build tasks — the platform has no dedicated activity-event
// stream yet, so each task's status is turned into one activity line and each
// component's status is the roll-up of its tasks. (No per-task timestamps
// exist in the data, so the feed intentionally omits "N min ago" for now.)

const TONE_RANK: Record<StatusTone, number> = {
  error: 0,
  warning: 1,
  info: 2,
  primary: 3,
  success: 4,
  neutral: 5,
};

export interface ActivityItem {
  id: string;
  tone: StatusTone;
  /** Bold lead-in, e.g. "Build agent" / "You". */
  actor: string;
  /** The rest of the line, e.g. "failed task #11 Orders payment integration". */
  text: string;
  /** Relative time. Placeholder for now — the data carries no per-event
   *  timestamps yet, so these are illustrative, newest-first. */
  time: string;
}

// Illustrative relative times (newest first) until real event timestamps land.
const PLACEHOLDER_TIMES = [
  "4 min ago",
  "6 min ago",
  "22 min ago",
  "45 min ago",
  "1 hr ago",
];

function verbFor(tone: StatusTone): string {
  if (tone === "error") return "failed task";
  if (tone === "success") return "completed";
  return "is working on";
}

/** One activity line per task (skipping not-yet-started ones), most-urgent
 *  first (failed → in-progress → done), then the milestone events. */
export function agentActivity(tasks: TaskView[]): ActivityItem[] {
  const specTag = tasks[0]?.lineage?.specTag ?? "v1";

  const taskItems = tasks
    .map((t) => ({ t, tone: taskChip(t.derivedStatus).tone }))
    // "neutral" == pending: the agent hasn't picked it up, so it isn't activity.
    .filter(({ tone }) => tone !== "neutral")
    .sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.t.issueNumber - a.t.issueNumber)
    .map(({ t, tone }) => ({
      id: `task-${t.issueNumber}`,
      tone,
      actor: "Build agent",
      text: `${verbFor(tone)} #${t.issueNumber} ${t.title}`,
    }));

  const milestones =
    tasks.length === 0
      ? []
      : [
          {
            id: "published",
            tone: "neutral" as StatusTone,
            actor: "You",
            text: `published spec ${specTag} and started build`,
          },
          {
            id: "planned",
            tone: "neutral" as StatusTone,
            actor: "Plan agent",
            text: `derived ${tasks.length} build tasks from the architecture`,
          },
        ];

  return [...taskItems, ...milestones].map((item, i) => ({
    ...item,
    time: PLACEHOLDER_TIMES[Math.min(i, PLACEHOLDER_TIMES.length - 1)] ?? "earlier",
  }));
}

/** A component's build state is the roll-up of its tasks: any failed → Failed,
 *  any still working → Building, otherwise Deployed. Falls back to Pending
 *  when the plan hasn't produced tasks for it yet. */
export function componentStatus(
  componentName: string,
  tasks: TaskView[],
): { label: string; tone: StatusTone } {
  const own = tasks.filter((t) => t.component === componentName);
  if (own.length === 0) return { label: "Pending", tone: "neutral" };
  const tones = own.map((t) => taskChip(t.derivedStatus).tone);
  if (tones.includes("error")) return { label: "Failed", tone: "error" };
  if (tones.some((tone) => tone !== "success")) {
    return { label: "Building", tone: "info" };
  }
  return { label: "Deployed", tone: "success" };
}
