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
 * The per-status tally over an oracle joined with a run report — the numbers
 * behind "35 passed · 5 manual".
 *
 * A pure derivation kept out of the view because the tally is now rendered by
 * the CONSUMER (the console's verdict tile) rather than inside ValidationView:
 * the verdict is what a reader wants first, and one tally above the criteria
 * beats the same tally twice on one page.
 */

import type { ValidationCriteria } from "./parse.js";
import type { ValidationReport } from "./report.js";

/**
 * report.json status → its human label. The single source for these five words:
 * ValidationView's per-criterion chips read their label from here too, so the
 * tally line and the chip beside a criterion can never disagree.
 */
export const CRITERION_STATE_LABEL: Record<string, string> = {
  pass: "Passed",
  fail: "Failed",
  not_run: "Not run",
  not_validated: "Not validated",
  manual: "Manual",
};

/** Display order for the tally — a failure reads first. */
const STATE_ORDER = ["fail", "pass", "not_run", "not_validated", "manual"];

/** The statuses that mean "this criterion was never actually checked". */
const UNCOVERED = ["not_run", "not_validated", "manual"];

export interface CriterionStateCount {
  /** Raw report status; one of CriterionRunState in practice. */
  status: string;
  count: number;
}

export interface CriterionTally {
  /** Criteria the ORACLE authored — the honest denominator. */
  total: number;
  /** Per-status counts in display order; empty when no report is joined in. */
  states: CriterionStateCount[];
}

/** How many of the tallied criteria carry `status`. */
export function countOf(tally: CriterionTally, status: string): number {
  return tally.states.find((s) => s.status === status)?.count ?? 0;
}

/** How many criteria were authored but never actually checked. */
export function uncoveredCount(tally: CriterionTally): number {
  return UNCOVERED.reduce((n, s) => n + countOf(tally, s), 0);
}

/**
 * Tally the oracle's criteria by the run status the report gives each one.
 *
 * `total` counts what was AUTHORED and the states count what RAN, which is the
 * gap that makes a partial verdict legible: 40 authored, 35 with a pass, 5 never
 * covered. Counting the report's own rows instead would make that gap invisible,
 * and a criterion the report omits — which report.ts explicitly tolerates —
 * would silently leave the denominator.
 */
export function tallyCriterionStates(
  criteria: ValidationCriteria,
  report: ValidationReport | undefined,
): CriterionTally {
  const counts = new Map<string, number>();
  let total = 0;
  for (const requirement of criteria.requirements) {
    for (const criterion of requirement.criteria) {
      total += 1;
      const status = report?.get(criterion.id)?.status;
      if (status) counts.set(status, (counts.get(status) ?? 0) + 1);
    }
  }
  // Known statuses in their fixed order, then anything unrecognised so a status
  // we have never seen still shows up rather than vanishing from the tally.
  const ordered = [
    ...STATE_ORDER.filter((s) => counts.has(s)),
    ...[...counts.keys()].filter((s) => !STATE_ORDER.includes(s)).sort(),
  ];
  return {
    total,
    states: ordered.map((status) => ({
      status,
      count: counts.get(status) ?? 0,
    })),
  };
}
