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
 * BuildPlan — the plan-turn accumulator (the FileBundle analogue). Constructed
 * per turn from the read-only snapshot and the version's plan scope: it knows
 * the components (`specs/design/components/<name>/`) and the items the version
 * carries (Foundation, then each carried feature), and validates each
 * `planBuild` against them.
 *
 * Like the file tools, validation runs SERVER-SIDE inside the agent loop, so a
 * refusal returns a self-correction payload the model acts on in the same turn.
 * The service never touches GitHub: a successful op records the checklist and
 * echoes it normalized; the BFF plan tap writes the build issue from the last
 * one when the turn completes.
 *
 * Pure, no I/O, fully testable.
 */

import {
  FOUNDATION_ITEM,
  WHOLE_SPEC_ITEM,
  parseKnownComponents,
  type BuildPlanInput,
  type BuildPlanItem,
  type BuildPlanResult,
  type PlanScope,
  type TaskToolErr,
  type TaskToolErrCode,
} from "@aep/agent-stream";

export class BuildPlan {
  private readonly known: Set<string>;
  /** The carried features in an order that builds: each after the carried features it needs. */
  private readonly features: string[];
  private readonly needs: Map<string, string[]>;
  private current: BuildPlanItem[] | undefined;

  constructor(files: Record<string, string>, scope?: PlanScope) {
    this.known = new Set(parseKnownComponents(files));
    this.needs = new Map((scope?.features ?? []).map((f) => [f.id, f.needs ?? []]));
    this.features = buildOrder((scope?.features ?? []).map((f) => f.id), this.needs);
  }

  // -- Reads (for the eval fold + tests) ----------------------------------

  knownComponents(): string[] {
    return [...this.known].sort();
  }

  /** The items a plan may name, in an order that builds; Foundation is optional. */
  carriedItems(): string[] {
    return this.features.length === 0 ? [WHOLE_SPEC_ITEM] : [FOUNDATION_ITEM, ...this.features];
  }

  /** The last accepted checklist, if any. */
  plan(): readonly BuildPlanItem[] | undefined {
    return this.current;
  }

  // -- The op ---------------------------------------------------------------

  planBuild(input: BuildPlanInput): BuildPlanResult {
    const items = input.items.map((it) => ({
      item: it.item,
      components: [...new Set(it.components.map((c) => c.trim()))],
      note: it.note.trim(),
    }));

    for (const it of items) {
      const unknown = it.components.filter((c) => !this.known.has(c));
      if (unknown.length > 0) {
        return this.refuse("UNKNOWN_COMPONENT", `${it.item} names unknown component(s): ${unknown.join(", ")}.`, {
          knownComponents: this.knownComponents(),
        });
      }
    }
    const names = items.map((it) => it.item);
    const twice = names.find((n, i) => names.indexOf(n) !== i);
    if (twice !== undefined) return this.refuse("DUPLICATE_ITEM", `${twice} is listed twice.`);

    const carried = new Set(this.carriedItems());
    const foreign = names.filter((n) => !carried.has(n));
    if (foreign.length > 0) {
      return this.refuse("UNKNOWN_ITEM", `this version does not carry ${foreign.join(", ")}.`);
    }
    const missing = this.carriedItems().filter((n) => n !== FOUNDATION_ITEM && !names.includes(n));
    if (missing.length > 0) {
      return this.refuse("MISSING_ITEM", `the version carries ${missing.join(", ")}, which the plan leaves out.`);
    }
    if (names.includes(FOUNDATION_ITEM) && names[0] !== FOUNDATION_ITEM) {
      return this.refuse("ITEM_ORDER", "foundation comes first: every feature builds on it.");
    }
    for (const [i, name] of names.entries()) {
      const late = (this.needs.get(name) ?? []).filter((need) => names.indexOf(need) > i);
      if (late.length > 0) {
        return this.refuse("ITEM_ORDER", `${name} needs ${late.join(", ")}, so it comes after ${late.length === 1 ? "it" : "them"}.`);
      }
    }

    this.current = items;
    return { ok: true, op: "build", items };
  }

  private refuse(code: TaskToolErrCode, message: string, extra: Pick<TaskToolErr, "knownComponents"> = {}): TaskToolErr {
    const order = this.carriedItems().join(", ");
    return {
      ok: false,
      op: "build",
      code,
      message: `${message} The version carries, in an order that builds: ${order}${this.features.length > 0 ? " (foundation is optional)" : ""}.`,
      carriedItems: this.carriedItems(),
      ...extra,
    };
  }
}

/** The features in ID order, each moved after the carried features it needs. */
function buildOrder(ids: string[], needs: Map<string, string[]>): string[] {
  const out: string[] = [];
  const visit = (id: string, path: Set<string>): void => {
    if (out.includes(id) || path.has(id)) return;
    path.add(id);
    for (const need of needs.get(id) ?? []) if (ids.includes(need)) visit(need, path);
    path.delete(id);
    out.push(id);
  };
  for (const id of ids) visit(id, new Set());
  return out;
}
