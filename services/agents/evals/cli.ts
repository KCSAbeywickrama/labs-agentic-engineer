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
 *   pnpm --filter @aep/agents eval                 # run all main fixtures, K samples
 *   pnpm --filter @aep/agents eval -- <fixture>    # run one fixture
 *   EVAL_RECORD=1 pnpm ... eval -- <fixture>       # record turns, print messages
 *
 * Each run dumps every turn's reconstructed snapshot under evals/.eval-preview/
 * (gitignored) for human inspection.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createModel } from "../src/shared/model.js";
import { loadDotenv } from "../src/shared/env.js";
import { loadFixture, loadFixtures } from "./fixture.js";
import { runSuite, recordFixture, writeResults, type RunOptions } from "./harness.js";
import { loadRepoSkills } from "./skills.js";
import { startMockMcpServer } from "./mocks/mcp-server.js";
import { mainSuite } from "./main/main.eval.js";

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  loadDotenv();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    process.stdout.write("eval: ANTHROPIC_API_KEY not set — skipping (no tokens spent).\n");
    return;
  }

  const nameFilter = process.argv.slice(2).find((a) => !a.startsWith("-"));
  const model = createModel({ apiKey });

  // The caller resolves skills from the repo (ADR-0002); the service reads none.
  const skills = mainSuite.skillsDir ? loadRepoSkills(mainSuite.skillsDir) : [];
  if (skills.length > 0) {
    process.stdout.write(`eval: ${skills.length} skill(s) in catalog: ${skills.map((s) => s.name).join(", ")}\n`);
  }

  // MCP discovery (Task E2): this repo doesn't run aep-api's real dependency-
  // discovery server, so the eval stands one in — the deterministic mock in
  // `evals/mocks/mcp-server.ts`, speaking the same JSON-RPC subset over a fixed
  // catalog (openweather / employee-api / postgres-cnpg). Pushed on every turn,
  // same as skills; closed in `finally` so the CLI process can exit.
  const mcpServer = await startMockMcpServer();
  process.stdout.write(`eval: mock mcp server at ${mcpServer.baseUrl}\n`);

  try {
    const mcp = { url: mcpServer.baseUrl, token: mcpServer.token };

    // Record mode: run a fixture's turns and print the resulting messages (for
    // authoring thread-2 captured-trace fixtures). Does not score.
    if (process.env.EVAL_RECORD === "1") {
      if (!nameFilter) {
        process.stdout.write("EVAL_RECORD requires a fixture name: eval -- <fixture>\n");
        return;
      }
      const fixture = loadFixture(join(mainSuite.fixturesDir, `${nameFilter}.json`));
      const messages = await recordFixture(mainSuite, fixture, model, skills, mcp);
      process.stdout.write(`${JSON.stringify(messages, null, 2)}\n`);
      return;
    }

    let fixtures = loadFixtures(mainSuite.fixturesDir);
    if (nameFilter) fixtures = fixtures.filter((f) => f.name === nameFilter);
    if (fixtures.length === 0) {
      process.stdout.write(`eval: no fixtures${nameFilter ? ` matching "${nameFilter}"` : ""}.\n`);
      return;
    }

    const samples = Math.max(1, Number(process.env.EVAL_SAMPLES ?? 3));
    const opts: RunOptions = {
      model,
      samples,
      ...(skills.length > 0 ? { skills } : {}),
      mcp,
      onLog: (m) => process.stdout.write(`${m}\n`),
      writePreviewDir: join(here, ".eval-preview"),
    };

    const result = await runSuite(mainSuite, fixtures, opts);
    writeResults(join(here, "eval-results", `${mainSuite.agent}.json`), result);

    process.stdout.write("\n=== eval summary (report-not-gate) ===\n");
    for (const f of result.fixtures) {
      process.stdout.write(`${f.name}: ${f.passed}/${f.samples} samples passed (${Math.round(f.passRate * 100)}%)\n`);
    }
  } finally {
    await mcpServer.close();
  }
}

main().catch((err: unknown) => {
  // Report, don't gate: print and still exit 0.
  process.stderr.write(`eval error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
});
