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

/**
 * Task-planner PLAN live eval (PAID) — report, not gate. Runs the real
 * `runTaskPlannerPlan` K times per fixture over the same fixtures + `scorePlan`
 * the deterministic plumbing test uses, and prints a summary. SKIPS cleanly
 * (exit 0, no tokens) when `ANTHROPIC_API_KEY` is unset — same posture as the
 * main-agent `eval`.
 *
 *   pnpm --filter @aep/agents eval:taskplanner
 *   EVAL_SAMPLES=5 pnpm --filter @aep/agents eval:taskplanner
 *
 * The live case of record is `all-four-kinds`: a bundle with component,
 * org-service, external, and platform-resource dependencies. A passing plan
 * orders each consumer after its provider AND names the external-resource +
 * platform-resource gates in the payments-api rationale.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createModel } from "../../src/shared/model.js";
import { loadDotenv } from "../../src/shared/env.js";
import { PlanRequestBody } from "../../src/agents/taskplanner/schema.js";
import { runTaskPlannerPlan } from "../../src/agents/taskplanner/run.js";
import { scorePlan, allPass, type TaskPlannerPlanFixture, type Check } from "./score.js";

const here = dirname(fileURLToPath(import.meta.url));

function loadFixtures(): TaskPlannerPlanFixture[] {
  const dir = join(here, "fixtures");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as TaskPlannerPlanFixture);
}

async function main(): Promise<void> {
  loadDotenv();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    process.stdout.write("eval:taskplanner: ANTHROPIC_API_KEY not set — skipping (no tokens spent).\n");
    return;
  }

  const model = createModel({ apiKey });
  const modelName = process.env.AGENT_MODEL || "claude-sonnet-5";
  const k = Math.max(1, Number(process.env.EVAL_SAMPLES ?? 3));
  const nameFilter = process.argv.slice(2).find((a) => !a.startsWith("-"));

  let fixtures = loadFixtures();
  if (nameFilter) fixtures = fixtures.filter((f) => f.name === nameFilter);

  process.stdout.write(`\n=== task-planner plan eval (model=${modelName}, K=${k}) — report-not-gate ===\n`);

  for (const fx of fixtures) {
    const input = PlanRequestBody.parse(fx.input);
    let passed = 0;
    for (let s = 1; s <= k; s++) {
      let checks: Check[] = [];
      try {
        const r = await runTaskPlannerPlan({ model, input });
        checks = scorePlan(r.items, fx.expect, input.slimDesign.map((c) => c.name));
        if (r.issues.length > 0) checks.push({ name: "validator-clean", pass: false, detail: r.issues.map((i) => i.code).join(",") });
      } catch (err) {
        checks = [{ name: "run", pass: false, detail: err instanceof Error ? err.message : String(err) }];
      }
      const ok = allPass(checks);
      if (ok) passed++;
      const failed = checks.filter((c) => !c.pass).map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`);
      process.stdout.write(`${fx.name} #${s}/${k} → ${ok ? "PASS" : `FAIL: ${failed.join("; ")}`}\n`);
    }
    process.stdout.write(`${fx.name}: ${passed}/${k} samples passed\n`);
  }
}

main().catch((err: unknown) => {
  // Report, don't gate: print and still exit 0.
  process.stderr.write(`eval:taskplanner error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
});
