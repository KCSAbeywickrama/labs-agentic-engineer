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
 * validators — `checkComponentDesign`, the DSL compilers, the issue fold —
 * never vendored copies. A validator tightening is an explainable score-shift
 * event, not drift.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { checkComponentDesign } from "@aep/agent-stream";
import { listComponents } from "@aep/playground/src/engine/gates.js";
import { compileDslDerived } from "@aep/playground/src/kit/derived.js";
import type { SectionRunResult } from "../drivers/conversational.js";
import type { TaskPlanRunResult } from "../drivers/task-plan.js";

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

function report(checks: CheckResult[]): StructuralReport {
  const passed = checks.filter((c) => c.ok).length;
  return { score: checks.length ? passed / checks.length : 0, checks };
}

const check = (name: string, ok: boolean, detail?: string): CheckResult => ({
  name,
  ok,
  ...(detail && !ok ? { detail } : {}),
});

export function requirementsChecks(projectDir: string, run: SectionRunResult): StructuralReport {
  const md = readSafe(join(projectDir, "specs/requirements/prd.md"));
  const headings = (md.match(/^#{1,3} /gm) ?? []).length;
  return report([
    check("prd.md exists", md.trim().length > 0, "specs/requirements/prd.md missing or empty"),
    check("substantial (≥800 chars)", md.length >= 800, `${md.length} chars`),
    check("structured (≥3 headings)", headings >= 3, `${headings} headings`),
    check("interview happened", run.questionsAsked > 0, "the agent never asked a question"),
    check("interview finished within cap", run.finishedInterview, run.error ?? "hit the turn cap"),
  ]);
}

export function designChecks(projectDir: string, run: SectionRunResult): StructuralReport {
  const designMd = readSafe(join(projectDir, "specs/design/design.md"));
  const components = listComponents(projectDir);

  const designJsonProblems: string[] = [];
  const openapiProblems: string[] = [];
  for (const name of components) {
    const rel = `specs/design/components/${name}/design.json`;
    const abs = join(projectDir, rel);
    if (existsSync(abs)) {
      const problem = checkComponentDesign(rel, readFileSync(abs, "utf8"));
      if (problem !== null) designJsonProblems.push(`${rel}: ${problem.message}`);
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

  const cellPath = "specs/design/design.cell";
  const cellNote = existsSync(join(projectDir, cellPath)) ? compileDslDerived(projectDir, cellPath) : null;

  const criteria = readSafe(join(projectDir, "specs/validation/validation-criteria.json"));
  let criteriaOk = false;
  try {
    criteriaOk = criteria.trim().length > 0 && JSON.parse(criteria) !== null;
  } catch {
    criteriaOk = false;
  }

  return report([
    check("design.md exists", designMd.trim().length > 0, "specs/design/design.md missing or empty"),
    check("≥1 component designed", components.length > 0, "no dirs under specs/design/components/"),
    check("every design.json valid", components.length > 0 && designJsonProblems.length === 0, designJsonProblems.join("; ")),
    check("design.cell compiles", cellNote !== null && cellNote.ok, cellNote?.message ?? "specs/design/design.cell missing"),
    check("openapi.yaml documents valid", openapiProblems.length === 0, openapiProblems.join("; ")),
    check("validation-criteria.json valid", criteriaOk, "missing or not JSON"),
    check("section completed", run.finishedInterview, run.error ?? "hit the turn cap"),
  ]);
}

export function tasksChecks(projectDir: string, run: TaskPlanRunResult): StructuralReport {
  const issues = run.issues;
  const components = listComponents(projectDir);
  const known = new Set(components);

  const coveredComponents = new Set(issues.map((i) => i.component));
  const uncovered = components.filter((c) => !coveredComponents.has(c));

  const badRefs: string[] = [];
  for (const i of issues) {
    for (const dep of i.dependsOn) {
      if (!known.has(dep)) badRefs.push(`#${i.issueNumber} → ${dep}`);
    }
  }

  return report([
    check("plan produced issues", (run.fold?.created.length ?? 0) + (run.fold?.updated.length ?? 0) > 0, run.error ?? "fold wrote nothing (no terminal manifest?)"),
    check("every component covered", components.length > 0 && uncovered.length === 0, uncovered.length ? `uncovered: ${uncovered.join(", ")}` : "no components"),
    check("dependsOn refs resolve", badRefs.length === 0, badRefs.join("; ")),
    check("dependsOn acyclic", isAcyclic(issues), "cycle in the component dependency graph"),
    check("turn completed", !run.error, run.error),
  ]);
}

/** Cycle check over the component-level build-order graph the issues express. */
export function isAcyclic(issues: Array<{ component: string; dependsOn: string[] }>): boolean {
  const edges = new Map<string, Set<string>>();
  for (const i of issues) {
    const set = edges.get(i.component) ?? new Set<string>();
    for (const d of i.dependsOn) if (d !== i.component) set.add(d);
    edges.set(i.component, set);
  }
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (n: string): boolean => {
    if (done.has(n)) return true;
    if (visiting.has(n)) return false;
    visiting.add(n);
    for (const d of edges.get(n) ?? []) if (!visit(d)) return false;
    visiting.delete(n);
    done.add(n);
    return true;
  };
  return [...edges.keys()].every(visit);
}

function readSafe(abs: string): string {
  return existsSync(abs) ? readFileSync(abs, "utf8") : "";
}
