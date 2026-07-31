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
import {
  countOf,
  CRITERION_STATE_LABEL,
  tallyCriterionStates,
  uncoveredCount,
} from "./counts.js";
import type { ValidationCriteria } from "./parse.js";
import type { ValidationReport } from "./report.js";

// One requirement holding `n` criteria, ids AC-1..AC-n.
function oracle(n: number): ValidationCriteria {
  return {
    requirements: [
      {
        id: "REQ-1",
        statement: "s",
        criteria: Array.from({ length: n }, (_, i) => ({
          id: `AC-${i + 1}`,
          must: "m",
          method: "e2e",
        })),
      },
    ],
  };
}

function report(statuses: Record<string, string>): ValidationReport {
  return new Map(Object.entries(statuses).map(([id, status]) => [id, { status }]));
}

describe("tallyCriterionStates", () => {
  it("counts every authored criterion, across requirements", () => {
    const multi: ValidationCriteria = {
      requirements: [
        ...oracle(2).requirements,
        { id: "REQ-2", statement: "s", criteria: [{ id: "AC-9", must: "m", method: "manual" }] },
      ],
    };
    expect(tallyCriterionStates(multi, undefined).total).toBe(3);
  });

  it("yields no states when no report is joined in", () => {
    expect(tallyCriterionStates(oracle(3), undefined).states).toEqual([]);
  });

  // The point of the whole tally: the denominator is what was AUTHORED, so a
  // criterion the report never mentions still counts toward the total. Counting
  // the report's own rows instead would hide exactly the coverage gap that
  // separates a partial verdict from a clean pass.
  it("keeps a criterion the report omits in the total, with no state", () => {
    const t = tallyCriterionStates(oracle(3), report({ "AC-1": "pass" }));
    expect(t.total).toBe(3);
    expect(countOf(t, "pass")).toBe(1);
    expect(t.states).toHaveLength(1);
  });

  it("orders the tally so a failure reads first", () => {
    const t = tallyCriterionStates(
      oracle(4),
      report({ "AC-1": "pass", "AC-2": "manual", "AC-3": "fail", "AC-4": "pass" }),
    );
    expect(t.states).toEqual([
      { status: "fail", count: 1 },
      { status: "pass", count: 2 },
      { status: "manual", count: 1 },
    ]);
  });

  // report.ts keeps `status` a raw string on purpose, so an unrecognised status
  // must still surface — silently dropping it would understate the tally.
  it("surfaces unknown statuses after the known ones, alphabetically", () => {
    const t = tallyCriterionStates(
      oracle(3),
      report({ "AC-1": "quarantined", "AC-2": "pass", "AC-3": "aborted" }),
    );
    expect(t.states.map((s) => s.status)).toEqual(["pass", "aborted", "quarantined"]);
  });

  it("handles an empty oracle", () => {
    expect(tallyCriterionStates({ requirements: [] }, undefined)).toEqual({
      total: 0,
      states: [],
    });
  });

  it("ignores a report entry with no matching criterion", () => {
    const t = tallyCriterionStates(oracle(1), report({ "AC-1": "pass", "AC-99": "fail" }));
    expect(t.total).toBe(1);
    expect(countOf(t, "fail")).toBe(0);
  });
});

describe("countOf", () => {
  it("is zero for a status nothing carries", () => {
    const t = tallyCriterionStates(oracle(1), report({ "AC-1": "pass" }));
    expect(countOf(t, "fail")).toBe(0);
  });
});

describe("uncoveredCount", () => {
  // The three statuses that mean nobody actually checked the criterion. This sum
  // is what lets a partial verdict say "5 of 40 were never covered".
  it("sums not_run, not_validated and manual", () => {
    const t = tallyCriterionStates(
      oracle(5),
      report({
        "AC-1": "pass",
        "AC-2": "not_run",
        "AC-3": "not_validated",
        "AC-4": "manual",
        "AC-5": "pass",
      }),
    );
    expect(uncoveredCount(t)).toBe(3);
  });

  it("is zero when every criterion produced a real result", () => {
    const t = tallyCriterionStates(oracle(2), report({ "AC-1": "pass", "AC-2": "fail" }));
    expect(uncoveredCount(t)).toBe(0);
  });
});

describe("CRITERION_STATE_LABEL", () => {
  // ValidationView's per-criterion chips read their labels from this same map, so
  // a gap here would show a raw status like `not_run` in the UI.
  it("names every status the report parser can emit", () => {
    for (const s of ["pass", "fail", "not_run", "not_validated", "manual"]) {
      expect(CRITERION_STATE_LABEL[s], `no label for ${s}`).toBeTruthy();
    }
  });
});
