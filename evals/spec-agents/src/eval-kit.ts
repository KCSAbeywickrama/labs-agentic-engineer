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
 * Glue between the runners and evalite. All real scoring happens inside the
 * task (runner.ts) — the scorers here only EXTRACT precomputed numbers, so
 * evalite's UI shows them without re-deriving anything.
 */

import { createScorer } from "evalite";
import { repeats } from "./config.js";
import type { EvalRunOutput, SectionOutcome } from "./runner.js";

export interface EvalCase<S> {
  sc: S;
  runName: string;
}

/** One evalite case per scenario × EVAL_REPEATS (#355 spread mode). */
export function cases<S>(scenarios: S[], nameOf: (sc: S) => string): Array<{ input: EvalCase<S> }> {
  const n = repeats();
  return scenarios.flatMap((sc) =>
    Array.from({ length: n }, (_, i) => ({
      input: { sc, runName: n > 1 ? `${nameOf(sc)}-r${i + 1}` : nameOf(sc) },
    })),
  );
}

function outcomeMeta(o: SectionOutcome): Record<string, unknown> {
  return {
    band: o.verdict.band,
    score: o.verdict.score,
    ...(o.verdict.forcedReview ? { forcedReview: true } : {}),
    checks: o.structural.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`),
    ...(o.judge
      ? {
          rubric: o.judge.items.map((i) => `${i.covered ? "✓" : "✗"} (w${i.weight}) ${i.item}`),
          mustNotViolations: o.judge.mustNotViolations,
          inventions: o.judge.inventions,
        }
      : {}),
  };
}

/** Section evals have exactly one outcome; these two scorers mirror #355's layers. */
export const structuralScorer = createScorer<EvalCase<unknown>, EvalRunOutput>({
  name: "structural",
  scorer: ({ output }) => {
    const o = output.outcomes[0];
    if (!o) return { score: 0, metadata: { reason: "no outcome" } };
    return { score: o.structural.score, metadata: outcomeMeta(o) };
  },
});

export const rubricScorer = createScorer<EvalCase<unknown>, EvalRunOutput>({
  name: "rubric-judge",
  scorer: ({ output }) => {
    const o = output.outcomes[0];
    if (!o) return { score: 0, metadata: { reason: "no outcome" } };
    return { score: o.judge?.weightedScore ?? 0, metadata: outcomeMeta(o) };
  },
});

/** Chain evals: one scorer per section — the vector stays unblended (#357). */
export function chainSectionScorer(section: string, index: number) {
  return createScorer<EvalCase<unknown>, EvalRunOutput>({
    name: section,
    scorer: ({ output }) => {
      const o = output.outcomes[index];
      if (!o || o.skipped) return { score: 0, metadata: { skipped: true } };
      return { score: o.verdict.score / 100, metadata: outcomeMeta(o) };
    },
  });
}

export function sectionColumns({ output }: { output: EvalRunOutput }): Array<{ label: string; value: unknown }> {
  const o = output.outcomes[0];
  return [
    { label: "band", value: o ? `${o.verdict.band} (${o.verdict.score})` : "?" },
    { label: "turns", value: o?.turns ?? 0 },
    { label: "questions", value: o?.questionsAsked ?? 0 },
    { label: "tokens", value: `${output.usage.inputTokens}in/${output.usage.outputTokens}out` },
    { label: "review", value: output.reviewSheetPath ?? "—" },
  ];
}
