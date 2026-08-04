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

import { describe, expect, it } from "vitest";
import type { components } from "../../../generated/aep-api";
import { bucketMilestone, openCycleClaims } from "./milestoneBuckets";

type TaskView = components["schemas"]["TaskView"];
type RunCycleView = components["schemas"]["RunCycleView"];

function issue(issueNumber: number, derivedStatus: string): TaskView {
  return {
    issueNumber,
    title: `issue ${issueNumber}`,
    issueUrl: `https://github.com/o/r/issues/${issueNumber}`,
    derivedStatus,
    executions: {},
  } as TaskView;
}

function cycle(over: Partial<RunCycleView> & { id: string }): RunCycleView {
  return {
    kind: "coding",
    attempts: 1,
    createdAt: "2026-08-04T04:35:00Z",
    ...over,
  } as RunCycleView;
}

const numbers = (tasks: TaskView[]) => tasks.map((t) => t.issueNumber);

describe("openCycleClaims", () => {
  it("takes claims only from a cycle that is still open", () => {
    const claims = openCycleClaims([
      // Closed cycle: its merge already closed its issues — claims are history.
      cycle({ id: "c1", resolves: [3, 4], endedAt: "2026-08-04T05:00:00Z" }),
      cycle({ id: "c2", resolves: [7] }),
    ]);

    expect([...claims]).toEqual([7]);
  });

  it("claims nothing before the open cycle records a matched set", () => {
    // Before the pull request opens there is no recorded claim — the NOW panel
    // narrates the working set then, with a caption saying it is a guess.
    expect([...openCycleClaims([cycle({ id: "c1" })])]).toEqual([]);
  });

  it("claims nothing when every cycle is over", () => {
    expect([
      ...openCycleClaims([
        cycle({ id: "c1", resolves: [3], endedAt: "2026-08-04T05:00:00Z" }),
      ]),
    ]).toEqual([]);
  });
});

describe("bucketMilestone", () => {
  it("reads a merged issue as CLOSED — closing is what a merge does", () => {
    // The regression this pins: with the retired ten-value bucketing, a merged
    // issue fell into "in progress" AT the very merge that closed it, and the
    // closed count sat at zero forever.
    const buckets = bucketMilestone(
      [issue(3, "merged"), issue(4, "merged")],
      new Set(),
    );

    expect(numbers(buckets.closed)).toEqual([3, 4]);
    expect(buckets.inProgress).toEqual([]);
    expect(buckets.open).toEqual([]);
  });

  it("puts an issue in progress only while an open cycle claims it", () => {
    const buckets = bucketMilestone(
      [issue(3, "pending"), issue(4, "pending")],
      new Set([4]),
    );

    expect(numbers(buckets.inProgress)).toEqual([4]);
    expect(numbers(buckets.open)).toEqual([3]);
  });

  it("never marks a merged issue in progress, claimed or not", () => {
    const buckets = bucketMilestone([issue(3, "merged")], new Set([3]));

    expect(numbers(buckets.closed)).toEqual([3]);
    expect(buckets.inProgress).toEqual([]);
  });

  it("presumes the open work in progress while a session is live and unclaimed", () => {
    // The NOW panel's own inference, applied to the panel: before the pull
    // request there is no recorded set, and "the agent is working these" is
    // more truthful than "open".
    const buckets = bucketMilestone(
      [issue(3, "pending"), issue(4, "merged")],
      new Set(),
      true,
    );

    expect(numbers(buckets.inProgress)).toEqual([3]);
    expect(numbers(buckets.closed)).toEqual([4]);
    expect(buckets.open).toEqual([]);
  });

  it("lets a recorded claim outrank the presumption", () => {
    // Once resolves exist the working set is exact — the unclaimed remainder
    // is genuinely open, so the presumption must not fire alongside claims.
    const buckets = bucketMilestone(
      [issue(3, "pending"), issue(4, "pending")],
      new Set([3]),
      false,
    );

    expect(numbers(buckets.inProgress)).toEqual([3]);
    expect(numbers(buckets.open)).toEqual([4]);
  });

  it("counts a status it does not know as open, not closed", () => {
    const buckets = bucketMilestone([issue(9, "something-new")], new Set());

    expect(numbers(buckets.open)).toEqual([9]);
    expect(buckets.closed).toEqual([]);
  });
});
