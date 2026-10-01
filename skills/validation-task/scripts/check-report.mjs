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

// Checks an assembled acceptance report against the feature files it claims to
// have run.
//
//   node "$AEP_SKILLS_DIR/validation-task/scripts/check-report.mjs" <project-dir>
//
// Exit 0 = the report is answerable for · 1 = usage/IO · 2 = a contract breach.
//
// The run's verdict comes from an agent, and the literature puts the false-
// success rate for a self-assessing agent at 45-75% with LLM judges barely
// better than chance at spotting it. So nothing here judges whether an outcome
// is CORRECT — that is unknowable from the outside. What is checkable is
// whether the agent can be held to it.
//
// The PER-SCENARIO rules live in `report-rules.mjs`, because `capture-scenario.mjs`
// applies the same ones the moment each scenario finishes. What stays here is what
// only the whole document can answer: the version, the run-level fields, and
// whether every scenario the feature files declare has exactly one entry.
//
// NO DEPENDENCIES, deliberately. This file ships INSIDE the skill (the mirror
// carries a skill's `scripts/`), so it runs from the project clone in a
// validation pod where no package.json of ours is installed and a bare
// `import "@cucumber/gherkin"` would not resolve — NODE_PATH does not apply to
// ESM. The repo-root `lint-acceptance-criteria.mjs` keeps the real parser; it
// is a developer gate that runs where the workspace is installed.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  FEATURE_DIR,
  REPORT_PATH,
  SCHEMA_VERSION,
  checkScenario,
  readFeatureScenarios,
  scenarioKey,
} from "./report-rules.mjs";

const projectDir = process.argv[2];
if (!projectDir) {
  console.error("usage: node check-report.mjs <project-dir>");
  process.exit(1);
}

const featureDir = join(projectDir, FEATURE_DIR);
const reportPath = join(projectDir, REPORT_PATH);
for (const [label, p] of [["acceptance dir", featureDir], ["report", reportPath]]) {
  if (!existsSync(p)) {
    console.error(`error: ${label} not found at ${p}`);
    process.exit(1);
  }
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (e) {
  console.error(`error: report is not valid JSON — ${e.message}`);
  process.exit(2);
}

const expected = readFeatureScenarios(featureDir);

const errors = [];
const entries = Array.isArray(report.scenarios) ? report.scenarios : null;
if (!entries) errors.push("report has no `scenarios` array");
if (report.schemaVersion !== SCHEMA_VERSION)
  errors.push(`unknown schemaVersion ${JSON.stringify(report.schemaVersion)} (expected ${SCHEMA_VERSION})`);
if (!report.isolation) errors.push("report does not say how scenarios were kept independent of each other");
if (!report.commit) errors.push("report does not say which commit it judged");

const seen = new Map();
const tally = { passed: 0, failed: 0, blocked: 0, unjudgeable: 0 };

for (const [i, s] of (entries ?? []).entries()) {
  const key = scenarioKey(s.feature, s.rule, s.scenario);
  const at = `scenarios[${i}] "${s.scenario}"`;

  if (!expected.has(key)) errors.push(`${at}: no such scenario in the feature files (${key})`);
  if (seen.has(key)) errors.push(`${at}: reported twice`);
  seen.set(key, true);

  if (tally[s.outcome] !== undefined) tally[s.outcome] += 1;
  for (const e of checkScenario(s, expected)) errors.push(`${at}: ${e}`);

  // The report names the snapshot rather than carrying it, so the name has to
  // resolve. A path to a file that was never written reads exactly like evidence
  // until somebody follows it, which is the one moment it cannot be recovered.
  const file = s.evidence?.snapshotFile;
  if (typeof file === "string" && file.trim() !== "" && !existsSync(join(projectDir, file))) {
    errors.push(`${at}: \`evidence.snapshotFile\` points at ${file}, which does not exist`);
  }
}

for (const [key, where] of expected) {
  if (!seen.has(key)) errors.push(`${where}: "${key.split(" ▸ ").pop()}" has no entry in the report`);
}

console.log(`acceptance report — ${report.scenarios?.length ?? 0} of ${expected.size} scenarios`);
console.log(`  passed ${tally.passed} · failed ${tally.failed} · blocked ${tally.blocked} · unjudgeable ${tally.unjudgeable}`);
if (report.isolation) console.log(`  isolation  ${report.isolation}`);

if (errors.length) {
  console.log(`\nfailed (${errors.length}):`);
  for (const e of errors) console.log(`  x ${e}`);
  process.exit(2);
}
console.log("\nok — the report is answerable for every scenario");
