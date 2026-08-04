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
import {
  countOf,
  CRITERION_STATE_LABEL,
  uncoveredCount,
  type CriterionTally,
} from "@aep/ui-validation-view";
import { validationView, type StageTone } from "../../projects/lib/pipeline";

// The verdicts this tile speaks for. `skipped` is absent on purpose: the page
// answers it with an empty state, because there is no report and no criteria to
// put a tile above. Anything else — "", "running", a value from a newer server —
// renders nothing rather than an empty box.
const TILE_VERDICTS = new Set([
  "passed",
  "partial",
  "failed",
  "inconclusive",
  "unreported",
]);

// StageTone → Alert severity, which is also what picks the Alert's icon. Kept a
// total map for exhaustiveness; `ghost`/`neutral` are unreachable here because
// none of the five tile verdicts maps to them.
const SEVERITY: Record<StageTone, "success" | "info" | "warning" | "error"> = {
  ghost: "info",
  neutral: "info",
  info: "info",
  warning: "warning",
  success: "success",
  error: "error",
};

/**
 * The sentence under the headline: what the verdict means, and for the two fatal
 * ones what it did to the run. Pure, so the copy is testable without a DOM.
 *
 * Every verdict has a count-free fallback — the tile renders before the report
 * loads, and `unreported` has no report to count at all — and the numbered forms
 * are gated on `total > 1` so none of them has to inflect a verb for a count of
 * one.
 */
export function verdictSentence(
  verdict: string,
  tally: CriterionTally | undefined,
): string {
  const total = tally?.total ?? 0;
  const counted = total > 1;
  switch (verdict) {
    case "passed":
      // Names coverage, not just the result: `passed` now REQUIRES that every
      // criterion was checked, which is the whole point of the vocabulary.
      return counted
        ? `All ${total} validation criteria were covered by a test and passed.`
        : "Every validation criterion was covered by a test and passed.";
    case "partial": {
      const uncovered = tally ? uncoveredCount(tally) : 0;
      // Ends on what the reader can do about it. The count is the gap between
      // what was authored and what a test actually answered, so the ask is
      // specific rather than a vague "not a clean pass".
      return counted && uncovered > 0
        ? `Everything that ran passed, but ${uncovered} of ${total} validation criteria couldn't be automated — please validate ${
            uncovered === 1 ? "it" : "them"
          } manually.`
        : "Everything that ran passed, but some validation criteria couldn't be automated — please validate them manually.";
    }
    case "failed": {
      const failed = tally ? countOf(tally, "fail") : 0;
      const marked = failed === 1 ? "it is marked below" : "they are marked below";
      return counted && failed > 0
        ? `${failed} of ${total} criteria failed — ${marked}. The run stopped here, so the milestone stays open for the fix.`
        : "At least one criterion failed — the failing criteria are marked below. The run stopped here, so the milestone stays open for the fix.";
    }
    case "inconclusive":
      return counted
        ? `None of the ${total} validation criteria could be automated — please validate them manually.`
        : "None of the validation criteria could be automated — please validate them manually.";
    case "unreported":
      // A reporting failure, not a test outcome: no criterion produced one. The
      // terminal reason (`validation-unreported`) is deliberately NOT quoted —
      // a wire value is not something to hand a reader.
      return "Something went wrong while generating the validation report, so there are no results to show for this run.";
    default:
      return "";
  }
}

/** "35 passed · 5 manual" — the run's outcome in numbers, or "" with no report. */
export function verdictCounts(tally: CriterionTally | undefined): string {
  if (!tally) return "";
  return tally.states
    .map(
      (s) =>
        `${s.count} ${(CRITERION_STATE_LABEL[s.status] ?? s.status).toLowerCase()}`,
    )
    .join(" · ");
}

/**
 * The verdict tile: what the validation run concluded, above the per-criterion
 * evidence. It exists because a chip label cannot finish the sentence for the
 * verdicts that matter most — "Validated*" begs *which part*, "Validation?" begs
 * *why is that a question*, "Validation error" begs *what broke* — and
 * because three of the five ask the reader to do something (validate the rest by
 * hand, fix a failure), which no chip can say.
 *
 * The headline is the SHARED mapper's label (projects/lib/pipeline), capitalized,
 * never restated — so the tile and the header chip cannot drift apart. Only the
 * sentence is local copy. There are no Pass/Fail controls: nothing about a verdict
 * waits on a person.
 */
export function VerdictTile({
  verdict,
  tally,
}: {
  verdict: string;
  tally?: CriterionTally;
}) {
  const view = validationView(verdict);
  if (!view || !TILE_VERDICTS.has(verdict)) return null;

  const counts = verdictCounts(tally);
  return (
    // No margins: the page's body container owns the gap below and PageTitle owns
    // the space above. A tile that insets itself put the page's one 24px-inset
    // element beside bodies that were flush.
    <Alert severity={SEVERITY[view.tone]}>
      {/* The shared labels are lowercase for mid-sentence use; a headline leads. */}
      <AlertTitle>
        {view.label.charAt(0).toUpperCase() + view.label.slice(1)}
      </AlertTitle>
      <Typography variant="body2">{verdictSentence(verdict, tally)}</Typography>
      {counts && (
        <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 500 }}>
          {counts}
        </Typography>
      )}
    </Alert>
  );
}
