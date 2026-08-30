#!/usr/bin/env node
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

// Wiring only: every decision this file makes lives in src/. It parses the
// scenario file, emits a promptfoo config, actually runs promptfoo against
// it (the locally installed, exactly pinned binary — never `npx
// promptfoo@latest`), and turns whatever came out into a report.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseScenarios } from "../src/scenario.js";
import { buildPromptfooConfig } from "../src/config.js";
import { readVerdict } from "../src/verdict.js";
import { renderReport, renderRunFailureReport } from "../src/report.js";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || !process.argv[i + 1]) throw new Error(`agent-eval: --${name} is required`);
  return process.argv[i + 1]!;
}

// The one mistake this script cannot make quietly: a key leaking into a log
// line or a report. Nothing here writes ANTHROPIC_API_KEY on purpose, but
// promptfoo's own stderr is a third party's text — scrub anything
// key-shaped before it reaches anything the CLI writes to disk.
function redactKeys(text: string): string {
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, "«redacted»");
}

/**
 * The locally installed promptfoo binary, resolved through this package's
 * OWN pinned dependency rather than hard-coded into a node_modules/.bin
 * path — so it keeps working whether this file runs from source or from a
 * built package, and it is never `npx promptfoo@latest` fetching whatever
 * happens to be current on the day a build runs.
 */
function resolvePromptfooBin(): string {
  const req = createRequire(import.meta.url);
  const entry = req.resolve("promptfoo");
  return join(dirname(entry), "entrypoint.js");
}

// `AGENT_EVAL_GRADER` unset falls back to the documented default; SET-BUT-
// BLANK must fall back too. `?? default` alone would hand `""` straight to
// `buildPromptfooConfig`, which rejects a blank grader on purpose — a `??`
// only catches `undefined`/`null`, not an empty string.
function resolveGraderModel(): string {
  const fromEnv = process.env.AGENT_EVAL_GRADER;
  if (fromEnv !== undefined && fromEnv.trim() !== "") return fromEnv;
  return "anthropic:messages:claude-sonnet-5";
}

const scenariosPath = arg("scenarios");
const appDir = arg("app");
const outDir = arg("out");

const file = parseScenarios(JSON.parse(readFileSync(scenariosPath, "utf8")));
mkdirSync(outDir, { recursive: true });

const configPath = join(outDir, "promptfooconfig.json");
const outJsonPath = join(outDir, "out.json");
const reportPath = join(outDir, "report.md");

writeFileSync(
  configPath,
  JSON.stringify(
    buildPromptfooConfig(file, {
      providerPath: new URL("../src/provider.ts", import.meta.url).pathname,
      graderModel: resolveGraderModel(),
    }),
    null,
    2,
  ),
);

// Invoke promptfoo against the config just written, in the component's own
// directory (so any relative paths in its own contract resolve against the
// agent under test, not against this package). Telemetry, update checks and
// sharing are all network calls this run has no business making.
const run = spawnSync(
  process.execPath,
  [resolvePromptfooBin(), "eval", "-c", configPath, "-o", outJsonPath, "--no-cache"],
  {
    cwd: appDir,
    encoding: "utf8",
    env: {
      ...process.env,
      PROMPTFOO_DISABLE_TELEMETRY: "1",
      PROMPTFOO_DISABLE_UPDATE: "1",
      PROMPTFOO_DISABLE_SHARING: "1",
    },
  },
);

// promptfoo's OWN exit code means "did every assertion pass" — it is
// non-zero for an ordinary low-scoring or errored SCENARIO too, and that is
// report content the Verdict already knows how to render, not a run
// failure. The signal for "the run itself failed" is whether it produced a
// readable result file at all: a spawn error, or a crash before any output
// was written (bad config, missing provider file, ...), never gets that far.
// Never a build failure either way, and never silently rendered as a clean
// pass — that vacuous-gate shape has already cost this plan two fix rounds
// (Tasks 5 and 6); this is where it does not happen a third time.
let outJson: unknown;
try {
  if (run.error !== undefined) throw run.error;
  outJson = JSON.parse(readFileSync(outJsonPath, "utf8"));
} catch (e) {
  const parseDetail = e instanceof Error ? e.message : String(e);
  const detail = `${parseDetail}\npromptfoo exit ${String(run.status)}:\n${run.stderr}`;
  writeFileSync(
    reportPath,
    renderRunFailureReport({ component: file.component, error: redactKeys(detail) }),
  );
  process.exit(0);
}

const verdict = readVerdict(outJson, file);
writeFileSync(
  reportPath,
  renderReport(verdict, {
    component: file.component,
    promptChanged: process.env.AGENT_EVAL_PROMPT_CHANGED === "1",
  }),
);

// Exit 0 regardless: a failing scenario is report content, not a build failure.
process.exit(0);
