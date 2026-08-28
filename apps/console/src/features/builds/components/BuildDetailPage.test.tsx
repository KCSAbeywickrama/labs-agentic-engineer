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

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { components } from "../../../generated/aep-api";

type BuildSummary = components["schemas"]["BuildSummary"];
type TaskView = components["schemas"]["TaskView"];
type DeployStage = components["schemas"]["DeployStage"];
type RunCycleView = components["schemas"]["RunCycleView"];
type MilestoneRunView = components["schemas"]["MilestoneRunView"];

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
  createLink:
    () =>
    ({ to, children }: { to?: string; children?: React.ReactNode }) => (
      <a href={to}>{children}</a>
    ),
}));

let mockBuilds: BuildSummary[] = [];
let mockTasks: TaskView[] = [];
let mockDeploy: DeployStage | undefined;
let mockRuns: MilestoneRunView[] = [];

vi.mock("../api/queries", () => ({
  useBuilds: () => ({ data: mockBuilds, isPending: false, isError: false, refetch: vi.fn() }),
  useBuildRuns: () => ({ data: { runs: mockRuns }, isPending: false, isError: false }),
  useCancelRun: () => ({ mutate: vi.fn(), isPending: false }),
  useCycleBuilds: () => ({ data: undefined, isPending: false, isError: false }),
}));
vi.mock("../../tasks/api/queries", () => ({
  useAllTasks: () => ({ data: mockTasks, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("../../projects/api/queries", () => ({
  useProjectStatus: () => ({ data: mockDeploy ? { deploy: mockDeploy } : undefined }),
}));
// The agent log opens a polling reader of its own; this page's summary card is
// what is under test.
vi.mock("../hooks/useBuildLog", () => ({
  useBuildLog: () => ({ lines: [], isPending: false, isError: false, isComplete: true }),
}));
vi.mock("../hooks/useRunProgress", () => ({
  useRunProgress: () => ({ cycles: [], settledState: undefined, phase: undefined }),
}));

import { BuildDetailPage } from "./BuildDetailPage";

const build = (over: Partial<BuildSummary> = {}): BuildSummary => ({
  tag: "v5",
  milestoneNumber: 5,
  status: "in_progress",
  startedAt: "2026-08-28T09:35:04Z",
  ...over,
});

const task = (issueNumber: number, over: Partial<TaskView> = {}): TaskView => ({
  issueNumber,
  title: `Task ${issueNumber}`,
  issueUrl: `https://github.com/acme-dev/demo-shop/issues/${issueNumber}`,
  executorClass: "coding",
  dependsOn: [],
  lineage: { specTag: "v5" },
  derivedStatus: "pending",
  hold: false,
  attention: [],
  executions: {},
  ...over,
});

const merged = (issueNumber: number) => task(issueNumber, { derivedStatus: "merged" });

const cycle = (over: Partial<RunCycleView> = {}): RunCycleView => ({
  id: "cycle-1",
  kind: "coding",
  attempts: 1,
  createdAt: "2026-08-28T09:36:00Z",
  ...over,
});

const run = (
  cycles: RunCycleView[],
  over: Partial<MilestoneRunView> = {},
): MilestoneRunView => ({
  id: "run-1",
  milestoneNumber: 5,
  milestoneTitle: "Milestone 5",
  kind: "dev",
  state: "running",
  origin: "spec-build",
  createdAt: "2026-08-28T09:35:04Z",
  cycles,
  budgets: {
    cyclesTotal: 1,
    cycleCeiling: 8,
    fixCycles: 0,
    conflictCycles: 0,
    buildRetriggers: 0,
    validationCycles: 0,
  },
  validation: {},
  ...over,
});

const renderPage = () => render(<BuildDetailPage projectName="demo-shop" tag="v5" />);
const deploymentsLink = () => screen.queryByText("Go to Deployments");

beforeEach(() => {
  mockBuilds = [build()];
  mockTasks = [];
  mockDeploy = undefined;
  mockRuns = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("BuildDetailPage — the Deployments link", () => {
  it("stays away until a pull request has merged", () => {
    // The reported bug: the card offered a board that had nothing to show for
    // this version, beside a note saying it deploys as its tasks merge.
    mockTasks = [task(1), task(2)];
    mockRuns = [run([cycle({ prNumber: 4, mergeSha: "" })])];
    renderPage();
    expect(deploymentsLink()).toBeNull();
    // The note stays: the card must still say what has to happen.
    expect(screen.getByText("v5 deploys as its tasks merge.")).toBeTruthy();
  });

  it("is not fooled by closed issues that no pull request ever produced", () => {
    // The live case that corrected this gate: a cancelled run whose two tasks
    // both read `derivedStatus: "merged"` — the field only says the issue is
    // closed — while its one cycle had `prNumber` 0 and no merge SHA.
    mockTasks = [merged(1), merged(2)];
    mockRuns = [run([cycle({ prNumber: 0, mergeSha: "" })], { state: "cancelled" })];
    renderPage();
    expect(deploymentsLink()).toBeNull();
  });

  it("appears once a cycle records a merge", () => {
    mockTasks = [merged(1), merged(2)];
    mockRuns = [run([cycle({ prNumber: 4, mergeSha: "abc1234" })])];
    renderPage();
    expect(deploymentsLink()).toBeTruthy();
  });

  it("asks every run of the version, not just the newest", () => {
    // A version whose coding cycle merged pull request #15, later reworked by a
    // `task` run that opened no cycle at all. Reading only the newest run made
    // merged code look unmerged.
    mockTasks = [merged(1)];
    mockRuns = [
      run([], { id: "newer", kind: "task", state: "cancelled" }),
      run([cycle({ prNumber: 15, mergeSha: "c185b23" })], { id: "older" }),
    ];
    renderPage();
    expect(deploymentsLink()).toBeTruthy();
  });

  it("appears for a version the platform has already deployed", () => {
    mockTasks = [merged(1), task(2)];
    mockDeploy = {
      version: "v5",
      status: "deployed",
      components: { total: 3, ready: 3 },
      validation: "passed",
    };
    renderPage();
    expect(deploymentsLink()).toBeTruthy();
    expect(screen.getByText("v5 is live in development.")).toBeTruthy();
  });

  it("stays away when there is no run to have merged anything", () => {
    mockTasks = [];
    mockRuns = [];
    renderPage();
    expect(deploymentsLink()).toBeNull();
  });
});

describe("BuildDetailPage — the Duration cell", () => {
  it("counts up second by second while the build has not ended", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T09:55:00Z"));
    mockBuilds = [build({ completedAt: null })];
    renderPage();

    expect(screen.getByText("19m 56s")).toBeTruthy();
    expect(screen.getByText(/and counting/)).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    // No refetch, no new data — the card re-rendered on its own clock. Before
    // this, react-query's structural sharing meant the number never moved.
    expect(screen.getByText("20m 00s")).toBeTruthy();
  });

  it("freezes a finished build, and drops 'and counting' with it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T09:55:00Z"));
    mockBuilds = [
      build({ status: "completed", completedAt: "2026-08-28T09:54:57Z" }),
    ];
    renderPage();

    expect(screen.getByText("19m 53s")).toBeTruthy();
    expect(screen.queryByText(/and counting/)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText("19m 53s")).toBeTruthy();
  });

  it("keeps counting a build whose status has settled but whose end is unrecorded", () => {
    // `and counting` used to key on `isLedgerLive`, so a build that had left
    // in_progress without an end stamp showed a frozen number with no hint
    // that it was still open.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T09:55:00Z"));
    mockBuilds = [build({ status: "completed", completedAt: null })];
    renderPage();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText("19m 58s")).toBeTruthy();
  });
});
