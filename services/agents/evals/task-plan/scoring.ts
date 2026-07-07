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
 * Pure scorers for a plan turn. Unlike the file suite (which folds the stream
 * into files), a plan turn produces domain tool calls, so scoring reads the
 * `planTask`/`updateTask`/`loadSkill` frames directly: skill pickup, per-component
 * planning, dependency validity, body writes, and the absence of re-planning for
 * unchanged components. Reuses `CheckResult`/`allPass` from the file scorer.
 */

import type { StreamPart } from "@aep/agent-stream";
import { PLAN_TASK, UPDATE_TASK } from "@aep/agent-stream";
import type { CheckResult } from "../scoring.js";

export interface TaskPlanExpect {
  /** Each named skill must have been loaded via `loadSkill(names)` (pickup assertion). */
  loadedSkills?: string[];
  /** Each component must have a SUCCESSFUL `planTask`. */
  plannedComponents?: string[];
  /** No component here may be planned (unchanged, already-covered work). */
  noPlanForComponents?: string[];
  /** Each component must be planned EXACTLY once (no duplicate delta with a distinct title). */
  singlePlanFor?: string[];
  /** At least this many successful `planTask`s. */
  minPlanned?: number;
  /** At least one successful `planTask` carries a non-empty `dependsOn`. */
  someDependsOn?: boolean;
  /** Every planned Task got a body written to IT (a body-write referencing its title). */
  bodyForEveryPlan?: boolean;
  /** Every `planTask`/`updateTask` result is `ok:true`. */
  noToolErrors?: boolean;
}

/** The plan-turn shape a scorer reads, distilled from the raw stream. */
export interface PlanTrace {
  /** skill names passed to `loadSkill`. */
  loadedSkills: string[];
  /** components with a SUCCESSFUL planTask (with duplicates, so per-component counts work). */
  plannedComponents: string[];
  /** did any successful planTask carry a non-empty dependsOn? */
  anyDependsOn: boolean;
  /** count of successful planTasks. */
  planCount: number;
  /** planned Tasks that received NO body-write referencing their (possibly renamed) title. */
  plansMissingBody: number;
  /** any planTask/updateTask result with ok:false. */
  toolErrors: number;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/** Same normalization the accumulator uses to resolve a `{title}` ref. */
const normTitle = (t: string): string => t.trim().toLowerCase();

/** Distill the raw StreamParts of one turn into a `PlanTrace`. */
export function traceOfTurn(parts: StreamPart[]): PlanTrace {
  // Pair tool-calls with their results by id (a result carries ok:true/false).
  const results = new Map<string, { ok: boolean }>();
  for (const p of parts) {
    if (p.type === "tool-result" && p.toolCallId) {
      const out = asRecord(p.output);
      results.set(p.toolCallId, { ok: out.ok === true });
    }
  }
  const okResult = (id?: string): boolean => (id ? (results.get(id)?.ok ?? false) : false);

  const trace: PlanTrace = {
    loadedSkills: [],
    plannedComponents: [],
    anyDependsOn: false,
    planCount: 0,
    plansMissingBody: 0,
    toolErrors: 0,
  };

  // Track each planned Task by its CURRENT title (following in-turn renames) so a
  // body-write is credited to the specific plan it references — NOT to an existing
  // Task updated by issueNumber, which must not satisfy a planned Task's body quota.
  const planned: { titleNorm: string; hasBody: boolean }[] = [];

  for (const p of parts) {
    if (p.type !== "tool-call") continue;
    const input = asRecord(p.input);
    if (p.toolName === "loadSkill" && Array.isArray(input.names)) {
      trace.loadedSkills.push(...input.names.filter((n): n is string => typeof n === "string"));
    } else if (p.toolName === PLAN_TASK) {
      if (!okResult(p.toolCallId)) {
        trace.toolErrors++;
        continue;
      }
      trace.planCount++;
      if (typeof input.component === "string") trace.plannedComponents.push(input.component);
      if (Array.isArray(input.dependsOn) && input.dependsOn.length > 0) trace.anyDependsOn = true;
      if (typeof input.title === "string") planned.push({ titleNorm: normTitle(input.title), hasBody: false });
    } else if (p.toolName === UPDATE_TASK) {
      if (!okResult(p.toolCallId)) {
        trace.toolErrors++;
        continue;
      }
      const ref = asRecord(input.ref);
      const set = asRecord(input.set);
      // Only a { title } ref targets a this-turn planned Task; { issueNumber } is an existing one.
      if (typeof ref.title === "string") {
        const pt = planned.find((x) => x.titleNorm === normTitle(ref.title as string));
        if (pt) {
          if (typeof set.body === "string" && set.body.trim() !== "") pt.hasBody = true;
          if (typeof set.title === "string") pt.titleNorm = normTitle(set.title); // follow the rename
        }
      }
    }
  }
  trace.plansMissingBody = planned.filter((p) => !p.hasBody).length;
  return trace;
}

function mk(clause: string, pass: boolean, detail?: string): CheckResult {
  return detail === undefined ? { clause, pass } : { clause, pass, detail };
}

/** One `CheckResult` per asserted clause (clauses left out of `expect` are not checked). */
export function scoreTaskPlan(expect: TaskPlanExpect, trace: PlanTrace): CheckResult[] {
  const checks: CheckResult[] = [];

  for (const name of expect.loadedSkills ?? []) {
    checks.push(mk(`loadedSkill ${name}`, trace.loadedSkills.includes(name)));
  }
  for (const c of expect.plannedComponents ?? []) {
    checks.push(mk(`plannedComponent ${c}`, trace.plannedComponents.includes(c)));
  }
  for (const c of expect.noPlanForComponents ?? []) {
    checks.push(mk(`noPlanFor ${c}`, !trace.plannedComponents.includes(c), trace.plannedComponents.includes(c) ? "was planned" : undefined));
  }
  for (const c of expect.singlePlanFor ?? []) {
    const n = trace.plannedComponents.filter((x) => x === c).length;
    checks.push(mk(`singlePlanFor ${c}`, n === 1, `planned ${n}×`));
  }
  if (expect.minPlanned !== undefined) {
    checks.push(mk(`minPlanned >= ${expect.minPlanned}`, trace.planCount >= expect.minPlanned, `planned=${trace.planCount}`));
  }
  if (expect.someDependsOn === true) {
    checks.push(mk("someDependsOn", trace.anyDependsOn));
  }
  if (expect.bodyForEveryPlan === true) {
    checks.push(mk("bodyForEveryPlan", trace.plansMissingBody === 0, trace.plansMissingBody ? `${trace.plansMissingBody} plan(s) without a body` : undefined));
  }
  if (expect.noToolErrors === true) {
    checks.push(mk("noToolErrors", trace.toolErrors === 0, trace.toolErrors ? `${trace.toolErrors} failed op(s)` : undefined));
  }

  return checks;
}
