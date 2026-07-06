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
 * The eval entry (`pnpm --filter @aep/agents eval`). Report-not-gate: always
 * exits 0, and SKIPS cleanly (no tokens) when `ANTHROPIC_API_KEY` is unset.
 *
 *   pnpm --filter @aep/agents eval                     # run every suite, K samples
 *   pnpm --filter @aep/agents eval -- <fixture>        # run one fixture (any suite)
 *   pnpm --filter @aep/agents eval -- --suite=task-plan  # run one suite
 *   EVAL_RECORD=1 pnpm ... eval -- <fixture>           # record turns, print messages (main only)
 *
 * The file suite dumps every turn's reconstructed snapshot under
 * evals/.eval-preview/ (gitignored) for human inspection.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createModel } from "../src/shared/model.js";
import { loadDotenv } from "../src/shared/env.js";
import { loadFixture, loadFixtures } from "./fixture.js";
import { runSuite, recordFixture, writeResults, type RunOptions } from "./harness.js";
import { runSuite as runTaskPlanSuite } from "./task-plan/harness.js";
import { loadRepoSkills } from "./skills.js";
import { mainSuite } from "./main/main.eval.js";
import { taskPlanSuite, taskPlanFixtures } from "./task-plan/task-plan.eval.js";

const here = dirname(fileURLToPath(import.meta.url));

/** `--suite=<name>` selects one suite; a bare positional arg is a fixture-name filter. */
function parseArgs(argv: string[]): { suite?: string; nameFilter?: string } {
  const suiteArg = argv.find((a) => a.startsWith("--suite="));
  return {
    ...(suiteArg ? { suite: suiteArg.slice("--suite=".length) } : {}),
    ...(() => {
      const positional = argv.find((a) => !a.startsWith("-"));
      return positional ? { nameFilter: positional } : {};
    })(),
  };
}

async function runMainSuite(model: ReturnType<typeof createModel>, apiKey: string, nameFilter?: string): Promise<void> {
  const skills = mainSuite.skillsDir ? loadRepoSkills(mainSuite.skillsDir) : [];

  if (process.env.EVAL_RECORD === "1") {
    if (!nameFilter) {
      process.stdout.write("EVAL_RECORD requires a fixture name: eval -- <fixture>\n");
      return;
    }
    const fixture = loadFixture(join(mainSuite.fixturesDir, `${nameFilter}.json`));
    const messages = await recordFixture(mainSuite, fixture, model, skills, apiKey);
    process.stdout.write(`${JSON.stringify(messages, null, 2)}\n`);
    return;
  }

  let fixtures = loadFixtures(mainSuite.fixturesDir);
  if (nameFilter) fixtures = fixtures.filter((f) => f.name === nameFilter);
  if (fixtures.length === 0) return;

  const samples = Math.max(1, Number(process.env.EVAL_SAMPLES ?? 3));
  const opts: RunOptions = {
    model,
    samples,
    apiKey,
    ...(skills.length > 0 ? { skills } : {}),
    onLog: (m) => process.stdout.write(`${m}\n`),
    writePreviewDir: join(here, ".eval-preview"),
  };

  process.stdout.write(`\n=== suite: main (${skills.length} skill(s)) ===\n`);
  const result = await runSuite(mainSuite, fixtures, opts);
  writeResults(join(here, "eval-results", `${mainSuite.agent}.json`), result);
  for (const f of result.fixtures) {
    process.stdout.write(`main/${f.name}: ${f.passed}/${f.samples} samples passed (${Math.round(f.passRate * 100)}%)\n`);
  }
}

async function runPlanSuite(model: ReturnType<typeof createModel>, apiKey: string, nameFilter?: string): Promise<void> {
  const skills = taskPlanSuite.skillsDir ? loadRepoSkills(taskPlanSuite.skillsDir) : [];
  let fixtures = taskPlanFixtures;
  if (nameFilter) fixtures = fixtures.filter((f) => f.name === nameFilter);
  if (fixtures.length === 0) return;

  const samples = Math.max(1, Number(process.env.EVAL_SAMPLES ?? 3));
  process.stdout.write(`\n=== suite: task-plan (${skills.length} skill(s)) ===\n`);
  const result = await runTaskPlanSuite(taskPlanSuite, fixtures, {
    model,
    samples,
    apiKey,
    ...(skills.length > 0 ? { skills } : {}),
    onLog: (m) => process.stdout.write(`${m}\n`),
  });
  writeResults(join(here, "eval-results", `${taskPlanSuite.agent}.json`), result);
  for (const f of result.fixtures) {
    process.stdout.write(`task-plan/${f.name}: ${f.passed}/${f.samples} samples passed (${Math.round(f.passRate * 100)}%)\n`);
  }
}

async function main(): Promise<void> {
  loadDotenv();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    process.stdout.write("eval: ANTHROPIC_API_KEY not set — skipping (no tokens spent).\n");
    return;
  }

  const { suite, nameFilter } = parseArgs(process.argv.slice(2));
  const model = createModel({ apiKey });

  if (!suite || suite === "main") await runMainSuite(model, apiKey, nameFilter);
  if (!suite || suite === "task-plan") await runPlanSuite(model, apiKey, nameFilter);
}

main().catch((err: unknown) => {
  // Report, don't gate: print and still exit 0.
  process.stderr.write(`eval error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
});
