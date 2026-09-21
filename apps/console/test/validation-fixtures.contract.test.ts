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

// OUTSIDE src/ deliberately. This is the only test in the console that needs
// node's own APIs — it shells out to the real checker — and `tsconfig.json` pins
// `types` to `vite/client` precisely so app code cannot reach for `process.env`
// and still typecheck. Adding node to that array (or referencing it from inside
// src/) widens the whole PROGRAM: node's `setTimeout` overload then beats the
// DOM's, and sibling packages start failing on `Timeout` vs `number`. So the
// node-side harness lives here, where `include: ["src"]` never sees it.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  validationDetail,
  validationFiles,
  validationLedger,
  validationRuns,
  validationSnapshot,
  VALIDATION_SCENARIOS,
  type ValidationScenario,
  type ValidationStory,
} from "../src/mocks/fixtures/validation";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CHECKER = join(REPO, "skills/acceptance-run/scripts/check-report.mjs");

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function layOut(files: { path: string; content: string }[]): string {
  const root = mkdtempSync(join(tmpdir(), "aep-mock-"));
  mkdirSync(join(root, "specs/acceptance"), { recursive: true });
  mkdirSync(join(root, "tests/acceptance"), { recursive: true });
  for (const f of files) writeFileSync(join(root, f.path), f.content);
  return root;
}

/**
 * Every mock scenario that ships a report has to satisfy the contract a REAL run
 * is held to — the checker the run itself invokes, not a second opinion about it.
 *
 * Without this the fixtures only have to look plausible, and a mock that is
 * merely plausible is how a view comes to be designed against a shape nothing
 * writes: `line` numbers typed rather than counted, a `passed` scenario with no
 * command behind it, a `blocked` one that never says what stopped it. Each of
 * those renders perfectly well and is a lie.
 */
describe("the mock validation fixtures satisfy the run's own report contract", () => {
  const reported = VALIDATION_SCENARIOS.filter(
    (s) => validationFiles({ scenario: s }).some((f) => f.path === "tests/acceptance/report.json"),
  );

  it("covers the verdicts that ship a report", () => {
    expect([...reported].sort()).toEqual(
      ["awaiting-fix", "failed", "inconclusive", "partial", "passed"],
    );
  });

  it.each(reported)("%s passes check-report.mjs", (scenario) => {
    dir = layOut(validationFiles({ scenario }));
    // Throws on a nonzero exit, and the checker exits 2 on a contract breach with
    // every one of them printed — so a failure here names what is wrong.
    expect(() => execFileSync("node", [CHECKER, dir as string], { encoding: "utf8" })).not.toThrow();
  });

  // Drift is the one state where the two files are SUPPOSED to disagree: the
  // feature files carry a scenario the pinned report predates. The checker is
  // right to fail it, and it must fail for that reason alone — a drifted fixture
  // that also broke some other rule would be indistinguishable.
  it("drifts by exactly one uncovered scenario, and nothing else", () => {
    dir = layOut(validationFiles({ scenario: "partial" }, true));
    let output = "";
    expect(() => {
      try {
        execFileSync("node", [CHECKER, dir as string], { encoding: "utf8" });
      } catch (e) {
        output = String((e as { stdout?: string }).stdout ?? "");
        throw e;
      }
    }).toThrow();
    const breaches = output.split("\n").filter((l) => l.trim().startsWith("x "));
    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toContain("has no entry in the report");
  });
});

/**
 * The read-model fixtures describe the SAME run as the run-story ones.
 *
 * They are derived from it rather than written beside it, and this is what
 * holds that true: a second hand-written set describing the same state is how
 * the validation page and the deployments board came to disagree about one run
 * in the first place (#423). A fixture that can contradict itself teaches the
 * UI to render a state the platform cannot produce.
 */
describe("the validation read-model fixtures agree with the run story", () => {
  it.each(VALIDATION_SCENARIOS)("%s reports the same state everywhere", (scenario) => {
    const ledger = validationLedger({ scenario });
    const detail = validationDetail({ scenario });
    const current = ledger.validations.find((v) => v.tag === "v1");

    expect(current?.state).toBe(scenario);
    expect(detail.state).toBe(scenario);
    expect(detail.milestoneNumber).toBe(current?.milestoneNumber);
  });

  // The ledger exists to make older versions reachable, so a fixture with one
  // row would hide the feature it is there to show.
  it("always offers more than the scenario's own version", () => {
    const rows = validationLedger({ scenario: "passed" }).validations;
    expect(rows.length).toBeGreaterThan(1);
    // Including one never validated — the row a reader most needs to find.
    expect(rows.some((r) => r.state === "none")).toBe(true);
  });

  it("carries only validation cycles, on runs that attempted one", () => {
    for (const scenario of VALIDATION_SCENARIOS) {
      for (const origin of ["spec-build", "revalidate"] as const) {
        for (const run of validationDetail({ scenario, origin }).runs) {
          expect(run.cycles.length).toBeGreaterThan(0);
          for (const c of run.cycles) expect(c.kind).toBe("validation");
        }
      }
    }
  });

  // A snapshot pairs a report with the criteria AT THE SAME COMMIT. An attempt
  // still running has no commit, so it has criteria and no report — which is a
  // different fact from an empty report and renders as a different screen.
  // The ledger's older rows exist so an old version is READABLE; `deployed`
  // marks the one that is also revalidatable. A fixture set where every version
  // is deployed would leave the gate untestable by hand.
  it("marks exactly the scenario's own version as deployed", () => {
    expect(validationDetail({ scenario: "passed" }).deployed).toBe(true);
    expect(validationDetail({ scenario: "passed" }, "v0.2").deployed).toBe(false);
  });

  it("pairs a report with a commit, or has neither", () => {
    for (const scenario of VALIDATION_SCENARIOS) {
      const snap = validationSnapshot({ scenario });
      expect(Boolean(snap.report)).toBe(Boolean(snap.commit));
    }
  });
});

/**
 * A revalidated version is the one story with a HISTORY: the trigger starts a
 * validation run over a version its dev run already built and judged. It is
 * what the page's two-block cards and their newest-first order exist for, and
 * without it neither could be seen in mock mode — every other story is one run.
 */
describe("a revalidated version", () => {
  // Where a validation run can honestly settle in the scenario's state.
  const revalidated: ValidationScenario[] = [
    "passed",
    "partial",
    "inconclusive",
    "failed",
    "unreported",
    "running",
    "cancelled",
  ];
  const story = (scenario: ValidationScenario): ValidationStory => ({ scenario, origin: "revalidate" });

  it.each(revalidated)("%s stacks the dev run beneath the revalidation, newest first", (scenario) => {
    const runs = validationRuns(story(scenario)).runs ?? [];
    expect(runs).toHaveLength(2);
    const [newest, dev] = runs;
    expect(newest?.kind).toBe("validation");
    expect(newest?.origin).toBe("revalidate");
    expect(dev?.kind).toBe("dev");
    expect(String(newest?.createdAt) > String(dev?.createdAt)).toBe(true);
    // A validation run builds nothing, so its cycles are all judgements.
    for (const c of newest?.cycles ?? []) expect(c.kind).toBe("validation");
    // The state is still the scenario's — it is the newest run's to set.
    expect(validationDetail(story(scenario)).state).toBe(scenario);
  });

  // The console keys sections and the one-open rule on the cycle id, so two
  // runs sharing one would open two attempts at once.
  it.each(revalidated)("%s never reuses a cycle id across its runs", (scenario) => {
    const ids = (validationRuns(story(scenario)).runs ?? []).flatMap((r) =>
      r.cycles.map((c) => c.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Each attempt reads its report at ITS commit. The dev run's attempts failed,
  // the revalidation reached the scenario's verdict, and a reader opening both
  // must see two different reports — or the history is decoration.
  it("reads a history attempt at its own commit, not the branch tip", () => {
    const passed = story("passed");
    const newest = validationSnapshot(passed, false, "run2-cycle-1");
    const history = validationSnapshot(passed, false, "cycle-2");
    expect(newest.report).toBe(validationSnapshot(passed).report);
    expect(history.report).toBeDefined();
    expect(history.report).not.toBe(newest.report);
    expect(history.report).toBe(validationSnapshot({ scenario: "failed" }).report);
  });

  // The ledger row dates the version's LATEST attempt, which is the
  // revalidation's — not the dev run's, which happens to be listed last.
  it("dates the ledger row by the revalidation", () => {
    const row = validationLedger(story("passed")).validations.find((v) => v.tag === "v1");
    expect(row?.endedAt).toBe("2026-07-12T14:19:00Z");
  });

  // An attempt that committed nothing leaves the dev run's report at the tip,
  // which is what the Spec view then shows — the same rule as a repeat attempt.
  it("keeps the dev run's report at the tip while the revalidation is unsettled", () => {
    for (const scenario of ["running", "cancelled"] as const) {
      const report = validationFiles(story(scenario)).find((f) => f.path === "tests/acceptance/report.json");
      expect(report?.content).toBe(validationSnapshot({ scenario: "failed" }).report);
    }
  });

  // The dev loop's own shapes, a version the trigger refuses, and a self-heal
  // repeat: none is a state a validation run can be in, so the key is ignored
  // rather than honoured with a run the platform could never produce.
  it("is ignored where a validation run has no honest shape", () => {
    for (const scenario of ["none", "awaiting-fix", "skipped"] as const) {
      expect(validationRuns(story(scenario)).runs).toHaveLength(1);
    }
    expect(
      validationRuns({ scenario: "running", attempt: "repeat", origin: "revalidate" }).runs,
    ).toHaveLength(1);
  });
});
