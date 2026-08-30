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

import { describe, expect, it } from "vitest";
import { readVerdict } from "../src/verdict.js";

const OUT = {
  results: {
    results: [
      {
        success: false,
        score: 0.5,
        metadata: { scenarioId: "SC-001" },
        gradingResult: {
          componentResults: [
            { pass: true, score: 1, assertion: { metric: "MC-1" }, reason: "ok" },
            { pass: false, score: 0, assertion: { metric: "MN-1" }, reason: "invented a price" },
          ],
        },
      },
    ],
  },
};

describe("readVerdict", () => {
  it("names which rubric lines failed, so a fix can cite them", () => {
    const v = readVerdict(OUT);
    expect(v.scenarios[0]!.failed).toEqual([{ id: "MN-1", reason: "invented a price" }]);
  });

  it("does not pass a scenario below the 0.8 threshold", () => {
    expect(readVerdict(OUT).passed).toBe(false);
  });

  it("passes at exactly 0.8", () => {
    const at = structuredClone(OUT);
    at.results.results[0]!.score = 0.8;
    at.results.results[0]!.success = true;
    at.results.results[0]!.gradingResult.componentResults[1]!.pass = true;
    expect(readVerdict(at).passed).toBe(true);
  });

  // A single mustNot violation fails a scenario outright, regardless of its
  // averaged score — the score alone must never be sufficient for a pass.
  it("fails a scenario on a mustNot violation even at a high score", () => {
    const high = structuredClone(OUT);
    high.results.results[0]!.score = 0.95;
    expect(readVerdict(high).passed).toBe(false);
  });

  // No scenarios graded means no achievable weight to divide by — the
  // overall average must not divide by zero (NaN would poison the report).
  it("does not divide by zero when there are no results", () => {
    const v = readVerdict({ results: { results: [] } });
    expect(v.overall).toBe(0);
    expect(v.scenarios).toEqual([]);
  });
});
