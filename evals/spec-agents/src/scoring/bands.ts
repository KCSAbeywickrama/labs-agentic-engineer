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
 * Verdict bands (#355): pass ≥75, review 50–75, fail <50 — computed on the
 * combined section score (mean of structural + judge, in 0..1). A `mustNot`
 * violation forces AT LEAST review. Chains report a verdict VECTOR, never one
 * blended number (#357).
 */

export type Band = "pass" | "review" | "fail";

export interface SectionVerdict {
  section: string;
  /** Structural-check score, 0..1. */
  structural: number;
  /** Weighted rubric-judge score, 0..1; null when no artifact was judgeable. */
  judge: number | null;
  /** Combined 0..100. */
  score: number;
  band: Band;
  /** True when a mustNot violation demoted a would-be pass. */
  forcedReview: boolean;
}

export function combineScore(structural: number, judge: number | null): number {
  const s = judge === null ? structural : (structural + judge) / 2;
  return Math.round(s * 100);
}

export function bandFor(score: number, mustNotViolated: boolean): { band: Band; forcedReview: boolean } {
  const raw: Band = score >= 75 ? "pass" : score >= 50 ? "review" : "fail";
  if (mustNotViolated && raw === "pass") return { band: "review", forcedReview: true };
  return { band: raw, forcedReview: false };
}

export function sectionVerdict(
  section: string,
  structural: number,
  judge: number | null,
  mustNotViolated: boolean,
): SectionVerdict {
  const score = combineScore(structural, judge);
  const { band, forcedReview } = bandFor(score, mustNotViolated);
  return { section, structural, judge, score, band, forcedReview };
}
