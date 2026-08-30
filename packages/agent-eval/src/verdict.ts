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

import { THRESHOLD } from "./config.js";

export interface ScenarioVerdict {
  id: string;
  score: number;
  passed: boolean;
  failed: { id: string; reason: string }[];
}
export interface Verdict { passed: boolean; overall: number; scenarios: ScenarioVerdict[] }

/**
 * promptfoo's JSON, read as the one thing the fix loop needs: which rubric
 * lines failed and why. The reasons are quoted verbatim into the revision
 * prompt, so a fix cites the line that drove it rather than guessing.
 */
export function readVerdict(json: unknown): Verdict {
  const rows =
    (json as { results?: { results?: unknown[] } })?.results?.results ?? [];
  const scenarios: ScenarioVerdict[] = rows.map((rowRaw) => {
    const row = rowRaw as {
      score?: number;
      metadata?: { scenarioId?: string };
      gradingResult?: {
        componentResults?: { pass?: boolean; assertion?: { metric?: string }; reason?: string }[];
      };
    };
    const parts = row.gradingResult?.componentResults ?? [];
    const failed = parts
      .filter((p) => p.pass === false)
      .map((p) => ({ id: p.assertion?.metric ?? "?", reason: p.reason ?? "" }));
    const score = row.score ?? 0;
    return {
      id: row.metadata?.scenarioId ?? "?",
      score,
      passed: score >= THRESHOLD && failed.length === 0,
      failed,
    };
  });
  const overall = scenarios.length
    ? scenarios.reduce((a, s) => a + s.score, 0) / scenarios.length
    : 0;
  return { passed: scenarios.every((s) => s.passed), overall, scenarios };
}
