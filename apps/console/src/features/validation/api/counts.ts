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

import { useMemo } from "react";
import {
  countOf,
  parseValidationCriteria,
  parseValidationReport,
  tallyCriterionStates,
} from "@aep/ui-validation-view";
import { useBuildRuns } from "../../builds/api/queries";
import { useValidationCriteria, useValidationReport } from "./queries";

// Criteria counts for surfaces OUTSIDE the Validation page (#395: the
// Deployments rail says "8/12 passed" beside its verdict). Same join the
// Validation page performs — the newest run's verdict, its LAST validation
// cycle's merge commit pinning the report read, the authored oracle as the
// denominator — packaged as one hook so the two surfaces cannot resolve the
// run differently. Counts are an upgrade, never a blocker: every failure
// mode (no run, no report, unparseable files) returns undefined and the
// caller falls back to the bare verdict label.

/** How many criteria passed, out of how many the oracle authored. */
export interface ValidationCounts {
  passed: number;
  total: number;
}

// Verdicts whose counts inform: a report was (or should have been) joined.
// `unreported` and `inconclusive` would tally 0/N — a number that reads as
// "everything failed" about runs whose actual story is "nothing was joined".
const COUNTABLE = new Set(["passed", "partial", "failed"]);

/**
 * The deployed version's criteria counts, or undefined while loading / when
 * the verdict has no countable report / when any read fails.
 *
 * `version` is the BUILD version (status.build.version) — the newest run's
 * tag, which is what `deploy.validation` describes. deploy.version names the
 * newest SUCCEEDED run and lags while validation is in flight.
 */
export function useValidationCounts(
  projectName: string,
  version: string,
  deployValidation: string,
): ValidationCounts | undefined {
  const wanted = COUNTABLE.has(deployValidation);
  const runs = useBuildRuns(projectName, wanted && version ? version : undefined);
  const run = runs.data?.runs?.[0];
  const rawVerdict = run?.validation?.verdict ?? "";
  const settled = wanted && rawVerdict !== "" && rawVerdict !== "skipped";
  const missingReport = rawVerdict === "unreported";
  // The LAST validation cycle: a repaired run re-validates, and the verdict is
  // its latest attempt's — `find` would pair attempt 1's report with it.
  const cycle = run?.cycles?.filter((c) => c.kind === "validation").at(-1);

  const criteria = useValidationCriteria(projectName, version, settled);
  const report = useValidationReport(
    projectName,
    version,
    settled && !missingReport,
    run?.validation?.reportPath ?? "",
    cycle?.mergeSha,
  );

  const criteriaContent = criteria.data?.content;
  const reportContent = report.data?.content;
  return useMemo(() => {
    if (!settled || !criteriaContent || !reportContent) return undefined;
    const oracle = parseValidationCriteria(criteriaContent);
    if ("kind" in oracle) return undefined;
    const parsed = parseValidationReport(reportContent);
    if ("kind" in parsed) return undefined;
    const tally = tallyCriterionStates(oracle, parsed);
    // The report's status vocabulary is "pass"/"fail" (STATE_ORDER), not the
    // verdict vocabulary's "passed".
    return { passed: countOf(tally, "pass"), total: tally.total };
  }, [settled, criteriaContent, reportContent]);
}
