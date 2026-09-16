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

import { Ban, Check, CircleHelp, X } from "@wso2/oxygen-ui-icons-react";
import type { ComponentType } from "react";
import { OUTCOMES, type ReportScenario } from "./report.js";

/**
 * The outcome vocabulary.
 *
 * THE LABEL IS THE REPORT'S OWN WORD, title-cased — there is no translation
 * table, and so no fifth vocabulary to keep in step with `report.go`,
 * `check-report.mjs`, the skill and ADR-0029. It also means an outcome word the
 * console has never heard of renders verbatim and neutral instead of falling
 * through to a wrong label.
 *
 * Tone and mark DO need a table, and at four outcomes they need one more than
 * they did at two. ADR-0016 gave `Passed` and `Failed` marks because as
 * outlined chips they otherwise differ by hue alone, which is nothing to a
 * red/green colour-blind reader; adding `Blocked` and `Unjudgeable` creates two
 * more such pairs, so every outcome carries its own glyph.
 */

export type OutcomeTone = "success" | "error" | "warning" | "default";

/**
 * `blocked` is amber alone. ADR-0029 files no repair issue for it, precisely
 * because only a person can tell a product that correctly refuses an action
 * from one too broken to perform it — so it is the one row on the page that
 * carries a call to action. `unjudgeable` is neutral: an honest answer about
 * truth that lives outside the running app, not a defect.
 */
export const OUTCOME_TONE: Readonly<Record<string, OutcomeTone>> = {
  passed: "success",
  failed: "error",
  blocked: "warning",
  unjudgeable: "default",
};

export const OUTCOME_ICON: Readonly<Record<string, ComponentType<{ size?: number }>>> = {
  passed: Check,
  failed: X,
  blocked: Ban,
  unjudgeable: CircleHelp,
};

/**
 * What a run says about a scenario it never covered.
 *
 * The console's own word, because the scenario is absent from the report and
 * the report therefore has none for it — the features are read at the branch
 * tip and the report at the merge commit of the attempt that wrote it, so a
 * scenario authored since has no entry. That is the ordinary authoring loop, so
 * the chip is neutral rather than a warning: colouring the expected state
 * teaches a reader to discount the colour.
 */
export const NO_RESULT_LABEL = "No result";
export const NO_RESULT_NOTE = "This scenario was written after the last validation run.";

export function outcomeLabel(outcome: string): string {
  if (outcome === "") return NO_RESULT_LABEL;
  return outcome.charAt(0).toUpperCase() + outcome.slice(1);
}

export function outcomeTone(outcome: string): OutcomeTone {
  return OUTCOME_TONE[outcome] ?? "default";
}

export interface OutcomeTally {
  readonly total: number;
  readonly passed: number;
  /** Everything that is not `passed`, including outcome words we do not know. */
  readonly unresolved: number;
  /** In report order, so the summary reads the way the vocabulary is written. */
  readonly counts: readonly { readonly outcome: string; readonly count: number }[];
}

export function tallyOutcomes(scenarios: readonly ReportScenario[]): OutcomeTally {
  const seen = new Map<string, number>();
  for (const s of scenarios) seen.set(s.outcome, (seen.get(s.outcome) ?? 0) + 1);

  const known = OUTCOMES.filter((o) => seen.has(o)).map((o) => ({
    outcome: o as string,
    count: seen.get(o) as number,
  }));
  const unknown = [...seen.keys()]
    .filter((o) => !(OUTCOMES as readonly string[]).includes(o))
    .sort()
    .map((o) => ({ outcome: o, count: seen.get(o) as number }));

  const passed = seen.get("passed") ?? 0;
  return {
    total: scenarios.length,
    passed,
    unresolved: scenarios.length - passed,
    counts: [...known, ...unknown],
  };
}

/** `7 of 9 passed · 2 blocked`, or `9 passed` when nothing else happened. */
export function tallySentence(tally: OutcomeTally): string {
  if (tally.total === 0) return "";
  const rest = tally.counts
    .filter((c) => c.outcome !== "passed")
    .map((c) => `${c.count} ${c.outcome}`);
  const head =
    rest.length === 0 ? `${tally.passed} passed` : `${tally.passed} of ${tally.total} passed`;
  return [head, ...rest].join(" · ");
}
