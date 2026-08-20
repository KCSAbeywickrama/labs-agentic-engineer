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
import type { RunProgressPhase } from "../hooks/useRunProgress";
import type { BuildProgressRunSection } from "../hooks/useBuildProgress";

let mockRuns: BuildProgressRunSection[] = [];
let mockPhase: RunProgressPhase = "live";
let mockReason: string | undefined;

vi.mock("../hooks/useBuildProgress", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../hooks/useBuildProgress")>();
  return {
    ...actual,
    useBuildProgress: () => ({
      runs: mockRuns,
      phase: mockPhase,
      settledReason: mockReason,
    }),
  };
});

import { BuildFeed } from "./BuildFeed";

function section(
  runId: string,
  kind: string,
  index: number,
  cycles: { id: string; kind: string }[],
): BuildProgressRunSection {
  return {
    run: { id: runId, kind: kind as never, index },
    cycles: cycles.map((c) => ({
      cycle: {
        id: c.id,
        kind: c.kind as never,
        attempts: 1,
        createdAt: "2026-07-10T09:00:00Z",
      },
      lines: [
        {
          cycleId: c.id,
          cycleKind: c.kind,
          cycleIndex: 1,
          kind: "log",
          emitter: "main" as const,
          seq: 1,
          summary: `${c.id} line`,
        },
      ],
    })),
  };
}

afterEach(() => {
  mockRuns = [];
  mockPhase = "live";
  mockReason = undefined;
});

describe("BuildFeed", () => {
  // The section marker is the run's KIND, in the vocabulary runView owns — so a
  // run is called the same thing here as on the run card and the history rows.
  it("renders one section per run, marked by kind", () => {
    mockRuns = [
      section("r1", "dev", 1, [{ id: "c1", kind: "coding" }]),
      section("r2", "task", 2, [{ id: "c2", kind: "coding" }]),
      section("r3", "validation", 3, [{ id: "c3", kind: "validation" }]),
    ];
    render(<BuildFeed projectName="acme" tag="v3" runIds={["r1", "r2", "r3"]} />);
    expect(screen.getByText("RUN 1 · SPEC BUILD")).toBeInTheDocument();
    expect(screen.getByText("RUN 2 · INCIDENT")).toBeInTheDocument();
    expect(screen.getByText("RUN 3 · REVALIDATION")).toBeInTheDocument();
  });

  // Chronological, unlike the single-run feed: this is a narrative, and it reads
  // forwards.
  it("reads forwards — the oldest run leads", () => {
    mockRuns = [
      section("r1", "dev", 1, [{ id: "c1", kind: "coding" }]),
      section("r2", "task", 2, [{ id: "c2", kind: "coding" }]),
    ];
    render(<BuildFeed projectName="acme" tag="v3" runIds={["r1", "r2"]} />);
    expect(
      screen.getAllByText(/^RUN \d+ · /).map((el) => el.textContent),
    ).toEqual(["RUN 1 · SPEC BUILD", "RUN 2 · INCIDENT"]);
  });

  // Cycle numbering is RUN-RELATIVE, which is what the wire carries: the second
  // run's first cycle is "Cycle 1" again, and the heading above is what tells the
  // two apart.
  it("numbers cycles within their own run", () => {
    mockRuns = [
      section("r1", "dev", 1, [
        { id: "c1", kind: "coding" },
        { id: "c2", kind: "fix" },
      ]),
      section("r2", "task", 2, [{ id: "c3", kind: "coding" }]),
    ];
    render(<BuildFeed projectName="acme" tag="v3" runIds={["r1", "r2"]} />);
    expect(
      screen.getAllByText(/^Cycle \d+$/).map((el) => el.textContent),
    ).toEqual(["Cycle 1", "Cycle 2", "Cycle 1"]);
  });

  // The ordinary version: one run, and the stitched view must not read as
  // scaffolding around it.
  it("works when the version has only one run", () => {
    mockRuns = [
      section("r1", "dev", 1, [{ id: "c1", kind: "coding" }]),
    ];
    render(<BuildFeed projectName="acme" tag="v3" runIds={["r1"]} />);
    expect(screen.getByText("RUN 1 · SPEC BUILD")).toBeInTheDocument();
    expect(screen.getByText("Cycle 1")).toBeInTheDocument();
  });

  // The newest cycle of the newest run is what a reader came to watch, so it is
  // the one box that opens.
  it("opens the newest cycle of the newest run", () => {
    mockRuns = [
      section("r1", "dev", 1, [{ id: "c1", kind: "coding" }]),
      section("r2", "task", 2, [
        { id: "c2", kind: "coding" },
        { id: "c3", kind: "fix" },
      ]),
    ];
    render(<BuildFeed projectName="acme" tag="v3" runIds={["r1", "r2"]} />);
    const open = screen
      .getAllByRole("button", { name: /Cycle \d/ })
      .filter((el) => el.getAttribute("aria-expanded") === "true");
    expect(open).toHaveLength(1);
    expect(open[0]?.textContent).toContain("Cycle 2");
  });

  // A settled stream must not claim the version is over: it ended because no run
  // is live, and a later run may be admitted on the same milestone.
  it("says nothing is running rather than that the version finished", () => {
    mockRuns = [section("r1", "dev", 1, [{ id: "c1", kind: "coding" }])];
    mockPhase = "ended";
    mockReason = "no_live_run";
    render(<BuildFeed projectName="acme" tag="v3" runIds={["r1"]} />);
    expect(
      screen.getByText("nothing is running on this version right now"),
    ).toBeInTheDocument();
  });

  it("says so when no run has written a line yet", () => {
    render(<BuildFeed projectName="acme" tag="v3" runIds={["r1"]} />);
    expect(
      screen.getByText(/No agent output yet/),
    ).toBeInTheDocument();
  });
});
