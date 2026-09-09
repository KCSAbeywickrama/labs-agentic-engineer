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

// Linter for the Gherkin acceptance criteria (the `acceptance-criteria`
// skill's output). EXPERIMENT-ONLY, alongside the incumbent Playwright
// validation path — it reads nothing that path owns and writes nothing at all.
//
//   node scripts/lint-acceptance-criteria.mjs <project-dir>
//
// Exit 0 = every hard check passed · 1 = usage/IO error · 2 = a check failed.
//
// STORY COVERAGE is a hard gate because PRD story numbers are enumerable and
// permanent (prd-contract: "never reused or renumbered") — set membership, no
// inference. Rules are the generator's own inference, so "did it miss a rule?"
// has no ground truth here; what IS checkable is that every rule it stated
// carries a story and has scenarios.
//
// NEGATIVE COVERAGE is measured and listed, not gated per rule. It is the most
// reproduced defect in generated acceptance specs, but a rule can legitimately
// have no refusal — "the opener sees the consolidated order" refuses nothing the
// requirement states — and failing the run for that pushes the generator to
// invent refusals, which is a worse defect than the one being prevented. So the
// number is the deliverable and a reviewer judges the list. Only an all-happy-
// path set (zero negatives anywhere) hard-fails; that floor forces nothing.
//
// Tags INHERIT Feature -> Rule -> Scenario, as they do in Cucumber's own pickle
// compilation. A prohibition rule tagged @negative marks every scenario under
// it; reading raw AST tags without inheriting contradicts the language.
//
// Why a parser and not regexes: structural validity is then true by
// construction rather than by prompting, and the grammar is the one Cucumber
// actually ships.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { AstBuilder, GherkinClassicTokenMatcher, Parser } from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";

const MAX_STEPS = 5; // BRIEF: "most scenarios five lines or fewer" — a warning, not a gate.

const projectDir = process.argv[2];
if (!projectDir) {
  console.error("usage: node scripts/lint-acceptance-criteria.mjs <project-dir>");
  process.exit(1);
}

const prdPath = join(projectDir, "specs/requirements/prd.md");
const featureDir = join(projectDir, "specs/acceptance");

for (const [label, p] of [["PRD", prdPath], ["acceptance dir", featureDir]]) {
  if (!existsSync(p)) {
    console.error(`error: ${label} not found at ${p}`);
    process.exit(1);
  }
}

/** Story numbers from the PRD's `## User Stories` list — the only stable anchor. */
function readStoryNumbers(md) {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^##\s+User Stories\s*$/i.test(l));
  if (start === -1) return null;
  const numbers = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    const m = /^\s*(\d+)\.\s+\S/.exec(line);
    if (m) numbers.push(Number(m[1]));
  }
  return numbers;
}

const storyNumbers = readStoryNumbers(readFileSync(prdPath, "utf8"));
if (storyNumbers === null) {
  console.error(`error: no "## User Stories" section in ${prdPath} — is this a prd-contract PRD?`);
  process.exit(1);
}
if (storyNumbers.length === 0) {
  console.error(`error: "## User Stories" in ${prdPath} has no numbered entries`);
  process.exit(1);
}

const files = readdirSync(featureDir).filter((f) => f.endsWith(".feature")).sort();
if (files.length === 0) {
  console.error(`error: no .feature files in ${featureDir}`);
  process.exit(1);
}

const parser = new Parser(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher());
const errors = [];
const warnings = [];
const taggedStories = new Set();
const featureNames = new Map(); // name -> [file, ...]
const ruleTexts = new Map(); // rule text -> ["file:line", ...]
let ruleCount = 0;
let scenarioCount = 0;
let negativeCount = 0;

const tagNames = (node) => (node.tags ?? []).map((t) => t.name);
/** Effective tags, inherited down the Feature -> Rule -> Scenario chain. */
const inherited = (...nodes) => new Set(nodes.filter(Boolean).flatMap(tagNames));
const storyTags = (node) =>
  tagNames(node)
    .map((n) => /^@story-(\d+)$/.exec(n))
    .filter(Boolean)
    .map((m) => Number(m[1]));

for (const file of files) {
  const where = (line) => `${file}:${line}`;
  let doc;
  try {
    doc = parser.parse(readFileSync(join(featureDir, file), "utf8"));
  } catch (e) {
    const detail = String(e.message ?? e).split("\n").filter(Boolean).slice(0, 4).join("; ");
    errors.push(`${file}: does not parse — ${detail}`);
    continue;
  }
  const feature = doc.feature;
  if (!feature) {
    errors.push(`${file}: no Feature`);
    continue;
  }

  const byName = featureNames.get(feature.name) ?? [];
  byName.push(file);
  featureNames.set(feature.name, byName);

  const checkScenario = (scenario, ruleName, ancestors) => {
    scenarioCount += 1;
    const tags = inherited(...ancestors, scenario);
    const negative = tags.has("@negative");
    if (negative) negativeCount += 1;

    for (const step of scenario.steps ?? []) {
      if (/^I\b/.test(step.text)) {
        errors.push(
          `${where(step.location.line)}: step uses a bare "I" — name the actor (${step.keyword.trim()} ${step.text})`,
        );
      }
    }
    const stepCount = (scenario.steps ?? []).length;
    if (stepCount === 0) {
      errors.push(`${where(scenario.location.line)}: scenario "${scenario.name}" has no steps`);
    } else if (stepCount > MAX_STEPS) {
      warnings.push(
        `${where(scenario.location.line)}: "${scenario.name}" has ${stepCount} steps (BRIEF suggests ${MAX_STEPS}) — under rule "${ruleName}"`,
      );
    }
    return negative;
  };

  for (const child of feature.children ?? []) {
    if (child.scenario) {
      errors.push(
        `${where(child.scenario.location.line)}: scenario "${child.scenario.name}" sits directly under Feature — every scenario belongs to a Rule`,
      );
      checkScenario(child.scenario, "(none)", [feature]);
      continue;
    }
    if (!child.rule) continue;

    const rule = child.rule;
    ruleCount += 1;
    const seenAt = ruleTexts.get(rule.name) ?? [];
    seenAt.push(where(rule.location.line));
    ruleTexts.set(rule.name, seenAt);
    const stories = storyTags(rule);
    if (stories.length === 0) {
      errors.push(`${where(rule.location.line)}: rule "${rule.name}" carries no @story-N tag`);
    }
    for (const n of stories) {
      taggedStories.add(n);
      if (!storyNumbers.includes(n)) {
        errors.push(`${where(rule.location.line)}: rule "${rule.name}" tags @story-${n}, which the PRD does not define`);
      }
    }

    const scenarios = (rule.children ?? []).filter((c) => c.scenario).map((c) => c.scenario);
    if (scenarios.length === 0) {
      errors.push(`${where(rule.location.line)}: rule "${rule.name}" has no scenarios`);
      continue;
    }
    const negatives = scenarios.map((s) => checkScenario(s, rule.name, [feature, rule])).filter(Boolean).length;
    if (negatives === 0) {
      warnings.push(
        `${where(rule.location.line)}: rule "${rule.name}" has no @negative scenario — does it refuse nothing, or was the refusal missed?`,
      );
    }
  }
}

for (const [name, where] of featureNames) {
  if (where.length > 1) {
    errors.push(`Feature "${name}" appears in ${where.length} files (${where.join(", ")}) — a renamed capability left the old file behind?`);
  }
}
for (const [text, at] of ruleTexts) {
  if (at.length > 1) {
    errors.push(`rule "${text}" is stated ${at.length} times (${at.join(", ")}) — a rule belongs in exactly one place`);
  }
}

if (scenarioCount > 0 && negativeCount === 0) {
  errors.push("no @negative scenario anywhere — the whole specification is happy paths");
}

const uncovered = storyNumbers.filter((n) => !taggedStories.has(n));
const coveredCount = storyNumbers.length - uncovered.length;
for (const n of uncovered) {
  errors.push(`story ${n} is defined in the PRD but no rule claims it`);
}

const pct = (n, d) => (d === 0 ? "0" : ((n / d) * 100).toFixed(0));

console.log(`acceptance criteria — ${basename(projectDir)}`);
console.log(`  files      ${files.length} (${files.join(", ")})`);
console.log(`  rules      ${ruleCount}`);
console.log(`  scenarios  ${scenarioCount}, ${negativeCount} negative (${pct(negativeCount, scenarioCount)}%)`);
console.log(
  `  stories    ${coveredCount}/${storyNumbers.length} covered (${pct(coveredCount, storyNumbers.length)}%)`,
);

if (warnings.length) {
  console.log(`\nwarnings (${warnings.length}):`);
  for (const w of warnings) console.log(`  ~ ${w}`);
}
if (errors.length) {
  console.log(`\nfailed (${errors.length}):`);
  for (const e of errors) console.log(`  x ${e}`);
  process.exit(2);
}
console.log("\nok — every hard check passed");
