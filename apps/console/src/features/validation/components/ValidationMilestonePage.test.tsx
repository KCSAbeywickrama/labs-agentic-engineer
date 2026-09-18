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

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { components } from "../../../generated/aep-api";

type ValidationDetail = components["schemas"]["ValidationDetail"];
type MilestoneRunView = components["schemas"]["MilestoneRunView"];
type RunCycleView = components["schemas"]["RunCycleView"];

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

// The log feed opens an SSE connection on mount; this page only decides
// WHETHER it is mounted, which is what the collapse test below asserts.
const runFeed = vi.fn();
vi.mock("../../builds/components/RunFeed", () => ({
  RunFeed: (props: { runId: string }) => {
    runFeed(props);
    return <div data-testid="run-feed">{props.runId}</div>;
  },
}));

let mockDetail: ValidationDetail | undefined;
let mockDetailState = { isPending: false, isError: false };
let mockSnapshot: { report?: string | null; criteria: unknown[] } | undefined;
const startMutate = vi.fn();
const cancelMutate = vi.fn();
const snapshotCalls: { cycleId: string; enabled: boolean }[] = [];

vi.mock("../api/queries", () => ({
  useValidation: () => ({
    data: mockDetail,
    isPending: mockDetailState.isPending,
    isError: mockDetailState.isError,
    error: null,
    refetch: vi.fn(),
  }),
  useValidationSnapshot: (
    _p: string,
    _t: string,
    cycleId: string,
    enabled: boolean,
  ) => {
    snapshotCalls.push({ cycleId, enabled });
    return {
      data: enabled ? mockSnapshot : undefined,
      isPending: false,
      isError: false,
    };
  },
  useStartValidation: () => ({ mutate: startMutate, isPending: false }),
}));

vi.mock("../../builds/api/queries", () => ({
  useCancelRun: () => ({ mutate: cancelMutate, isPending: false }),
}));
vi.mock("../../projects/api/queries", () => ({
  useProjectStatus: () => ({ data: undefined, isError: false }),
}));
vi.mock("../../tasks/api/queries", () => ({
  useTask: () => ({ data: undefined }),
}));

import { ValidationMilestonePage } from "./ValidationMilestonePage";

const cycle = (over: Partial<RunCycleView> = {}): RunCycleView =>
  ({
    id: "c1",
    kind: "validation",
    attempts: 1,
    createdAt: "2026-08-14T16:20:00Z",
    endedAt: "2026-08-14T16:52:47Z",
    mergeSha: "abc1234",
    validationVerdict: "passed",
    validationIssue: 7,
    recording: "complete",
    ...over,
  }) as RunCycleView;

const run = (over: Partial<MilestoneRunView> = {}): MilestoneRunView =>
  ({
    id: "r1",
    kind: "validation",
    origin: "revalidate",
    state: "succeeded",
    milestoneNumber: 1,
    milestoneTitle: "v1",
    budgets: {},
    validation: { verdict: "passed" },
    cycles: [cycle()],
    createdAt: "2026-08-14T16:00:00Z",
    ...over,
  }) as MilestoneRunView;

const detail = (over: Partial<ValidationDetail> = {}): ValidationDetail => ({
  tag: "v1",
  milestoneNumber: 1,
  state: "passed",
  live: false,
  runs: [run()],
  ...over,
});

beforeEach(() => {
  mockDetail = detail();
  mockDetailState = { isPending: false, isError: false };
  mockSnapshot = { report: '{"schemaVersion":2,"scenarios":[]}', criteria: [] };
  snapshotCalls.length = 0;
  startMutate.mockClear();
  cancelMutate.mockClear();
  runFeed.mockClear();
});

describe("ValidationMilestonePage", () => {
  it("names the version and its verdict", () => {
    render(<ValidationMilestonePage projectName="p" tag="v1" />);
    expect(screen.getByText("Validation v1")).toBeInTheDocument();
    expect(screen.getAllByText("Validated").length).toBeGreaterThan(0);
  });

  // The two cards exist because reports outlive logs: rows and reports are kept
  // forever, the agent's recording is pruned at 30 days (ADR-0027).
  it("puts the report above the log", () => {
    render(<ValidationMilestonePage projectName="p" tag="v1" />);
    const report = screen.getByText("Acceptance report");
    const log = screen.getByText("Validation log");
    expect(report.compareDocumentPosition(log) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Only the newest attempt is fetched with the page — the verdict card needs
  // its counts. Older ones cost a whole report plus every feature file, and
  // load when opened.
  it("fetches only the newest attempt's snapshot on arrival", () => {
    mockDetail = detail({
      runs: [
        run({
          cycles: [
            cycle({ id: "old", validationVerdict: "failed" }),
            cycle({ id: "new" }),
          ],
        }),
      ],
    });
    render(<ValidationMilestonePage projectName="p" tag="v1" />);

    const enabled = snapshotCalls.filter((c) => c.enabled).map((c) => c.cycleId);
    expect(enabled).toContain("new");
    expect(enabled).not.toContain("old");
  });

  // LogSection unmounts its children when collapsed, so a settled version opens
  // no SSE connection until the reader asks for one.
  it("collapses the log on a settled version and opens it on a live one", () => {
    render(<ValidationMilestonePage projectName="p" tag="v1" />);
    expect(screen.queryByTestId("run-feed")).not.toBeInTheDocument();

    mockDetail = detail({ state: "running", live: true });
    render(<ValidationMilestonePage projectName="p" tag="v1" />);
    expect(screen.getAllByTestId("run-feed").length).toBeGreaterThan(0);
  });

  describe("the empty states", () => {
    // The split is the same boolean that enables the trigger, so the sentence
    // and the control cannot contradict each other.
    it("says to wait while a run is still working the version", () => {
      mockDetail = detail({ state: "none", live: true, runs: [] });
      render(<ValidationMilestonePage projectName="p" tag="v1" />);
      expect(screen.getByText(/After a deployment/)).toBeInTheDocument();
      expect(screen.queryByText(/Run validation to check/)).not.toBeInTheDocument();
    });

    it("invites the trigger when nothing is running", () => {
      mockDetail = detail({ state: "none", live: false, runs: [] });
      render(<ValidationMilestonePage projectName="p" tag="v1" />);
      expect(screen.getByText(/Run validation to check/)).toBeInTheDocument();
    });

    it("does not invite a run on a version with no criteria", () => {
      mockDetail = detail({ state: "skipped", live: false, runs: [] });
      render(<ValidationMilestonePage projectName="p" tag="v1" />);
      expect(screen.getByText(/no acceptance criteria/)).toBeInTheDocument();
      expect(screen.queryByText(/Run validation to check/)).not.toBeInTheDocument();
    });
  });

  describe("the actions menu", () => {
    const open = () => fireEvent.click(screen.getByLabelText("Validation actions"));

    it('drops "again" until something has answered', () => {
      mockDetail = detail({ state: "none", live: false, runs: [] });
      render(<ValidationMilestonePage projectName="p" tag="v1" />);
      open();
      expect(screen.getByText("Run validation")).toBeInTheDocument();
    });

    it('says "again" once an attempt has produced a verdict', () => {
      render(<ValidationMilestonePage projectName="p" tag="v1" />);
      open();
      expect(screen.getByText("Run validation again")).toBeInTheDocument();
    });

    // The console checks ONE condition. Gating on the verdict too would invent
    // a rule the API does not have — re-asking a passed version is the point.
    it("offers a re-run on a version that already passed", () => {
      render(<ValidationMilestonePage projectName="p" tag="v1" />);
      open();
      fireEvent.click(screen.getByText("Run validation again"));
      expect(startMutate).toHaveBeenCalled();
    });

    it("refuses only while a run is live on the milestone", () => {
      mockDetail = detail({ state: "running", live: true });
      render(<ValidationMilestonePage projectName="p" tag="v1" />);
      open();
      fireEvent.click(screen.getByText("Run validation again"));
      expect(startMutate).not.toHaveBeenCalled();
    });

    // ADR-0016 decision 7: cancel follows the LIFECYCLE, not run liveness.
    it("offers cancel on the two lifecycle states and no others", () => {
      render(<ValidationMilestonePage projectName="p" tag="v1" />);
      open();
      fireEvent.click(screen.getByText("Cancel run"));
      expect(cancelMutate).not.toHaveBeenCalled();

      mockDetail = detail({ state: "awaiting-fix", live: true });
      render(<ValidationMilestonePage projectName="p" tag="v1" />);
      fireEvent.click(screen.getAllByLabelText("Validation actions")[1]!);
      fireEvent.click(screen.getAllByText("Cancel run")[1]!);
      expect(cancelMutate).toHaveBeenCalled();
    });

    it("surfaces a refusal from the server in the page's one error slot", () => {
      render(<ValidationMilestonePage projectName="p" tag="v1" />);
      open();
      fireEvent.click(screen.getByText("Run validation again"));
      const onError = startMutate.mock.calls[0]?.[1]?.onError as (e: Error) => void;
      act(() => {
        onError(new Error("this version still has open work"));
      });
      expect(screen.getByText("this version still has open work")).toBeInTheDocument();
    });
  });
});
