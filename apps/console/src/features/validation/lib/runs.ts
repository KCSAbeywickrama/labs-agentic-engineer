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

// Which run in a version's story answers for validation, and which cycle holds the
// report. Both surfaces that render a verdict ask these questions, and asking them
// differently is a bug each has had: the Validation page took the newest run until
// #423, and the deployments hook still did after that was fixed.

import type { components } from "../../../generated/aep-api";

type MilestoneRunView = components["schemas"]["MilestoneRunView"];
type RunCycleView = components["schemas"]["RunCycleView"];

/**
 * The run origins that ask a version's validation criteria — the console's mirror of
 * delivery.RunValidates. A spec build validates the version it delivered, and a
 * revalidation exists to ask again; an incident adoption is absent on purpose,
 * because it fixes one thing in an already-judged version.
 */
export const VALIDATING_ORIGINS: readonly string[] = ["spec-build", "revalidate"];

/**
 * The run whose verdict is the version's answer, from a newest-first list.
 *
 * NOT the newest run. A milestone sees sequential runs across its life and only some
 * of them validate: an incident adoption never does, and `settle` stamps `skipped` on
 * any succeeded run that never did — so the newest run is routinely one whose verdict
 * means "I was never asked". Reading it made a single adopted issue report a
 * genuinely passed version as unvalidated (#423).
 */
export function validatingRun(
  runs: readonly MilestoneRunView[],
): MilestoneRunView | undefined {
  return runs.find((r) => VALIDATING_ORIGINS.includes(r.origin));
}

/**
 * The last validation cycle that MERGED, across every run that attempted one, oldest
 * to newest — the cycle whose merge commit the report should be read at.
 *
 * Merged rather than simply last: a repeat attempt in flight has no report yet by
 * definition and its cycle record carries no mergeSha, so pinning to it passes an
 * empty ref and the read silently degrades to a branch tip. Across runs rather than
 * within one, because a version can be judged more than once and a revalidation is a
 * later run on the same milestone.
 */
export function lastMergedValidationCycle(
  runs: readonly MilestoneRunView[],
): RunCycleView | undefined {
  return [...runs]
    .reverse()
    .flatMap((r) => (r.cycles ?? []).filter((c) => c.kind === "validation"))
    .filter((c) => c.mergeSha)
    .at(-1);
}
