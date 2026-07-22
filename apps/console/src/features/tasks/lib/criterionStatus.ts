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

import type { CriterionRunStatus } from "@aep/ui-validation-view";
import type { components } from "../../../generated/aep-api";

type TimelineEvent = components["schemas"]["TimelineEvent"];
type CriterionStatusRow = components["schemas"]["ValidationCriterionStatus"];

const RUN_STATUSES = new Set<CriterionRunStatus>([
  "validating",
  "passed",
  "failed",
  "skipped",
]);

function asRunStatus(s: string | undefined): CriterionRunStatus | undefined {
  return s && RUN_STATUSES.has(s as CriterionRunStatus)
    ? (s as CriterionRunStatus)
    : undefined;
}

// A stream line is a criterion event when kind === "criterion"; it carries the
// AC id in `step` and the status in `status` (the runner reuses those fields so
// the pipeline needs no new schema — see the aep-validation criterion reporter).
export function isCriterionLine(line: TimelineEvent): boolean {
  return line.kind === "criterion";
}

// mergeCriterionStatus builds the id→status map the ValidationView checklist
// consumes: the durable store rows are the base (they survive a finished/FAILED
// run), and the live stream's `criterion` frames overlay them (fresher —
// last-write-wins in stream order, which is seq order). Returns undefined when
// there is nothing at all, so the caller can decide whether to render a
// checklist skeleton (criteria file present) or fall back to the plain log.
export function mergeCriterionStatus(
  durable: CriterionStatusRow[] | undefined,
  lines: TimelineEvent[] | undefined,
): Record<string, CriterionRunStatus> {
  const out: Record<string, CriterionRunStatus> = {};
  for (const row of durable ?? []) {
    const s = asRunStatus(row.status);
    if (row.id && s) out[row.id] = s;
  }
  for (const line of lines ?? []) {
    if (line.kind !== "criterion") continue;
    const id = line.step;
    const s = asRunStatus(line.status);
    if (id && s) out[id] = s; // fresher than the durable seed
  }
  return out;
}

// splitCriterionLines separates the criterion progress frames from the rest of
// the timeline, so the flat log view doesn't render them as noise (they drive
// the checklist instead).
export function splitCriterionLines(lines: TimelineEvent[]): {
  logLines: TimelineEvent[];
  criterionLines: TimelineEvent[];
} {
  const logLines: TimelineEvent[] = [];
  const criterionLines: TimelineEvent[] = [];
  for (const line of lines) {
    (line.kind === "criterion" ? criterionLines : logLines).push(line);
  }
  return { logLines, criterionLines };
}
