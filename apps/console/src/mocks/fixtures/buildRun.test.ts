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
import { cycleCrew, RunFeed } from "@aep/progress-view";
import type { RunProgressCycle } from "../../features/builds/hooks/useRunProgress";
import { runSteps } from "../../features/builds/model/phases";
import { groupByFeature, validationOutcome } from "../../features/builds/model/validation";
import type { SpecFeature } from "../../features/spec/api/specModel";
import { framesUntil, runAt, runScript, snapshotAt, summaryAt, type RunInput, type RunScript } from "./buildRun";
import { designCatalog } from "./design";
import type { components } from "../../generated/aep-api";

type RunCycleView = components["schemas"]["RunCycleView"];
type RunEvent = components["schemas"]["RunEvent"];

// Acme Expenses' v1 as the card reads it: the scripted run folded as the
// progress stream would deliver it, then through the card's own models.

const criteria = designCatalog("acme-expenses", [{ id: "F1" }, { id: "F2" }] as SpecFeature[], new Map()).flatMap((a) =>
  a.source.kind === "acceptance" ? [{ path: a.source.path, content: a.source.content }] : [],
);

const v1: RunInput = {
  version: "v1",
  runId: "run-1",
  milestoneNumber: 1,
  features: [
    { id: "F1", name: "Submit expenses" },
    { id: "F2", name: "Approvals" },
  ],
  repair: null,
  criteria,
  failing: "F2.4",
  startedAt: Date.UTC(2026, 8, 30, 10),
};

/** The cycles and their events as useRunProgress folds the stream, `t` ms in. */
function streamed(script: RunScript, t: number): readonly RunProgressCycle[] {
  const feed = new RunFeed<RunCycleView, RunEvent>();
  for (const { frame } of framesUntil(script, t)) feed.apply(frame);
  return feed.snapshot().cycles;
}

function resultAt(script: RunScript, t: number) {
  const snapshot = snapshotAt(script, t, script.validation.id);
  return snapshot ? groupByFeature(snapshot) : null;
}

describe("Acme Expenses' first build, scripted", () => {
  const script = runScript(v1);

  it("takes 20 to 30 seconds, and the ledger says building until it ends", () => {
    expect(script.end).toBeGreaterThan(20_000);
    expect(script.end).toBeLessThan(30_000);
    expect(summaryAt(script, script.end - 1).status).toBe("in_progress");
    expect(summaryAt(script, script.end).status).toBe("completed");
  });

  it("plans the foundation, then each feature's API and web app, then validates", () => {
    const steps = runSteps(runAt(script, 4_500), streamed(script, 4_500));
    expect(steps.phases.map((p) => [p.label, p.state])).toEqual([
      ["Plan", "live"],
      ["Foundation · API", "queued"],
      ["F1 Submit expenses · API", "queued"],
      ["F1 Submit expenses · Web app", "queued"],
      ["F2 Approvals · API", "queued"],
      ["F2 Approvals · Web app", "queued"],
      ["Validate", "queued"],
    ]);
    const later = runSteps(runAt(script, 8_000), streamed(script, 8_000));
    expect(later.phases.slice(0, 3).map((p) => p.state)).toEqual(["done", "done", "live"]);
  });

  it("has no report while validation runs, then Submit expenses 5/5 and Approvals 5/6, F2.4 failing", () => {
    expect(resultAt(script, script.validation.created + 1_000)?.every((g) => g.judged === 0)).toBe(true);
    const groups = resultAt(script, script.end)!;
    expect(groups.map((g) => [g.id, g.name, `${g.passed}/${g.scenarios.length}`])).toEqual([
      ["F1", "Submit expenses", "5/5"],
      ["F2", "Approvals", "5/6"],
    ]);
    const deputy = groups[1]!.scenarios.find((s) => s.outcome === "failed");
    expect(deputy).toMatchObject({
      name: "A deputy approves while the manager is on leave",
      story: "F2.4",
      expected: "claim 43 is in Lee's queue",
      got: "an empty queue",
    });
    expect(runAt(script, script.end)).toMatchObject({ state: "succeeded", validation: { verdict: "failed" } });
    const steps = runSteps(runAt(script, script.end), streamed(script, script.end));
    expect(steps.phases.at(-1)).toMatchObject({ state: "done", count: { done: 11, total: 11 } });
  });

  it("fixes it in a repair build that re-runs every scenario and passes", () => {
    const fix = runScript({ ...v1, version: "v1.1", runId: "run-2", repair: { of: "v1", stories: ["F2.4"] }, failing: null });
    const steps = runSteps(runAt(fix, fix.end), streamed(fix, fix.end));
    expect(steps.phases.map((p) => p.label)).toEqual(["Plan", "F2 Approvals · API fix", "Validate"]);
    expect(validationOutcome(resultAt(fix, fix.end)!)).toEqual({ passed: 11, total: 11, failing: [], regressions: 0 });
  });
});

describe("the coding session's crew, scripted", () => {
  const script = runScript(v1);
  const coding = (t: number) => streamed(script, t).find((c) => c.cycle.id === script.coding.id)!;
  const at = (t: number) => v1.startedAt + t;

  it("starts as the runner's startup on the cycle, with no startup row in the log", () => {
    const c = coding(1_000);
    expect(c.events).toHaveLength(0);
    expect(c.boot?.code).toBe("runner_scheduling");
    expect(cycleCrew(c, at(1_000)).lead.caption).toBe("Waiting for a runner to be scheduled… · 0.2s");
    expect(coding(2_400).boot?.code).toBe("runner_starting");
    expect(coding(3_000).boot).toBeUndefined();
  });

  it("fans the features out to background agents, one of which waits inside a reviewer", () => {
    const crew = cycleCrew(coding(10_000), at(10_000));
    expect(crew.members.map((m) => [m.agent.label, m.depth, m.background])).toEqual([
      ["lead agent", 0, false],
      ["F1 Submit expenses · API", 1, true],
      ["F1 Submit expenses · Web app", 1, true],
      ["Review Submit expenses screens against the design", 2, false],
      ["F2 Approvals · API", 1, true],
      ["F2 Approvals · Web app", 1, true],
    ]);
    const web = crew.members.find((m) => m.id === "agent-F1-web");
    expect(web?.state).toBe("waiting");
    expect(web?.caption).toMatch(/^waiting on Review Submit expenses screens/);
  });

  it("ends with every agent settled with its report, and the lead's outcome", () => {
    const crew = cycleCrew(coding(script.coding.ended), at(script.coding.ended));
    expect(crew.running).toBe(0);
    expect(crew.outcome).toBe("success");
    expect(crew.members.slice(1).every((m) => m.state === "done" && m.agent.report)).toBe(true);
  });
});
