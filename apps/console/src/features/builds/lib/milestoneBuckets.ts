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

import type { components } from "../../../generated/aep-api";

type TaskView = components["schemas"]["TaskView"];
type RunCycleView = components["schemas"]["RunCycleView"];

// THE MILESTONE PANEL'S THREE BUCKETS, from facts only.
//
// An issue row carries a TWO-value derivedStatus — open (`pending`) or closed
// (`merged`) — because the platform puts mid-run liveness on the cycle
// timeline, never on rows (see tasks/api/status.ts). An earlier version of
// this panel bucketed with the retired ten-value vocabulary: its "closed"
// (`deployed`) never matched again, so a version sat at 0/N closed forever,
// and every merged issue fell through to a catch-all "in progress" — a CLOSED
// issue reading as in-progress, appearing there at the very merge that closed
// it.
//
// "In progress" is therefore DERIVED, not read off the row, from two sources
// of different strength. A CLAIM is a fact: the run's still-open build session
// recorded its matched set (`resolves`) when it opened its pull request. A
// PRESUMPTION covers the stretch before that: a live session with no claims
// yet is working the milestone's open issues — the same inference the NOW
// panel makes, with the same honesty rule: the note says "being worked", not
// "claimed", and the set becomes exact at the pull request.

export interface MilestoneBuckets {
  /** Claimed by the run's open cycle and not yet closed by a merge. */
  inProgress: TaskView[];
  /** Open and unclaimed — plus any status this console does not know, which
   *  must count as not-closed rather than vanish into a wrong bucket. */
  open: TaskView[];
  /** Closed by merge — the only way an agent issue closes. */
  closed: TaskView[];
}

/** Issue numbers the run's OPEN cycle has claimed. A closed cycle's claims are
 *  history — its merge already closed those issues — so only a cycle that is
 *  still running can put an issue "in progress". */
export function openCycleClaims(cycles: RunCycleView[]): ReadonlySet<number> {
  const open = cycles.find((cycle) => !cycle.endedAt);
  return new Set(open?.resolves ?? []);
}

export function bucketMilestone(
  work: TaskView[],
  claimed: ReadonlySet<number>,
  /** A build session is live with no recorded claims yet — presume it is
   *  working the open issues. Never set once claims exist: a recorded set
   *  outranks a guess, and the unclaimed remainder is genuinely open. */
  presumeOpenWork = false,
): MilestoneBuckets {
  const buckets: MilestoneBuckets = { inProgress: [], open: [], closed: [] };
  for (const task of work) {
    if (task.derivedStatus === "merged") buckets.closed.push(task);
    else if (
      claimed.has(task.issueNumber) ||
      (presumeOpenWork && task.derivedStatus === "pending")
    ) {
      buckets.inProgress.push(task);
    } else buckets.open.push(task);
  }
  return buckets;
}
