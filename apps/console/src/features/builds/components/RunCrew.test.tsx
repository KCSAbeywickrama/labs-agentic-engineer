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

// The crew view: the surface half of the rule this feature exists for — a reader
// must never wonder whether the run is stuck.
//
// What the MODEL decides (states, ages, lane spans, the amber threshold) is
// tested in `@aep/progress-view` against two real recordings. What is tested
// here is only what this surface adds: which of the two views is on screen, that
// the other one is NOT, what a row shows, and where a click goes.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunCrew } from "./RunCrew";
import { resetRunViewForTest } from "../hooks/useRunView";
import type { StampedRunEvent } from "../hooks/useRunProgress";

const T0 = Date.parse("2026-09-04T09:00:00Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

let seq = 0;
const ev = (
  seconds: number,
  rest: Partial<StampedRunEvent> & { kind: string; agentId: string },
): StampedRunEvent =>
  ({ v: 2, cycleId: "c1", attempt: 1, seq: ++seq, ts: at(seconds), ...rest }) as StampedRunEvent;

/**
 * A fan-out with every shape the tree has to draw: a lead, a foreground child
 * that settles, a BACKGROUND child that fails, and a depth-2 grandchild.
 */
function fanOut(): StampedRunEvent[] {
  seq = 0;
  return [
    ev(0, { kind: "run_started", agentId: "lead", taskKind: "implementation" }),
    ev(1, { kind: "tool_use", agentId: "lead", tool: "Bash", summary: "git status", toolUseId: "m1" }),
    ev(2, { kind: "tool_result", agentId: "lead", tool: "Bash", ok: true, durationMs: 240, toolUseId: "m1" }),
    ev(3, { kind: "agent_started", agentId: "a1", label: "Implement todo-api", role: "coder", depth: 1, background: false }),
    ev(4, { kind: "agent_started", agentId: "a2", label: "Implement todo-webapp", role: "coder", depth: 1, background: true }),
    ev(5, { kind: "tool_use", agentId: "a1", tool: "Bash", summary: "bal build", toolUseId: "t1" }),
    ev(6, { kind: "agent_started", agentId: "a3", label: "Write the OpenAPI contract", parentAgentId: "a1", depth: 2 }),
    ev(7, { kind: "tool_use", agentId: "a3", tool: "Write", summary: "contracts/api.yaml", toolUseId: "c1" }),
    ev(8, { kind: "tool_result", agentId: "a3", tool: "Write", ok: true, durationMs: 70, toolUseId: "c1" }),
    ev(9, { kind: "agent_settled", agentId: "a3", status: "completed", durationMs: 41_200, toolCount: 6, report: "Wrote the contract." }),
    ev(30, { kind: "tool_result", agentId: "a1", tool: "Bash", ok: false, exitCode: 1, summary: "error: compilation contains errors", durationMs: 25_100, toolUseId: "t1" }),
    ev(31, { kind: "agent_settled", agentId: "a1", status: "completed", durationMs: 209_158, toolCount: 19, linesAdded: 553, linesRemoved: 4, report: "Implemented the service and its smoke test." }),
    ev(40, { kind: "agent_settled", agentId: "a2", status: "failed", durationMs: 353_000, toolCount: 31, report: "Could not get vite build to pass." }),
    ev(41, { kind: "run_settled", agentId: "lead", outcome: "success" }),
  ];
}

/** The tree row for an agent, found by the accessible name the row carries. */
function row(label: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${label}:`) });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // The crew's clock is `Date.now()`, so every rendered age and state is decided
  // here rather than by how long the test took to run.
  vi.setSystemTime(T0 + 60_000);
  localStorage.clear();
  // The choice is ONE value for the page, so a test that switched the view
  // would otherwise hand its choice to the next test.
  resetRunViewForTest();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("RunCrew", () => {
  // Crew is the default because liveness is the primary job: a timeline is a
  // retrospective, and a retrospective is the wrong thing to open on a run that
  // is still going.
  it("opens on the crew, and never draws both views at once", () => {
    render(<RunCrew events={fanOut()} />);
    expect(screen.getByRole("button", { name: "Crew" })).toHaveAttribute("aria-pressed", "true");
    // The inspector — crew only. Its presence is the proof the timeline is not
    // also on screen, since the two never share the height.
    expect(screen.getByText("$ git status")).toBeInTheDocument();
    expect(screen.queryByText(/solid · working/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    expect(screen.getByText(/solid · working/)).toBeInTheDocument();
    expect(screen.queryByText("$ git status")).toBeNull();
  });

  it("remembers the reader's choice per browser", () => {
    const { unmount } = render(<RunCrew events={fanOut()} />);
    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    expect(localStorage.getItem("aep:builds:run-view")).toBe("timeline");
    unmount();

    // A reader who came to ask where the time went is usually about to ask it of
    // the next cycle too. A fresh page reads the choice back off storage.
    resetRunViewForTest();
    render(<RunCrew events={fanOut()} />);
    expect(screen.getByRole("button", { name: "Timeline" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/solid · working/)).toBeInTheDocument();
  });

  // A run holds several cycles and each draws its own toggle. Held as component
  // state, switching one left the others in the view they mounted with — so one
  // page showed a crew and a timeline at once, which is the exact thing this
  // toggle exists to prevent.
  it("switches every cycle on the page at once", () => {
    render(
      <>
        <RunCrew events={fanOut()} />
        <RunCrew events={fanOut()} />
      </>,
    );
    expect(screen.getAllByRole("button", { name: "Crew" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Timeline" })[0]!);
    for (const toggle of screen.getAllByRole("button", { name: "Timeline" })) {
      expect(toggle).toHaveAttribute("aria-pressed", "true");
    }
  });

  // A private window, a browser set to block site data and a thumbnail capture
  // all THROW here rather than returning null. A remembered preference is never
  // worth a blank page.
  it("still renders when the browser refuses site data", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.");
    });
    try {
      render(<RunCrew events={fanOut()} />);
      expect(screen.getByRole("button", { name: "Crew" })).toHaveAttribute("aria-pressed", "true");
      // …and switching still works, it just is not remembered.
      fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
      expect(screen.getByText(/solid · working/)).toBeInTheDocument();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it("gives every agent a row, indented by the depth the runtime declared", () => {
    render(<RunCrew events={fanOut()} />);
    // Four agents plus the lead, each once — not one row per contiguous stretch,
    // which is what a flat log gave when three agents interleaved.
    for (const label of [
      "lead agent",
      "Implement todo-api",
      "Implement todo-webapp",
      "Write the OpenAPI contract",
    ]) {
      expect(row(label)).toBeInTheDocument();
    }
    // The depth-2 agent is indented past its parent. v1 could not describe this
    // shape at all — it filed a grandchild's work under the lead.
    const indent = (label: string) =>
      parseFloat(getComputedStyle(row(label)).paddingLeft);
    expect(indent("Write the OpenAPI contract")).toBeGreaterThan(indent("Implement todo-api"));
    expect(indent("Implement todo-api")).toBeGreaterThan(indent("lead agent"));
  });

  it("says when an agent was spawned in the background", () => {
    render(<RunCrew events={fanOut()} />);
    // Printed only when the runtime said TRUE: the platform forces fan-out into
    // the foreground, so a true is the forcing having failed — which is exactly
    // what explains an agent that forwarded nothing.
    expect(within(row("Implement todo-webapp")).getByText("background")).toBeInTheDocument();
    expect(within(row("Implement todo-api")).queryByText("background")).toBeNull();
  });

  it("a settled row carries the agent's own report, and the inspector its totals", () => {
    render(<RunCrew events={fanOut()} />);
    // The sub-line of a settled row IS its report — the only copy there will
    // ever be, since a spawned agent's transcript dies with its pod.
    expect(
      within(row("Implement todo-api")).getByText(/Implemented the service and its smoke test/),
    ).toBeInTheDocument();
    // An agent the runtime called failed reads as failed, not as merely quiet.
    expect(within(row("Implement todo-webapp")).getByText("failed")).toBeInTheDocument();

    fireEvent.click(row("Implement todo-api"));
    // Every figure is the runtime's OWN: it measured the agent's whole life,
    // including the parts that never reached this feed.
    expect(
      screen.getByText("completed · 3m29s · 19 tools · +553/−4 lines"),
    ).toBeInTheDocument();
  });

  it("shows the selected agent's steps, and nobody else's", () => {
    render(<RunCrew events={fanOut()} />);
    // The lead is the default selection, so its own row is what shows.
    expect(screen.getByText("$ git status")).toBeInTheDocument();
    expect(screen.queryByText("$ bal build")).toBeNull();

    fireEvent.click(row("Implement todo-api"));
    expect(screen.getByText("$ bal build")).toBeInTheDocument();
    // The grandchild's work stays on the grandchild — the whole point of the
    // declared tree.
    expect(screen.queryByText(/contracts\/api.yaml/)).toBeNull();
    expect(screen.queryByText("$ git status")).toBeNull();

    // The outcome trails on its own action row rather than repeating the command
    // a second time further down.
    expect(
      screen.getByText("exit 1 · error: compilation contains errors · 25.1s"),
    ).toBeInTheDocument();
  });

  it("tells a reader when an agent forwarded nothing at all", () => {
    render(<RunCrew events={fanOut()} />);
    fireEvent.click(row("Implement todo-webapp"));
    // A backgrounded agent forwards none of its own messages, so an empty
    // inspector is a real state — and a blank panel would read as a bug.
    expect(screen.getByText("This agent forwarded no steps.")).toBeInTheDocument();
  });

  // Where "where did the time go" always ends: "so what was it doing".
  it("returns to the crew with that agent selected when a lane is picked", () => {
    render(<RunCrew events={fanOut()} />);
    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    fireEvent.click(screen.getByRole("button", { name: /^Implement todo-api: completed/ }));

    expect(screen.getByRole("button", { name: "Crew" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("$ bal build")).toBeInTheDocument();
  });

  it("draws no blank rows for the kinds that are state rather than output", () => {
    seq = 0;
    const events = [
      ev(0, { kind: "agent_started", agentId: "a1", label: "todo-api", depth: 1 }),
      ev(1, { kind: "agent_progress", agentId: "a1", phrase: "Writing todo-api/service.bal" }),
      ev(2, { kind: "work_item", agentId: "a1", source: "criterion", itemId: "AC-001-a", itemStatus: "pass" }),
      ev(3, { kind: "heartbeat", agentId: "a1", waitingOn: "tool", ref: "t1", elapsedMs: 130_000 }),
    ];
    const { container } = render(<RunCrew events={events} />);

    // The heartbeat displaces the stale phrase on the agent's row — it fires
    // only when nothing else is happening, so it is the fresher truth.
    expect(
      within(row("todo-api")).getByText(/waiting on a tool call for 2m10s/),
    ).toBeInTheDocument();
    // …and none of the three became a row of its own.
    expect(container.textContent).not.toContain("Writing todo-api/service.bal");
    expect(container.textContent).not.toContain("AC-001-a");
  });

  it("puts a backgrounded shell command under the agent that started it", () => {
    seq = 0;
    const events = [
      ev(0, { kind: "agent_started", agentId: "a1", label: "todo-webapp", depth: 1 }),
      ev(1, { kind: "task_started", agentId: "a1", taskId: "bg1", summary: "pnpm dev:mock" }),
    ];
    render(<RunCrew events={events} />);
    // An orphaned `dev:mock` still holding a port after the run ends has
    // somebody's name on it.
    expect(screen.getByText("pnpm dev:mock")).toBeInTheDocument();
    expect(screen.getAllByText("running").length).toBeGreaterThan(0);
  });

  it("the hint says how many agents, how many are running, and how quiet it is", () => {
    seq = 0;
    const events = [ev(0, { kind: "agent_started", agentId: "a1", label: "todo-api", depth: 1 })];
    render(<RunCrew events={events} />);
    // The one fact both views share, which is why it sits with the toggle.
    expect(screen.getByText("2 agents · 2 running · last event 1m0s ago")).toBeInTheDocument();
  });

  it("says nothing is running once the cycle has settled", () => {
    render(<RunCrew events={fanOut()} />);
    // A settled cycle's age would count how long ago the build was, which the
    // page header already says — and it would tick about a run nobody awaits.
    expect(screen.getByText("4 agents · all settled")).toBeInTheDocument();
    expect(screen.queryByText(/last event/)).toBeNull();
  });

  // --- liveness ---------------------------------------------------------------

  it("turns a row amber after a minute of silence with a call unanswered", () => {
    seq = 0;
    const events = [
      ev(0, { kind: "agent_started", agentId: "a1", label: "todo-api", depth: 1 }),
      ev(1, { kind: "tool_use", agentId: "a1", tool: "Bash", summary: "bal build", toolUseId: "t1" }),
    ];
    vi.setSystemTime(T0 + 1_000 + 59_000);
    const { rerender } = render(<RunCrew events={events} />);
    expect(within(row("todo-api")).getByText("working")).toBeInTheDocument();

    vi.setSystemTime(T0 + 1_000 + 60_000);
    rerender(<RunCrew events={events} />);
    const amber = within(row("todo-api"));
    expect(amber.getByText("stalled")).toBeInTheDocument();
    // An amber row always says what it is amber ABOUT. The unanswered call is
    // usually the only witness, and it is a true one.
    expect(amber.getByText(/waiting on Bash for 1m0s/)).toBeInTheDocument();
  });

  it("never calls silence a failure", () => {
    seq = 0;
    // Ten minutes of nothing, with no call outstanding. The age is the honest
    // report; a verdict here would put a red row on a run that is thinking.
    const events = [ev(0, { kind: "agent_progress", agentId: "lead", phrase: "Reading the design" })];
    vi.setSystemTime(T0 + 600_000);
    render(<RunCrew events={events} />);
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("Reading the design")).toBeInTheDocument();
    // The age is the honest report, and it is stated rather than judged.
    expect(screen.getByText("1 agent · 1 running · last event 10m0s ago")).toBeInTheDocument();
  });

  // The whole reason this surface owns a clock. A stream that has gone quiet
  // gives React no reason to re-render, and an age frozen at whatever it read on
  // first paint is the precise lie the crew exists to stop telling.
  it("ticks every agent's age while no events arrive at all", () => {
    seq = 0;
    const events = [
      ev(0, { kind: "agent_started", agentId: "a1", label: "todo-api", depth: 1 }),
      ev(1, { kind: "tool_use", agentId: "a1", tool: "Bash", summary: "bal build", toolUseId: "t1" }),
    ];
    vi.setSystemTime(T0 + 6_000);
    render(<RunCrew events={events} />);
    expect(screen.getByText("2 agents · 2 running · last event 5.0s ago")).toBeInTheDocument();
    expect(within(row("todo-api")).getByText("5.0s ago")).toBeInTheDocument();

    // Not one new event. Only the clock moved.
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(screen.getByText("2 agents · 2 running · last event 9.0s ago")).toBeInTheDocument();
    expect(within(row("todo-api")).getByText("9.0s ago")).toBeInTheDocument();
  });

  it("runs no clock for a cycle where nothing is running", () => {
    render(<RunCrew events={fanOut()} />);
    const settled = screen.getByText("4 agents · all settled");
    // A settled cycle's rows do not move, so a timer on one would be a
    // re-render a second for no reader — and there is no age on them to move.
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(settled).toBeInTheDocument();
    expect(screen.queryByText(/ago$/)).toBeNull();
  });

  // A validation cycle runs a single validator, and a small coding cycle never
  // fans out. A tree with one row and a timeline with one lane would be chrome
  // around a fact already on screen.
  it("draws no crew for a cycle with only one agent", () => {
    seq = 0;
    const events = [
      ev(0, { kind: "run_started", agentId: "lead", taskKind: "validation" }),
      ev(1, { kind: "tool_use", agentId: "lead", tool: "Bash", summary: "pnpm playwright test", toolUseId: "v1" }),
      ev(2, { kind: "tool_result", agentId: "lead", tool: "Bash", ok: true, durationMs: 61_400, toolUseId: "v1" }),
      ev(3, { kind: "agent_settled", agentId: "lead", status: "completed", durationMs: 184_000, toolCount: 22, report: "Checked 5 automated criteria." }),
      ev(4, { kind: "run_settled", agentId: "lead", outcome: "success" }),
    ];
    render(<RunCrew events={events} />);
    expect(screen.queryByRole("button", { name: "Timeline" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Crew" })).toBeNull();
    // Exactly what the flat form showed: the steps, the totals and the report.
    expect(screen.getByText("$ pnpm playwright test")).toBeInTheDocument();
    expect(screen.getByText("completed · 3m4s · 22 tools")).toBeInTheDocument();
    expect(screen.getByText("Checked 5 automated criteria.")).toBeInTheDocument();
    // …plus the one thing it could never show.
    expect(screen.getByText("1 agent · all settled")).toBeInTheDocument();
  });

  it("says so plainly when a cycle has produced nothing", () => {
    render(<RunCrew events={[]} />);
    expect(screen.getByText("No output from this cycle yet.")).toBeInTheDocument();
  });
});
