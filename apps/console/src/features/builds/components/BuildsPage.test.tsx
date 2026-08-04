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

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { components } from "../../../generated/aep-api";

type BuildSummary = components["schemas"]["BuildSummary"];
type MilestoneRunView = components["schemas"]["MilestoneRunView"];
type TaskView = components["schemas"]["TaskView"];

// Router stubbed to plain anchors — no RouterProvider needed. createLink is
// what the gate hold's deep link uses, so it has to survive the stub.
const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
  // The delivered result routes on to the deployments and validation boards.
  useNavigate: () => navigate,
  createLink: (Component: React.ElementType) =>
    ({
      to,
      params,
      search,
      children,
      ...rest
    }: {
      to: string;
      params?: Record<string, string>;
      search?: Record<string, string>;
      children?: React.ReactNode;
    }) => {
      const path = Object.entries(params ?? {}).reduce(
        (acc, [k, v]) => acc.replace(`$${k}`, v),
        to,
      );
      const query = new URLSearchParams(search ?? {}).toString();
      return (
        <Component {...rest} component="a" href={query ? `${path}?${query}` : path}>
          {children}
        </Component>
      );
    },
}));

// The settle-fetch effect is the only thing the page needs a client for.
const invalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

// The issue list is its own tested surface; here it is a marker that proves
// which liveness the page hands down.
vi.mock("../../tasks/components/IssueSections", () => ({
  IssueSections: ({ tag, live }: { tag: string; live: boolean }) => (
    <div data-testid="issues">{`${tag}:${String(live)}`}</div>
  ),
}));

// The build sessions open an SSE stream and read the cluster for builds; stub
// the whole block and record what it was handed, so this file stays about the
// PAGE (version selection, run cards, cancel) — RunSpine has its own test.
vi.mock("./RunSpine", () => ({
  RunSpine: ({
    run,
    work,
    gates,
  }: {
    run: MilestoneRunView;
    work: TaskView[];
    gates: TaskView[];
  }) => (
    <div
      data-testid="run-spine"
      data-work={work.map((t) => t.issueNumber).join(",")}
      data-gates={gates.map((t) => t.issueNumber).join(",")}
    >
      {run.cycles.map((c) => `${c.kind}:${c.branch ?? ""}:${c.mergeSha ?? ""}`).join("|")}
    </div>
  ),
}));

// The issue plane the run card reads to tell its holds apart. `undefined` is
// the list not having arrived yet, which is a different thing from an empty
// milestone.
let mockIssues: TaskView[] | undefined = [];
vi.mock("../../tasks/api/queries", () => ({
  useAllTasks: () => ({ data: mockIssues }),
}));

// The repo URL behind the milestone panel's "view all issues" link. Same query
// key the project layout already reads, so react-query serves it from cache
// rather than issuing a second request.
// The platform records a CLONE url — it carries a `.git` suffix.
const mockRepoUrl = "https://github.com/acme/demo.git";
vi.mock("../../projects/api/queries", () => ({
  useProjectStatus: () => ({ data: { repoUrl: mockRepoUrl } }),
}));

let mockBuilds: BuildSummary[] = [];
let mockRuns: MilestoneRunView[] = [];
// This merge's builds, as the cluster read answers them. `[]` is "the merge
// landed but no build has appeared yet", which leaves the Builds stage active.
let mockCycleBuilds: {
  component: string;
  status: string;
  completed: boolean;
}[] = [];
const cancelMutate = vi.fn();
const cancelState = { isPending: false, isError: false, error: null as unknown };

vi.mock("../api/queries", () => ({
  useBuilds: () => ({
    data: mockBuilds,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useBuildRuns: () => ({
    data: { tag: "v2", milestoneNumber: 2, runs: mockRuns },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCancelRun: () => ({ mutate: cancelMutate, ...cancelState }),
  useCycleBuilds: () => ({ data: mockCycleBuilds, isPending: false }),
}));

import { BuildsPage } from "./BuildsPage";

function build(tag: string, status: BuildSummary["status"]): BuildSummary {
  return {
    tag,
    milestoneNumber: Number(tag.slice(1)),
    status,
    startedAt: "2026-07-10T09:00:00Z",
  };
}

function run(over: Partial<MilestoneRunView> = {}): MilestoneRunView {
  return {
    id: "run-1",
    milestoneNumber: 2,
    milestoneTitle: "v2",
    origin: "spec-build",
    state: "running",
    budgets: {
      cyclesTotal: 2,
      cycleCeiling: 8,
      fixCycles: 1,
      conflictCycles: 0,
      buildRetriggers: 0,
      validationCycles: 0,
    },
    validation: {},
    cycles: [
      {
        id: "cycle-1",
        kind: "coding",
        attempts: 1,
        branch: "aep/m2-c1",
        prNumber: 3,
        mergeSha: "dcb1edc5fe04",
        createdAt: "2026-07-10T09:05:00Z",
        endedAt: "2026-07-10T09:40:00Z",
      },
      {
        id: "cycle-2",
        kind: "fix",
        attempts: 2,
        createdAt: "2026-07-10T09:45:00Z",
      },
    ],
    createdAt: "2026-07-10T09:00:00Z",
    ...over,
  };
}

function issue(
  number: number,
  title: string,
  executorClass: string,
  derivedStatus = "pending",
): TaskView {
  return {
    issueNumber: number,
    title,
    executorClass,
    derivedStatus,
    issueUrl: `https://github.com/o/r/issues/${number}`,
    executions: {},
  } as TaskView;
}

// One open coding issue: a milestone with work in it, so a waiting run's hold
// is the unbounded park rather than an empty working set.
const withOpenWork = () => [issue(2, "Implement the shortener API", "coding")];

afterEach(() => {
  mockBuilds = [];
  mockRuns = [];
  mockIssues = [];
  cancelState.isPending = false;
  cancelState.isError = false;
  cancelState.error = null;
  cancelMutate.mockClear();
  invalidateQueries.mockClear();
});

function renderPage(tag?: string, onTagChange = vi.fn()) {
  render(
    <BuildsPage projectName="acme" tag={tag} onTagChange={onTagChange} />,
  );
  return onTagChange;
}

describe("BuildsPage — one version's story", () => {
  it("invites the first build when there is none", () => {
    renderPage();
    expect(screen.getByText(/No builds yet/)).toBeInTheDocument();
  });

  it("defaults to the newest version, not to a ledger list", () => {
    mockBuilds = [build("v2", "in_progress"), build("v1", "completed")];
    mockRuns = [run()];
    renderPage();

    // The newest version's run is the page — no intermediate list of versions.
    // The tag now appears twice by design: the run card's milestone title, and
    // the milestone panel beside it.
    expect(screen.getAllByText("v2").length).toBeGreaterThan(0);
    expect(screen.getByRole("combobox", { name: "Version" })).toHaveValue("v2");
  });

  it("falls back to newest for an unknown ?tag rather than erroring", () => {
    mockBuilds = [build("v2", "completed"), build("v1", "completed")];
    mockRuns = [run({ state: "succeeded" })];
    renderPage("v99");
    // The version picker and the milestone both land on the newest tag rather
    // than erroring on one nobody built.
    expect(screen.getByRole("combobox", { name: "Version" })).toHaveValue("v2");
    expect(screen.getAllByText("v2").length).toBeGreaterThan(0);
  });

  it("lands on the run's build sessions, handed the facts webhooks taught it", () => {
    mockBuilds = [build("v2", "in_progress")];
    mockRuns = [run()];
    mockIssues = withOpenWork();
    renderPage();

    // The strip narrates the CURRENT session's five stages…
    for (const stage of ["Coding agent", "Pull request", "Merge", "Builds", "Deployment"]) {
      expect(screen.getAllByText(stage).length).toBeGreaterThan(0);
    }
    // …and the session behind it stays visible, because the re-entry loop is
    // the thing a reader of a multi-session run is trying to understand.
    // …below the card, not inside it — the card is the strip and the NOW.
    expect(screen.getByText("EARLIER CYCLES IN THIS SESSION")).toBeInTheDocument();
    expect(screen.getByText("Cycle 1 · coding")).toBeInTheDocument();
    expect(screen.getByText(/merged .* as dcb1edc5/)).toBeInTheDocument();
  });

  it("shows no budget counters on a healthy run — unspent allowance is not the user's business", () => {
    mockBuilds = [build("v2", "in_progress")];
    mockRuns = [run()]; // 2/8 cycles, 1/2 fix cycles — nothing at its ceiling
    renderPage();
    expect(screen.queryByText("2 / 8")).not.toBeInTheDocument();
    expect(screen.queryByText("1 / 2")).not.toBeInTheDocument();
  });

  it("surfaces a budget counter once it is spent, next to the reason it explains", () => {
    mockBuilds = [build("v2", "failed")];
    mockRuns = [
      run({
        state: "failed",
        terminalReason: "cycle-ceiling",
        budgets: {
          cyclesTotal: 8,
          cycleCeiling: 8,
          fixCycles: 1,
          conflictCycles: 0,
          buildRetriggers: 0,
          validationCycles: 0,
        },
      }),
    ];
    renderPage();
    // Rendered as one line next to the terminal reason: "Budget spent: …".
    expect(screen.getByText(/Budget spent: Build sessions 8 \/ 8/)).toBeInTheDocument();
    // The fix-session allowance is still unspent, so it is not listed.
    expect(screen.queryByText(/Fix sessions/)).not.toBeInTheDocument();
  });

  it("offers cancel, quietly, on a waiting session", () => {
    mockBuilds = [build("v2", "in_progress")];
    mockRuns = [run({ state: "waiting" })];
    mockIssues = withOpenWork();
    renderPage();

    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.getByText(/wait is unbounded/)).toBeInTheDocument();
    // Neutral, not alarm-coloured — cancel is an escape hatch, not the page's
    // primary action.
    fireEvent.click(screen.getByRole("button", { name: /Cancel session/ }));
    expect(cancelMutate).toHaveBeenCalledWith("run-1");
  });

  // The reported bug: a build busy writing its milestone announced itself as
  // parked, with a cancel button, on a project that had no gates at all.
  it("reads a planning run as work in progress, not as a hold", () => {
    mockBuilds = [build("v2", "in_progress")];
    mockRuns = [run({ state: "planning", cycles: [] })];
    mockIssues = [];
    renderPage();

    expect(screen.getByText("Planning")).toBeInTheDocument();
    expect(screen.getByText("Planning v2")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is held/)).toBeInTheDocument();
    expect(screen.queryByText(/wait is unbounded/)).not.toBeInTheDocument();
    // Cancel is a signal to a supervisor that does not exist yet: offering it
    // would 202 and do nothing.
    expect(
      screen.queryByRole("button", { name: /Cancel run/ }),
    ).not.toBeInTheDocument();
    // And no empty session rail under a notice that already explained itself.
    expect(screen.queryByTestId("run-spine")).not.toBeInTheDocument();
  });

  // The gate story is the PROVISIONING STAGE on the run's rail — RunSpine's own
  // test owns how it reads. What the PAGE owes is handing the gates down at all,
  // resolved ones included: they are the version's record.
  it("hands the run's rail every gate in the milestone", () => {
    mockBuilds = [build("v2", "in_progress")];
    mockRuns = [run({ state: "waiting" })];
    mockIssues = [
      issue(1, "Provide configuration: url-shortener-db", "provision"),
      issue(3, "Provision resource: cache", "provision", "merged"),
      ...withOpenWork(),
    ];
    renderPage();

    // Every gate stays on the page, resolved ones included — that is the
    // version's record. The OPEN one leads in the run card, because it is what
    // holds dispatch; the resolved one is history, and lives in the milestone
    // panel's connections beside it.
    expect(screen.getAllByText(/url-shortener-db/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/cache/).length).toBeGreaterThan(0);
    // A gate hold is NOT the unbounded park — the fix for one is nothing like
    // the fix for the other, so the notice must not claim it.
    expect(screen.queryByText(/wait is unbounded/)).not.toBeInTheDocument();
  });

  it("tells an empty milestone apart from a gate hold", () => {
    mockBuilds = [build("v2", "in_progress")];
    mockRuns = [run({ state: "waiting" })];
    mockIssues = [issue(2, "Add the redirect handler", "coding", "merged")];
    renderPage();

    expect(screen.getByText("Waiting for work")).toBeInTheDocument();
    expect(screen.queryByText(/unresolved connection/)).not.toBeInTheDocument();
  });

  it("accuses no run of having no work before the issue list arrives", () => {
    mockBuilds = [build("v2", "in_progress")];
    mockRuns = [run({ state: "waiting" })];
    mockIssues = undefined;
    renderPage();
    expect(screen.queryByText("Waiting for work")).not.toBeInTheDocument();
  });

  // A resolved gate holds nothing, so it must not keep explaining a hold.
  it("drops the hold once every gate is resolved", () => {
    mockBuilds = [build("v2", "in_progress")];
    mockRuns = [run({ state: "waiting" })];
    mockIssues = [
      issue(1, "Provide configuration: db", "provision", "merged"),
      ...withOpenWork(),
    ];
    renderPage();
    expect(screen.queryByText(/unresolved/)).not.toBeInTheDocument();
  });

  it("offers no cancel on a terminal run", () => {
    mockBuilds = [build("v2", "failed")];
    mockRuns = [run({ state: "failed", terminalReason: "no-progress" })];
    renderPage();

    expect(
      screen.queryByRole("button", { name: /Cancel run/ }),
    ).not.toBeInTheDocument();
    // …and says WHY it stopped, in words.
    expect(screen.getByText(/closed no issues/)).toBeInTheDocument();
  });

  it("says nothing was cancelled when the engine is unreachable", () => {
    mockBuilds = [build("v2", "in_progress")];
    mockRuns = [run({ state: "waiting" })];
    mockIssues = withOpenWork();
    cancelState.isError = true;
    cancelState.error = new Error("workflow engine unavailable");
    renderPage();
    expect(screen.getByText(/Nothing was cancelled/)).toBeInTheDocument();
  });

  it("tells every run of the milestone, newest first", () => {
    // A milestone sees SEQUENTIAL runs: the spec build, then an incident.
    mockBuilds = [build("v2", "completed")];
    mockRuns = [
      run({ id: "run-2", origin: "incident-adoption", state: "succeeded" }),
      run({ id: "run-1", state: "succeeded" }),
    ];
    renderPage();
    expect(screen.getByText("Incident")).toBeInTheDocument();
    expect(screen.getByText("Spec build")).toBeInTheDocument();
  });

  it("links issues at the repo's web root, not at its clone url", () => {
    // repoUrl is a CLONE url. Appending straight to it gave
    // `…/demo.git/issues`, which 404s on GitHub.
    mockBuilds = [build("v2", "in_progress")];
    mockRuns = [run()];
    mockIssues = withOpenWork();
    renderPage();

    expect(
      screen.getByRole("link", { name: /View all issues/ }),
    ).toHaveAttribute("href", "https://github.com/acme/demo/issues");
  });

  it("shows the delivered result the moment the flow finishes, before the run settles", () => {
    // The supervisor can hold the run formally "running" after deployment goes
    // green. The reader's story is over either way — gating the banner on
    // run.state left a finished flow showing a bare "every stage is done" line.
    mockBuilds = [build("v2", "in_progress")];
    mockRuns = [
      run({
        state: "running",
        cycles: [
          {
            id: "cycle-1",
            kind: "coding",
            attempts: 1,
            branch: "aep/m2-c1",
            prNumber: 5,
            mergeSha: "1dc26ba1fe04",
            createdAt: "2026-08-04T06:02:00Z",
            endedAt: "2026-08-04T06:20:00Z",
          },
        ],
      }),
    ];
    mockIssues = [issue(3, "Implement gym-tracker-api", "coding", "merged")];
    mockCycleBuilds = [
      { component: "gym-tracker-api", status: "Succeeded", completed: true },
    ];
    renderPage();

    expect(screen.getByText("All agent work for v2 is done")).toBeInTheDocument();
    expect(screen.getByText("View deployment status")).toBeInTheDocument();
    mockCycleBuilds = [];
  });

  it("shows a quiet busy block, not a hold notice, before the first cycle", () => {
    // Pre-dispatch is progress, not a hold: no leading-edge rule, and the
    // spinner carries the "working" signal. A hold above replaces it entirely.
    mockBuilds = [build("v2", "in_progress")];
    mockRuns = [run({ state: "running", cycles: [] })];
    mockIssues = withOpenWork();
    renderPage();

    expect(
      screen.getByText("Waiting to dispatch the first cycle"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Waiting to dispatch the first cycle"),
    ).toBeInTheDocument();
  });

  it("says validation is what keeps a delivered session open", () => {
    // After the merge the platform dispatches a VALIDATION cycle the Builds
    // rail deliberately does not narrate — but an open one is the answer to
    // "why is this session still running when everything is green".
    mockBuilds = [build("v2", "in_progress")];
    mockRuns = [
      run({
        state: "running",
        cycles: [
          {
            id: "cycle-1",
            kind: "coding",
            attempts: 1,
            branch: "aep/m2-c1",
            prNumber: 5,
            mergeSha: "1dc26ba1fe04",
            createdAt: "2026-08-04T06:02:00Z",
            endedAt: "2026-08-04T06:21:00Z",
          },
          {
            id: "cycle-2",
            kind: "validation",
            attempts: 1,
            createdAt: "2026-08-04T06:29:00Z",
          },
        ],
      }),
    ];
    mockIssues = [issue(3, "Implement gym-tracker-api", "coding", "merged")];
    mockCycleBuilds = [
      { component: "gym-tracker-api", status: "Succeeded", completed: true },
    ];
    renderPage();

    expect(screen.getByText("All agent work for v2 is done")).toBeInTheDocument();
    expect(
      screen.getByText(/Validation is running against the deployed system/),
    ).toBeInTheDocument();
    mockCycleBuilds = [];
  });

  it("reads a merged issue as CLOSED in the milestone panel", () => {
    // The regression: with the retired ten-value bucketing, a merged issue fell
    // into "in progress" AT the very merge that closed it, and the closed count
    // sat at 0/N forever.
    mockBuilds = [build("v2", "in_progress")];
    mockRuns = [run()];
    mockIssues = [
      issue(3, "Implement gym-tracker-api", "coding", "merged"),
      issue(4, "Implement gym-tracker-webapp", "coding", "merged"),
    ];
    renderPage();

    expect(screen.getByText("2 closed")).toBeInTheDocument();
    expect(screen.getByText("2 / 2 closed")).toBeInTheDocument();
    expect(screen.queryByText(/in progress/)).not.toBeInTheDocument();
  });

  it("marks an issue in progress only while an open cycle claims it", () => {
    mockBuilds = [build("v2", "in_progress")];
    mockRuns = [
      run({
        cycles: [
          {
            id: "cycle-1",
            kind: "coding",
            attempts: 1,
            resolves: [3],
            createdAt: "2026-08-04T06:02:00Z",
          },
        ],
      }),
    ];
    mockIssues = [
      issue(3, "Implement gym-tracker-api", "coding"),
      issue(4, "Implement gym-tracker-webapp", "coding"),
    ];
    renderPage();

    // #3 is claimed by the open cycle; #4 is not — it stays open rather than
    // being guessed into motion.
    expect(screen.getByText("1 in progress")).toBeInTheDocument();
    expect(screen.getByText("Claimed by cycle 1 · coding")).toBeInTheDocument();
    expect(screen.getByText("1 open")).toBeInTheDocument();
  });

  it("keeps an earlier session collapsed until asked, then shows its cycles", () => {
    mockBuilds = [build("v2", "in_progress")];
    mockRuns = [
      run({ id: "run-2", origin: "incident-adoption" }),
      run({ id: "run-1", state: "cancelled", endedAt: "2026-07-10T09:42:00Z" }),
    ];
    mockIssues = withOpenWork();
    renderPage();

    const toggle = screen.getByRole("button", {
      name: "Show this build session's detail",
    });
    // Both runs carry the same cycle fixture, so count rather than match: the
    // current session's own cycle list is the one occurrence on screen while
    // the earlier session stays collapsed.
    const merged = () => screen.getAllByText(/merged pull request #3/).length;
    expect(merged()).toBe(1);

    fireEvent.click(toggle);

    // Expanded, the earlier session accounts for itself cycle by cycle.
    expect(merged()).toBe(2);
    expect(
      screen.getByRole("button", { name: "Hide this build session's detail" }),
    ).toBeInTheDocument();
  });

  it("declares a run delivered only once its flow actually finished", () => {
    // A run can be marked succeeded while a stage is still unreadable — here
    // the merge landed but no build has appeared in the cluster yet, so the
    // strip says "Builds · now". Claiming "all agent work is done" over that
    // would be the page contradicting itself in two places at once.
    mockBuilds = [build("v2", "completed")];
    mockRuns = [run({ state: "succeeded" })];
    mockIssues = withOpenWork();
    mockCycleBuilds = [];
    renderPage();

    expect(screen.queryByText(/All agent work for .* is done/)).not.toBeInTheDocument();
    expect(screen.getByText("NOW")).toBeInTheDocument();
  });

  it("shows the delivered result once every stage is done", () => {
    mockBuilds = [build("v2", "completed")];
    mockRuns = [
      run({
        state: "succeeded",
        endedAt: "2026-07-10T10:03:00Z",
        cycles: [
          {
            id: "cycle-1",
            kind: "coding",
            attempts: 1,
            branch: "aep/m2-c1",
            prNumber: 3,
            mergeSha: "dcb1edc5fe04",
            createdAt: "2026-07-10T09:05:00Z",
            endedAt: "2026-07-10T09:40:00Z",
          },
        ],
      }),
    ];
    mockIssues = withOpenWork();
    // `completed` is what makes an outcome readable at all — a green status on
    // an unfinished build is not a success yet.
    mockCycleBuilds = [
      { component: "storefront", status: "Succeeded", completed: true },
    ];
    renderPage();

    expect(screen.getByText("All agent work for v2 is done")).toBeInTheDocument();
    // The way out: the board that actually knows what is running.
    expect(screen.getByText("View deployment status")).toBeInTheDocument();
    // Nothing is happening, so there is no "now" to narrate.
    expect(screen.queryByText("NOW")).not.toBeInTheDocument();
    mockCycleBuilds = [];
  });

  it("explains a version tagged before the platform kept session rows", () => {
    mockBuilds = [build("v2", "completed")];
    mockRuns = [];
    renderPage();
    expect(screen.getByText(/no build-session rows/)).toBeInTheDocument();
  });

  it("re-reads the issue list exactly once when the run settles", () => {
    mockBuilds = [build("v2", "in_progress")];
    mockRuns = [run({ state: "running" })];
    const { rerender } = render(
      <BuildsPage projectName="acme" tag={undefined} onTagChange={vi.fn()} />,
    );
    expect(invalidateQueries).not.toHaveBeenCalled();

    // The run turns terminal: the GitHub-backed list has stopped polling, but
    // the writes that settle a version can land in the same instant.
    mockRuns = [run({ state: "succeeded" })];
    rerender(
      <BuildsPage projectName="acme" tag={undefined} onTagChange={vi.fn()} />,
    );
    expect(invalidateQueries).toHaveBeenCalledTimes(1);

    // A further render on the same settled state must not re-read.
    rerender(
      <BuildsPage projectName="acme" tag={undefined} onTagChange={vi.fn()} />,
    );
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
  });
});
