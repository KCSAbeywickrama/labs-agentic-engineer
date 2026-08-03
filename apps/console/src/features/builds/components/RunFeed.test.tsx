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
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunProgressCycle, RunProgressPhase } from "../hooks/useRunProgress";

let mockCycles: RunProgressCycle[] = [];
let mockPhase: RunProgressPhase = "live";
let mockSettled: string | undefined;

vi.mock("../hooks/useRunProgress", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useRunProgress")>();
  return {
    ...actual,
    useRunProgress: () => ({
      cycles: mockCycles,
      phase: mockPhase,
      settledState: mockSettled,
    }),
  };
});

import { RunFeed } from "./RunFeed";

function section(id: string, kind: string, emitters: string[]): RunProgressCycle {
  return {
    cycle: { id, kind: kind as never, attempts: 1, createdAt: "2026-07-10T09:00:00Z" },
    lines: emitters.map((emitter, i) => ({
      cycleId: id,
      cycleKind: kind,
      cycleIndex: 1,
      kind: "log",
      emitter: emitter as "main" | "subagent",
      seq: i + 1,
      summary: `${emitter} line ${i + 1}`,
    })),
  };
}

afterEach(() => {
  mockCycles = [];
  mockPhase = "live";
  mockSettled = undefined;
});

describe("RunFeed", () => {
  it("renders one section per cycle, labelled by kind", () => {
    mockCycles = [section("c1", "coding", ["main"]), section("c2", "fix", ["main"])];
    render(<RunFeed projectName="acme" runId="run-1" />);
    expect(screen.getByText("Cycle 1")).toBeInTheDocument();
    expect(screen.getByText("Cycle 2")).toBeInTheDocument();
    expect(screen.getByText("coding")).toBeInTheDocument();
    expect(screen.getByText("fix")).toBeInTheDocument();
  });

  it("stamps a subagent line and leaves the main agent's unstamped", () => {
    mockCycles = [section("c1", "coding", ["main", "subagent"])];
    render(<RunFeed projectName="acme" runId="run-1" />);
    // Exactly one chip: absence of a stamp is the positive fact "main agent".
    expect(screen.getAllByText("subagent")).toHaveLength(1);
  });

  it("gives each subagent its own section, and keeps the main agent's lines loose", () => {
    // A cycle fans out to several subagents at once and their lines arrive
    // INTERLEAVED — read flat, three components' work reads as one agent
    // contradicting itself.
    mockCycles = [
      {
        cycle: { id: "c1", kind: "coding" as never, attempts: 1, createdAt: "2026-07-10T09:00:00Z" },
        lines: [
          { cycleId: "c1", cycleKind: "coding", cycleIndex: 1, kind: "log", emitter: "main", seq: 1, summary: "planning" },
          { cycleId: "c1", cycleKind: "coding", cycleIndex: 1, kind: "log", emitter: "subagent", emitterId: "a1", emitterLabel: "Implement todo-api", seq: 2, summary: "bal build" },
          { cycleId: "c1", cycleKind: "coding", cycleIndex: 1, kind: "log", emitter: "subagent", emitterId: "a2", emitterLabel: "Implement todo-webapp", seq: 3, summary: "npm install" },
          { cycleId: "c1", cycleKind: "coding", cycleIndex: 1, kind: "log", emitter: "subagent", emitterId: "a1", emitterLabel: "Implement todo-api", seq: 4, summary: "bal test" },
        ],
      },
    ];
    render(<RunFeed projectName="acme" runId="run-1" />);

    // One section per subagent, named — not one per contiguous stretch, so the
    // two todo-api lines land together despite todo-webapp interleaving.
    expect(screen.getByText("Implement todo-api")).toBeInTheDocument();
    expect(screen.getByText("Implement todo-webapp")).toBeInTheDocument();
    // Collapsed, the header is ALL a reader gets about a subagent, so it carries
    // the verdict rather than a line count. Neither has settled here.
    expect(screen.getAllByText("running")).toHaveLength(2);

    // Sections are open by default: a progress feed that hides its work behind
    // a click reads as a run doing nothing.
    expect(screen.getByText(/bal build/)).toBeInTheDocument();
    expect(screen.getByText(/bal test/)).toBeInTheDocument();

    // The main agent's line is NOT swept into a section.
    expect(screen.getByText(/planning/)).toBeInTheDocument();
  });

  it("a settled subagent reports the SDK's own figures, and a dead one reads as failed", () => {
    mockCycles = [
      {
        cycle: { id: "c1", kind: "coding" as never, attempts: 1, createdAt: "2026-07-10T09:00:00Z" },
        lines: [
          { cycleId: "c1", cycleKind: "coding", cycleIndex: 1, kind: "tool_use", tool: "Write", summary: "todo-api/service.bal", toolUseId: "s1", emitter: "subagent", emitterId: "a1", emitterLabel: "todo-api", seq: 1 },
          { cycleId: "c1", cycleKind: "coding", cycleIndex: 1, kind: "tool_result", tool: "Agent", ok: true, status: "completed", summary: "todo-api", durationMs: 209158, toolCount: 19, linesAdded: 553, linesRemoved: 4, toolUseId: "a1", emitter: "subagent", emitterId: "a1", seq: 2 },
          { cycleId: "c1", cycleKind: "coding", cycleIndex: 1, kind: "tool_result", tool: "Agent", ok: false, status: "error_during_execution", summary: "todo-webapp", durationMs: 353000, toolCount: 31, toolUseId: "a2", emitter: "subagent", emitterId: "a2", emitterLabel: "todo-webapp", seq: 3 },
        ],
      },
    ];
    render(<RunFeed projectName="acme" runId="run-1" />);

    // Every figure is the SDK's own — the audit signal is how much code it made.
    expect(screen.getByText("completed \u00b7 3m29s \u00b7 19 tools \u00b7 +553/\u22124 lines")).toBeInTheDocument();
    // A subagent that died reads as a failure, not as merely going quiet.
    expect(screen.getByText("error_during_execution \u00b7 5m53s \u00b7 31 tools")).toBeInTheDocument();
    // Its closing report is the header, so it is NOT also a row in the section.
    expect(screen.queryByText(/\u25aa/)).not.toBeInTheDocument();
  });

  it("attaches a step's outcome to its own action row, not to a second row", () => {
    mockCycles = [
      {
        cycle: { id: "c1", kind: "coding" as never, attempts: 1, createdAt: "2026-07-10T09:00:00Z" },
        lines: [
          { cycleId: "c1", cycleKind: "coding", cycleIndex: 1, emitter: "main" as const, kind: "tool_use", tool: "Bash", summary: "bal build", toolUseId: "t1", seq: 1 },
          { cycleId: "c1", cycleKind: "coding", cycleIndex: 1, emitter: "main" as const, kind: "tool_use", tool: "Read", summary: "db.bal", toolUseId: "t2", seq: 2 },
          { cycleId: "c1", cycleKind: "coding", cycleIndex: 1, emitter: "main" as const, kind: "tool_result", tool: "Read", ok: true, durationMs: 20, toolUseId: "t2", seq: 3 },
          { cycleId: "c1", cycleKind: "coding", cycleIndex: 1, emitter: "main" as const, kind: "tool_result", tool: "Bash", ok: false, exitCode: 1, summary: "error: compilation contains errors", durationMs: 25100, toolUseId: "t1", seq: 4 },
        ],
      },
    ];
    render(<RunFeed projectName="acme" runId="run-1" />);

    // The action keeps its row; the outcome trails on it rather than repeating
    // the command a second time further down.
    expect(screen.getByText("$ bal build")).toBeInTheDocument();
    expect(screen.getByText("exit 1 \u00b7 error: compilation contains errors \u00b7 25.1s")).toBeInTheDocument();
    expect(screen.queryByText(/\u2717 Bash/)).not.toBeInTheDocument();
    // A fast success adds nothing — its action row stands alone.
    expect(screen.getByText("$ Read db.bal")).toBeInTheDocument();
  });

  it("filters to the cycle kinds a surface owns", () => {
    mockCycles = [
      section("c1", "coding", ["main"]),
      section("c2", "validation", ["main"]),
    ];
    render(
      <RunFeed projectName="acme" runId="run-1" cycleKinds={["validation"]} />,
    );
    expect(screen.getByText("validation")).toBeInTheDocument();
    expect(screen.queryByText("coding")).not.toBeInTheDocument();
  });

  it("says the run settled once the stream ends — only a terminal run does", () => {
    mockCycles = [section("c1", "coding", ["main"])];
    mockPhase = "ended";
    mockSettled = "succeeded";
    render(<RunFeed projectName="acme" runId="run-1" />);
    expect(screen.getByText(/run settled — succeeded/)).toBeInTheDocument();
  });

  it("says it is reattaching after a dropped connection", () => {
    mockPhase = "reconnecting";
    render(<RunFeed projectName="acme" runId="run-1" />);
    expect(screen.getByText(/reconnecting/)).toBeInTheDocument();
  });
});
