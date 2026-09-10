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

// Checks an acceptance run's report against the feature files it claims to have
// run. EXPERIMENT-ONLY, beside the incumbent Playwright validation path.
//
//   node scripts/check-acceptance-report.mjs <project-dir>
//
// Exit 0 = the report is answerable for · 1 = usage/IO · 2 = a contract breach.
//
// The run's verdict comes from an agent, and the literature puts the false-
// success rate for a self-assessing agent at 45-75% with LLM judges barely
// better than chance at spotting it. So nothing here judges whether an outcome
// is CORRECT — that is unknowable from the outside. What is checkable is
// whether the agent can be held to it:
//
//   - every scenario in the feature files has an entry, so one that was hard
//     cannot be quietly dropped; it has to be reported `blocked`;
//   - a `passed` scenario carries a Then step with a command and exit 0, so a
//     pass cannot be asserted without something that could have said no;
//   - a `failed` scenario carries a Then that actually failed.
//
// Modelled on generate-report.mjs's exit-2 contract, which fails a validation
// run for a spec on disk with no result.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { AstBuilder, GherkinClassicTokenMatcher, Parser } from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";

const OUTCOMES = new Set(["passed", "failed", "blocked", "unjudgeable"]);

const projectDir = process.argv[2];
if (!projectDir) {
  console.error("usage: node scripts/check-acceptance-report.mjs <project-dir>");
  process.exit(1);
}

const featureDir = join(projectDir, "specs/acceptance");
const reportPath = join(projectDir, "tests/acceptance/report.json");
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

/** Every scenario the feature files define, as "feature ▸ rule ▸ scenario". */
const parser = new Parser(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher());
const expected = new Map();
for (const file of readdirSync(featureDir).filter((f) => f.endsWith(".feature")).sort()) {
  const doc = parser.parse(readFileSync(join(featureDir, file), "utf8"));
  const feature = doc.feature;
  if (!feature) continue;
  const add = (rule, scenario) =>
    expected.set(`${feature.name} ▸ ${rule} ▸ ${scenario.name}`, `${file}:${scenario.location.line}`);
  for (const child of feature.children ?? []) {
    if (child.scenario) add("", child.scenario);
    for (const rc of child.rule?.children ?? []) if (rc.scenario) add(child.rule.name, rc.scenario);
  }
}

const errors = [];
const entries = Array.isArray(report.scenarios) ? report.scenarios : null;
if (!entries) errors.push("report has no `scenarios` array");
if (report.schemaVersion !== 1) errors.push(`unknown schemaVersion ${JSON.stringify(report.schemaVersion)}`);
if (!report.reset) errors.push("report does not say how state was reset between scenarios");

const seen = new Map();
const tally = { passed: 0, failed: 0, blocked: 0, unjudgeable: 0 };

for (const [i, s] of (entries ?? []).entries()) {
  const key = `${s.feature} ▸ ${s.rule ?? ""} ▸ ${s.scenario}`;
  const at = `scenarios[${i}] "${s.scenario}"`;

  if (!expected.has(key)) errors.push(`${at}: no such scenario in the feature files (${key})`);
  if (seen.has(key)) errors.push(`${at}: reported twice`);
  seen.set(key, true);

  if (!OUTCOMES.has(s.outcome)) {
    errors.push(`${at}: outcome ${JSON.stringify(s.outcome)} is not one of ${[...OUTCOMES].join(", ")}`);
    continue;
  }
  tally[s.outcome] += 1;

  const thens = (s.steps ?? []).filter((st) => st.keyword === "Then");
  const settled = thens.filter((st) => st.command && typeof st.exit === "number");

  // A pass has to be backed by something that could have said no.
  if (s.outcome === "passed") {
    if (thens.length === 0) errors.push(`${at}: passed with no Then step recorded`);
    else if (settled.length !== thens.length)
      errors.push(`${at}: passed but ${thens.length - settled.length} of ${thens.length} Then steps carry no command+exit`);
    else if (settled.some((st) => st.exit !== 0))
      errors.push(`${at}: passed but a Then step exited nonzero`);
  }
  if (s.outcome === "failed" && !settled.some((st) => st.exit !== 0)) {
    errors.push(`${at}: failed but no Then step records a nonzero exit — what failed?`);
  }
}

for (const [key, where] of expected) {
  if (!seen.has(key)) errors.push(`${where}: "${key.split(" ▸ ").pop()}" has no entry in the report`);
}

console.log(`acceptance report — ${report.scenarios?.length ?? 0} of ${expected.size} scenarios`);
console.log(`  passed ${tally.passed} · failed ${tally.failed} · blocked ${tally.blocked} · unjudgeable ${tally.unjudgeable}`);
if (report.reset) console.log(`  reset  ${report.reset}`);

if (errors.length) {
  console.log(`\nfailed (${errors.length}):`);
  for (const e of errors) console.log(`  x ${e}`);
  process.exit(2);
}
console.log("\nok — the report is answerable for every scenario");
