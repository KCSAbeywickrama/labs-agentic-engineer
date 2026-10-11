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
 * Deterministic per-section checks (#355), binding the LIVE workspace
 * validators — `checkComponentDesign`, the design.cell compiler, the issue fold —
 * never vendored copies. A validator tightening is an explainable score-shift
 * event, not drift.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { checkComponentDependencies, checkComponentDesign, checkDesignDiagram, DOMAIN_MODEL_PATH } from "@aep/agent-stream";
import { listComponents, listFlows } from "@aep/playground/src/engine/gates.js";
import { featureScenarios, parseFeatureFile } from "@aep/ui-acceptance-view/parse";
import { compileProject } from "@aep/ui-cell-diagram-react/compiler";
import type { SectionRunResult } from "../drivers/conversational.js";
import { listRequirementFiles, readRequirementTexts } from "../project.js";
import type { TaskPlanRunResult } from "../drivers/task-plan.js";
import { closingProblem, decisionsProblems, gapCheckProblems, lineupOrderProblem } from "./design-lineup.js";
import { prototypeProblems, webApplications } from "./prototype-check.js";

export interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface StructuralReport {
  /** Fraction of checks passed, 0..1. */
  score: number;
  checks: CheckResult[];
}

export function report(checks: CheckResult[]): StructuralReport {
  const passed = checks.filter((c) => c.ok).length;
  return { score: checks.length ? passed / checks.length : 0, checks };
}

export const check = (name: string, ok: boolean, detail?: string): CheckResult => ({
  name,
  ok,
  ...(detail && !ok ? { detail } : {}),
});

export function requirementsChecks(projectDir: string, run: SectionRunResult): StructuralReport {
  const md = readSafe(join(projectDir, "specs/requirements/prd.md"));
  const headings = (md.match(/^#{1,3} /gm) ?? []).length;
  const files = listRequirementFiles(projectDir);
  const features = files.filter((f) => /^specs\/requirements\/features\/F\d+-[^/]+\.md$/.test(f));
  const size = files.reduce((n, f) => n + readSafe(join(projectDir, f)).length, 0);
  return report([
    check("prd.md exists", md.trim().length > 0, "specs/requirements/prd.md missing or empty"),
    check("features written (≥1 features/F<n>-<slug>.md)", features.length > 0, "no feature file under specs/requirements/features/"),
    check("substantial (≥800 chars across the files)", size >= 800, `${size} chars`),
    check("structured (≥3 headings in prd.md)", headings >= 3, `${headings} headings`),
    check("interview happened", run.questionsAsked > 0, "the agent never asked a question"),
    check("interview finished within cap", run.finishedInterview, run.error ?? "hit the turn cap"),
  ]);
}

/**
 * The acceptance oracle, read with the SAME parser the console renders it with
 * and the run's checker keys on — `parseFeatureFile` returns null for text
 * carrying no `Feature:` line, which is exactly the file a run cannot answer.
 * A design that minted no oracle, or minted one with no scenarios in it, has
 * nothing to validate against and settles `skipped`.
 *
 * Stricter than the platform's gate and the run's checker, which both count a
 * bare `Scenario:` heading because neither judges the text. An oracle of bare
 * headings drives nothing and reports green, so the bar is local; identity
 * still comes from the shared parser.
 */
function acceptanceProblems(projectDir: string): string[] {
  const dir = join(projectDir, "specs/validation/acceptance");
  if (!existsSync(dir)) return ["specs/validation/acceptance/ missing"];
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".feature"))
    .map((e) => e.name)
    .sort();
  if (names.length === 0) return ["no .feature files under specs/validation/acceptance/"];
  const problems: string[] = [];
  for (const name of names) {
    const feature = parseFeatureFile(name, readFileSync(join(dir, name), "utf8"));
    if (!feature) {
      problems.push(`${name}: no Feature: line`);
      continue;
    }
    const scenarios = featureScenarios(feature);
    if (scenarios.length === 0) {
      problems.push(`${name}: no scenarios`);
      continue;
    }
    const empty = scenarios.filter(({ scenario }) => scenario.steps.length === 0);
    if (empty.length === scenarios.length) {
      problems.push(`${name}: every scenario is a bare heading with no steps`);
    } else if (empty.length > 0) {
      problems.push(
        `${name}: ${empty.length} scenario(s) with no steps — ${empty
          .map(({ scenario }) => scenario.name || `line ${scenario.line}`)
          .join(", ")}`,
      );
    }
    const unnamed = scenarios.filter(({ scenario }) => scenario.name.trim() === "");
    if (unnamed.length > 0) {
      problems.push(
        `${name}: ${unnamed.length} unnamed scenario(s) — ${unnamed
          .map(({ scenario }) => `line ${scenario.line}`)
          .join(", ")}`,
      );
    }
  }
  return problems;
}

/**
 * `requirementsBefore` is the requirements as the run found them
 * (`readRequirementTexts`): the gap check is judged by what the run changed.
 * Without it there is nothing to compare, and that check passes.
 */
export async function designChecks(
  projectDir: string,
  run: SectionRunResult,
  requirementsBefore?: Record<string, string>,
): Promise<StructuralReport> {
  const reader = {
    read: (p: string) => (existsSync(join(projectDir, p)) ? readFileSync(join(projectDir, p), "utf8") : undefined),
  };
  const domainModel = readSafe(join(projectDir, "specs/design/domain-model.md"));
  const flowFiles = listFlows(projectDir);
  // The same judge the write gate runs (ADR-0020's per-file contract): one
  // diagram of the right kind, in the prescribed subset, participants
  // resolving against the cell and the PRD on disk.
  const domainModelProblem = domainModel.trim() ? checkDesignDiagram(DOMAIN_MODEL_PATH, domainModel, reader) : null;
  const flowProblems = flowFiles
    .map((f) => checkDesignDiagram(`specs/design/flows/${f}`, readSafe(join(projectDir, "specs/design/flows", f)), reader))
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map((p) => p.message);
  const components = listComponents(projectDir);

  const designJsonProblems: string[] = [];
  const dependencyProblems: string[] = [];
  const openapiProblems: string[] = [];
  for (const name of components) {
    const rel = `specs/design/components/${name}/design.json`;
    const abs = join(projectDir, rel);
    if (existsSync(abs)) {
      const problem = checkComponentDesign(rel, readFileSync(abs, "utf8"));
      if (problem !== null) designJsonProblems.push(`${rel}: ${problem.message}`);
      // The cell is the source of truth: every dependency is one of its nodes
      // (the same judge the write gate runs).
      const depProblem = checkComponentDependencies(rel, readFileSync(abs, "utf8"), reader);
      if (depProblem !== null) dependencyProblems.push(depProblem.message);
    } else {
      designJsonProblems.push(`${rel}: missing`);
    }
    const openapiAbs = join(projectDir, `specs/design/components/${name}/openapi.yaml`);
    if (existsSync(openapiAbs)) {
      try {
        const doc = parseYaml(readFileSync(openapiAbs, "utf8")) as Record<string, unknown> | null;
        if (!doc || !("openapi" in doc) || !("paths" in doc)) openapiProblems.push(`${name}: not an OpenAPI document`);
      } catch (e) {
        openapiProblems.push(`${name}: ${String(e)}`);
      }
    }
  }

  // The cell is compiled by the same compiler the console renders it with —
  // the design root either parses cleanly or the check names the line.
  const cellSource = readSafe(join(projectDir, "specs/design/design.cell"));
  const cellCompile = cellSource.trim() ? compileProject(cellSource) : null;
  const cellErrors = (cellCompile?.diagnostics ?? []).filter((d) => d.severity === "error");

  const oracleProblems = acceptanceProblems(projectDir);
  const webApps = webApplications(projectDir, components);
  const prototypes = await prototypeProblems(projectDir, webApps);
  const decisions = decisionsProblems(readSafe(join(projectDir, "specs/design/decisions.md")), components);
  const gaps = requirementsBefore ? gapCheckProblems(requirementsBefore, readRequirementTexts(projectDir)) : [];
  const order = lineupOrderProblem(run.records);
  const closing = closingProblem(run.records);

  return report([
    check("domain-model.md exists", domainModel.trim().length > 0, "specs/design/domain-model.md missing or empty"),
    // Flows are written only when one is worth it (skills/design, "Flows"): none is not a fault; a bad one is.
    check("domain model is one valid erDiagram", domainModelProblem === null, domainModelProblem?.message),
    check("every flow is one valid sequenceDiagram whose participants resolve", flowProblems.length === 0, flowProblems.join(" | ")),
    check("≥1 component designed", components.length > 0, "no dirs under specs/design/components/"),
    check("every design.json valid", components.length > 0 && designJsonProblems.length === 0, designJsonProblems.join("; ")),
    check("every dependency is a node the cell declares", dependencyProblems.length === 0, dependencyProblems.join(" | ")),
    check(
      "design.cell compiles",
      cellCompile !== null && cellErrors.length === 0,
      cellCompile === null ? "specs/design/design.cell missing or empty" : cellErrors.map((d) => `line ${d.line}: ${d.message}`).join("; "),
    ),
    check("openapi.yaml documents valid", openapiProblems.length === 0, openapiProblems.join("; ")),
    check("≥1 acceptance .feature, each with named scenarios that have steps", oracleProblems.length === 0, oracleProblems.join("; ")),
    check(
      "every web application has a prototype that passes the kit check",
      prototypes.length === 0,
      prototypes.join("; "),
    ),
    check("decisions.md: one tagged line per decision, naming its features", decisions.length === 0, decisions.join("; ")),
    check("gap check only adds *assumed* lines and open questions to the requirements", gaps.length === 0, gaps.slice(0, 5).join("; ")),
    check("artifacts written in lineup order (acceptance tests last)", order === null, order ?? undefined),
    check(
      "no form question asked during design",
      run.questionsAsked === 0,
      `${run.questionsAsked} question(s) asked: ${run.records.flatMap((r) => r.questions).slice(0, 3).join(" | ")}`,
    ),
    check("the closing names the next step on the Design card", closing === null, closing ?? undefined),
    check("section completed", run.finishedInterview, run.error ?? "hit the turn cap"),
  ]);
}

export function tasksChecks(projectDir: string, run: TaskPlanRunResult): StructuralReport {
  const items = run.plan?.items ?? [];
  const components = listComponents(projectDir);
  const named = new Set(items.flatMap((i) => i.components));
  const uncovered = components.filter((c) => !named.has(c));
  const foundation = items.findIndex((i) => i.item === "foundation");

  return report([
    check("plan produced a build issue", run.issues.some((i) => i.version !== undefined), run.error ?? "no build issue written (the Plan turn did not complete?)"),
    check("every component named by an item", components.length > 0 && uncovered.length === 0, uncovered.length ? `unnamed: ${uncovered.join(", ")}` : "no components"),
    check("foundation, when present, comes first", foundation <= 0, `foundation is item ${foundation + 1}`),
    check("turn completed", !run.error, run.error),
  ]);
}

function readSafe(abs: string): string {
  return existsSync(abs) ? readFileSync(abs, "utf8") : "";
}
