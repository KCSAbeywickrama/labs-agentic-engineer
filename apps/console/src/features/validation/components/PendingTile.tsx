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

import { Alert, AlertTitle, Typography } from "@wso2/oxygen-ui";
import { METHOD_LABEL, type CriterionMethodCount } from "@aep/ui-validation-view";
import { validationView } from "../../projects/lib/pipeline";

// What the run is doing to the criteria listed below it. Said here because the
// criteria themselves cannot: a reader meeting a page of "Pending" chips has no way
// to know which of them an agent is about to answer and which are waiting on them.
const RUNNING = "Auto criteria are being validated end to end against the deployed system.";
// Only when there ARE manual criteria. The sentence is an instruction, and an
// instruction to check criteria that do not exist sends the reader looking for a
// list that is empty.
const MANUAL = "Please validate the manual criteria yourself.";
// The oracle was never authored, which is also why this run will settle as skipped.
// Said in the tile rather than as a note above the log because the tile is then the
// whole body — there are no criteria to put under it.
const NO_CRITERIA =
  "This version has no validation criteria, so there is nothing to check the deployment against.";

/**
 * The tile over a FIRST validation attempt in flight: what is being checked, by
 * whom, and how much of it.
 *
 * A sibling of VerdictTile rather than a branch inside it. That tile is keyed to
 * verdicts in its gate, its severity, its sentence and its tally — a run that has
 * concluded nothing shares only the Alert shell with it, and the two would have
 * ended up as one component with an escape hatch in every one of those four places.
 *
 * The headline comes from the shared mapper (projects/lib/pipeline) exactly as
 * VerdictTile's does, so the tile and the header chip above it cannot drift.
 *
 * `methods` is the oracle's per-method tally, absent while the criteria are still
 * loading — the counts line is then simply not drawn, rather than the tile waiting
 * for numbers to explain a run that is already under way.
 */
export function PendingTile({
  methods,
  noCriteria = false,
}: {
  methods?: CriterionMethodCount[];
  /** The criteria read came back `not_found`: none were ever authored. */
  noCriteria?: boolean;
}) {
  const view = validationView("running");
  if (!view) return null;

  const manual = methods?.find((m) => m.method === "manual")?.count ?? 0;
  // "12 auto · 3 manual" — the same words as the badges on the rows below, because
  // both read METHOD_LABEL.
  const counts = (methods ?? [])
    .map(({ method, count }) => `${count} ${METHOD_LABEL[method] ?? method}`)
    .join(" · ");

  return (
    // No margins, same as VerdictTile: the page's body container owns the gap below.
    <Alert severity="info">
      {/* The shared labels are lowercase for mid-sentence use; a headline leads. */}
      <AlertTitle>
        {view.label.charAt(0).toUpperCase() + view.label.slice(1)}
      </AlertTitle>
      <Typography variant="body2">
        {noCriteria ? NO_CRITERIA : manual > 0 ? `${RUNNING} ${MANUAL}` : RUNNING}
      </Typography>
      {!noCriteria && counts && (
        <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 500 }}>
          {counts}
        </Typography>
      )}
    </Alert>
  );
}
