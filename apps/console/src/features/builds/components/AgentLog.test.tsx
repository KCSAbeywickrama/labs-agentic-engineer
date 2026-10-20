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

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OxygenTheme, OxygenUIThemeProvider } from "@wso2/oxygen-ui";
import { RunFeed } from "@aep/progress-view";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { components } from "../../../generated/aep-api";
import type { RunProgressState, StampedRunEvent } from "../hooks/useRunProgress";
import { resetRunViewForTest } from "../hooks/useRunView";
import { AgentLog } from "./AgentLog";

// A build session's log says why it is empty when the platform knows: no
// longer kept, or not loadable right now (with Try again); otherwise it is the
// session's crew.

type RunCycleView = components["schemas"]["RunCycleView"];
type MilestoneRunView = components["schemas"]["MilestoneRunView"];
type RunEvent = components["schemas"]["RunEvent"];
type Recording = NonNullable<RunCycleView["recording"]>;

/** The progress the hook would hand over, folded by the real store from these frames. */
function progressOf(
  cycles: RunCycleView[],
  events: StampedRunEvent[],
  over: Partial<Pick<RunProgressState, "phase" | "reconnect" | "settledState">> = {},
): RunProgressState {
  const feed = new RunFeed<RunCycleView, RunEvent>();
  for (const c of cycles) feed.apply({ type: "cycle", cycle: c });
  for (const { cycleId, attempt, ...event } of events) feed.apply({ type: "event", cycleId, attempt, event });
  return { ...feed.snapshot(), phase: "live", reconnect: vi.fn(), ...over };
}

// jsdom has no ResizeObserver, which the steps pane uses to follow its tail.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);

afterEach(() => {
  cleanup();
  resetRunViewForTest();
});

const cycle = (recording: Recording): RunCycleView => ({
  id: "c1",
  kind: "coding",
  attempts: 1,
  createdAt: "2026-10-01T09:00:00Z",
  endedAt: "2026-10-01T09:20:00Z",
  recording,
});

// What the server sends for a log it cannot serve (expired or unavailable):
// the cycle frame AND one platform notice (seq -20, `code: gap`), never an
// empty feed (aep-api codingagent cycle_feed.go, logsUnavailableRunEvent).
const logsUnavailable: StampedRunEvent = {
  cycleId: "c1",
  attempt: 1,
  ts: "2026-10-01T09:20:00Z",
  seq: -20,
  v: 2,
  kind: "notice",
  agentId: "lead",
  level: "warn",
  code: "gap",
  detail: "This cycle's log is not available.",
};

function renderLog(recording: Recording, reconnect = vi.fn(), events: StampedRunEvent[] = []) {
  const progress = progressOf([cycle(recording)], events, { settledState: "succeeded", phase: "ended", reconnect });
  const run = { id: "r1", state: "completed", createdAt: "2026-10-01T09:00:00Z", cycles: [cycle(recording)] } as unknown as MilestoneRunView;
  render(
    <OxygenUIThemeProvider theme={OxygenTheme}>
      <AgentLog projectName="shop" runs={[run]} progress={progress} />
    </OxygenUIThemeProvider>,
  );
  return reconnect;
}

describe("a build session's log", () => {
  it("says it is no longer kept, instead of reading as an agent that wrote nothing", () => {
    renderLog("expired", vi.fn(), [logsUnavailable]);
    expect(screen.getByRole("alert")).toHaveTextContent("This run's log is no longer kept (logs are kept for a few days)");
    expect(screen.queryByText(/events are missing from this feed/)).not.toBeInTheDocument();
    expect(screen.queryByText("No output yet.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("says it cannot be loaded right now, and Try again attaches afresh", () => {
    const reconnect = renderLog("unavailable", vi.fn(), [logsUnavailable]);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load this run's log right now");
    expect(screen.queryByText(/events are missing from this feed/)).not.toBeInTheDocument();
    expect(screen.queryByText("No output yet.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reconnect).toHaveBeenCalledOnce();
  });

  it.each(["kept", "live"] as const)("shows a %s log's own state, not an error", (recording) => {
    renderLog(recording);
    expect(screen.getByText("No output yet.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the rows, with the inline gap notice, for a kept log with a hole", () => {
    renderLog("kept", vi.fn(), [logsUnavailable]);
    expect(screen.getByText(/events are missing from this feed/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("a build session's header", () => {
  function renderOpen(over: Partial<RunCycleView>) {
    const open = { ...cycle("live"), endedAt: undefined, ...over } as RunCycleView;
    const progress = progressOf([open], []);
    const run = { id: "r1", state: "running", createdAt: "2026-10-01T09:00:00Z", cycles: [open] } as unknown as MilestoneRunView;
    render(
      <OxygenUIThemeProvider theme={OxygenTheme}>
        <AgentLog projectName="shop" runs={[run]} progress={progress} />
      </OxygenUIThemeProvider>,
    );
  }

  it("says writing now while the agent runs", () => {
    renderOpen({});
    expect(screen.getByText(/writing now/)).toBeInTheDocument();
  });

  it("says waiting to start while the cluster holds the agent", () => {
    renderOpen({ startupWait: { reason: "Unschedulable", since: "2026-10-01T09:00:30Z", failsAt: "2026-10-01T09:10:00Z" } });
    expect(screen.getByText(/waiting to start/)).toBeInTheDocument();
    expect(screen.queryByText(/writing now/)).not.toBeInTheDocument();
  });
});

describe("a build session's crew", () => {
  const open: RunCycleView = { ...cycle("live"), endedAt: null };
  const run = { id: "r1", state: "running", createdAt: "2026-10-01T09:00:00Z", cycles: [open] } as unknown as MilestoneRunView;
  // Seconds ago, so the crew's liveness rules read these as a session going now.
  const ev = (seq: number, body: Partial<RunEvent>): StampedRunEvent =>
    ({ v: 2, seq, ts: new Date(Date.now() - (10 - seq) * 1000).toISOString(), agentId: "lead", cycleId: "c1", attempt: 1, ...body }) as StampedRunEvent;

  function renderCrew(progress: RunProgressState) {
    render(
      <OxygenUIThemeProvider theme={OxygenTheme}>
        <AgentLog projectName="shop" runs={[run]} progress={progress} />
      </OxygenUIThemeProvider>,
    );
  }

  it("draws each agent once, and the selected agent's steps with their outcomes", () => {
    renderCrew(
      progressOf(
        [open],
        [
          ev(1, { kind: "tool_use", tool: "Bash", summary: "pnpm test", toolUseId: "t1" }),
          ev(2, { kind: "tool_result", tool: "Bash", toolUseId: "t1", ok: false, exitCode: 1 }),
          ev(3, { kind: "agent_started", agentId: "a1", parentAgentId: "lead", depth: 1, label: "Web app", background: true }),
          ev(4, { kind: "tool_use", agentId: "a1", tool: "Write", summary: "web/src/App.tsx", toolUseId: "t2" }),
        ],
      ),
    );
    expect(screen.getByRole("button", { name: /^lead agent: working/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Web app: working/ })).toBeInTheDocument();
    // The lead is selected: its call is one row, with its outcome on it.
    const steps = screen.getByRole("list", { name: "Steps" });
    expect(steps).toHaveTextContent("$ pnpm test");
    expect(steps).toHaveTextContent("exit 1");
    expect(steps).not.toHaveTextContent("web/src/App.tsx");
    expect(screen.getByRole("region", { name: "Subagents" })).toHaveTextContent("Subagents · 1");

    fireEvent.click(screen.getByRole("button", { name: /^Web app: working/ }));
    expect(screen.getByRole("list", { name: "Steps" })).toHaveTextContent("$ Write web/src/App.tsx");
  });

  it("switches to the timeline from the second agent, and a lane goes back to the crew with that agent", () => {
    renderCrew(
      progressOf(
        [open],
        [
          ev(1, { kind: "tool_use", tool: "Read", summary: "specs/prd.md" }),
          ev(2, { kind: "agent_started", agentId: "a1", parentAgentId: "lead", depth: 1, label: "Web app", background: true }),
          ev(3, { kind: "tool_use", agentId: "a1", tool: "Write", summary: "web/src/App.tsx" }),
        ],
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    expect(screen.queryByRole("list", { name: "Agents" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Web app: working/ }));
    expect(screen.getByRole("list", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Steps" })).toHaveTextContent("$ Write web/src/App.tsx");
  });

  it("shows the runner starting up on the lead, and no startup notice as a row", () => {
    const booting = { ...open, boot: { attempt: 1, code: "runner_pulling_image" as const, since: "2026-10-01T09:00:00Z" } };
    renderCrew(progressOf([booting], []));
    expect(screen.getByText(/· starting/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^lead agent: working\. Pulling the agent image…/ })).toBeInTheDocument();
  });
});
