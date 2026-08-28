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

// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { components } from "../../../generated/aep-api";

type MilestoneRunView = components["schemas"]["MilestoneRunView"];
type TaskView = components["schemas"]["TaskView"];

// Router stubbed to plain anchors — no RouterProvider needed. The provisioning
// section's way out is a createLink Button, and RunDelivered navigates, so both
// have to survive the stub.
vi.mock("@tanstack/react-router", () => ({
  createLink:
    (Component: React.ElementType) =>
    ({
      to,
      params,
      search,
      hash,
      children,
      ...rest
    }: {
      to: string;
      params?: Record<string, string>;
      search?: Record<string, string>;
      hash?: string;
      children?: React.ReactNode;
    }) => {
      const path = Object.entries(params ?? {}).reduce(
        (acc, [k, v]) => acc.replace(`$${k}`, v),
        to,
      );
      const query = new URLSearchParams(search ?? {}).toString();
      return (
        <Component
          {...rest}
          component="a"
          href={`${path}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`}
        >
          {children}
        </Component>
      );
    },
  useNavigate: () => () => {},
}));

vi.mock("../api/queries", () => ({
  useCancelRun: () => ({ mutate: () => {}, isPending: false, isError: false }),
  useCycleBuilds: () => ({ data: undefined, isPending: false }),
}));

vi.mock("../hooks/useRunProgress", () => ({
  useRunProgress: () => ({
    cycles: [],
    phase: "live",
    settledState: undefined,
  }),
}));

import { RunStory } from "./RunStory";

function waitingRun(over: Partial<MilestoneRunView> = {}): MilestoneRunView {
  return {
    id: "run-1",
    milestoneNumber: 2,
    milestoneTitle: "v2",
    kind: "dev",
    origin: "spec-build",
    state: "waiting",
    budgets: {
      cyclesTotal: 1,
      cycleCeiling: 8,
      fixCycles: 0,
      conflictCycles: 0,
      buildRetriggers: 0,
      validationCycles: 0,
    },
    validation: {},
    cycles: [],
    createdAt: "2026-07-10T09:00:00Z",
    ...over,
  };
}

// One open agent issue, so the generic park is the "parked between sessions"
// branch rather than the empty-milestone one.
const openWork = [
  {
    issueNumber: 1,
    title: "issue 1",
    issueUrl: "https://github.com/acme/repo/issues/1",
    executorClass: "coding",
    dependsOn: [],
    lineage: {},
    derivedStatus: "pending",
    hold: false,
    attention: [],
    executions: {},
  } as unknown as TaskView,
];

function renderStory(
  run: MilestoneRunView,
  milestone?: { gates: TaskView[]; work: TaskView[] },
) {
  // Spread rather than pass `undefined`: under exactOptionalPropertyTypes an
  // absent milestone and an explicitly-undefined one are different types, and
  // "the issue plane has not answered yet" is the absent one.
  render(
    <RunStory
      projectName="acme"
      tag="v2"
      run={run}
      {...(milestone ? { milestone } : {})}
    />,
  );
}

// THE DEPLOY GATE's park (ADR-0023). It is unbounded and the only thing that
// ends it is a person typing a credential, so a card that renders `waiting` and
// nothing else reads as a hang — and the one developer who could clear it in ten
// seconds never learns there is anything to do. These pin that the card says so.
describe("a run parked on the deploy gate", () => {
  it("names the external resources it is waiting on, and where to add them", () => {
    renderStory(
      waitingRun({
        waitingReason: "external-values",
        blockingDependencies: ["stripe", "sendgrid"],
      }),
      { gates: [], work: openWork },
    );

    expect(
      screen.getByText(/Waiting for values: stripe, sendgrid/),
    ).toBeTruthy();
    // The call to action, and it points at THIS page's section: the values are
    // entered a scroll away, not behind a route.
    expect(
      screen.getByText(/Add each one under External resources below/),
    ).toBeTruthy();
    // Never the generic park — that sentence says there is nothing to do.
    expect(screen.queryByText(/Parked between build sessions/)).toBeNull();
  });

  it("explains the park before the milestone's issues have loaded", () => {
    // The park's cause is neither a gate nor the working set, so the notice must
    // not wait on the issue plane and flicker in later.
    renderStory(
      waitingRun({
        waitingReason: "external-values",
        blockingDependencies: ["stripe"],
      }),
      undefined,
    );

    expect(screen.getByText(/Waiting for values: stripe/)).toBeTruthy();
    expect(
      screen.getByText(/Add its values under External resources below/),
    ).toBeTruthy();
  });

  it("leaves an ordinary between-cycles park reading as before", () => {
    renderStory(waitingRun(), { gates: [], work: openWork });

    expect(screen.getByText(/Parked between build sessions/)).toBeTruthy();
    expect(screen.queryByText(/External resources below/)).toBeNull();
  });
});
