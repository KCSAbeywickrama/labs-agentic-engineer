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
import { parseScenarios } from "../src/scenario.js";

const VALID = {
  version: 1,
  component: "trip-agent",
  scenarios: [
    {
      id: "SC-001",
      criteria: ["AC-003-a"],
      brief: { goal: "Book three nights in London", facts: { city: "London" }, withholds: ["dates"] },
      rubric: {
        mustCover: [{ id: "MC-1", must: "Asks for the missing dates", weight: 2 }],
        mustNot: [{ id: "MN-1", mustNot: "States a price the API did not return" }],
      },
    },
  ],
};

describe("parseScenarios", () => {
  it("accepts a well-formed file and defaults an omitted weight to 1", () => {
    const parsed = parseScenarios(VALID);
    expect(parsed.scenarios[0]!.rubric.mustCover[0]!.weight).toBe(2);
    expect(parsed.component).toBe("trip-agent");
  });

  // A rubric that asserts nothing cannot fail, so it would report green forever.
  it("rejects a rubric with neither mustCover nor mustNot", () => {
    const bad = structuredClone(VALID);
    bad.scenarios[0]!.rubric = { mustCover: [], mustNot: [] } as never;
    expect(() => parseScenarios(bad)).toThrow(/rubric/i);
  });

  // Scenario ids are cited in reports and in the fix loop's reasoning.
  it("rejects duplicate scenario ids", () => {
    const bad = structuredClone(VALID);
    bad.scenarios.push(structuredClone(bad.scenarios[0]!));
    expect(() => parseScenarios(bad)).toThrow(/SC-001/);
  });

  it("names the offending path in the error", () => {
    expect(() => parseScenarios({ version: 1, component: "x", scenarios: [{ id: "SC-1" }] }))
      .toThrow(/scenarios\[0\]/);
  });
});
