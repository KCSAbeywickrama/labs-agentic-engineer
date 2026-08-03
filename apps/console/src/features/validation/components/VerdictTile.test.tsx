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

// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CriterionTally } from "@aep/ui-validation-view";
import { VerdictTile, verdictCounts, verdictSentence } from "./VerdictTile";

function tally(
  total: number,
  states: Record<string, number> = {},
): CriterionTally {
  return {
    total,
    states: Object.entries(states).map(([status, count]) => ({ status, count })),
  };
}

describe("verdictSentence", () => {
  // `passed` now REQUIRES full coverage, so its sentence must say so — claiming
  // only "everything passed" is what let a green banner sit over criteria nobody
  // had checked.
  it("passed names coverage, not just the result", () => {
    expect(verdictSentence("passed", tally(40, { pass: 40 }))).toBe(
      "All 40 validation criteria were covered by a test and passed.",
    );
  });

  // The pair the vocabulary exists for. The numbers are the whole point: without
  // them "Validated*" leaves the reader asking which part.
  it("partial counts the uncovered criteria against the authored total", () => {
    const t = tally(40, { pass: 35, manual: 3, not_run: 2 });
    expect(verdictSentence("partial", t)).toBe(
      "Everything that ran passed, but 5 of 40 validation criteria couldn't be automated — please validate them manually.",
    );
  });

  it("partial inflects for a single uncovered criterion", () => {
    expect(verdictSentence("partial", tally(40, { pass: 39, manual: 1 }))).toContain(
      "1 of 40 validation criteria couldn't be automated — please validate it manually",
    );
  });

  // A failing verdict now ENDS the run, which is a consequence no chip can state —
  // so the sentence has to carry it.
  it("failed counts the failures and states what it did to the run", () => {
    const s = verdictSentence("failed", tally(40, { fail: 2, pass: 38 }));
    expect(s).toContain("2 of 40 criteria failed");
    expect(s).toContain("they are marked below");
    expect(s).toContain("the milestone stays open for the fix");
  });

  it("failed inflects for a single failure", () => {
    expect(verdictSentence("failed", tally(40, { fail: 1, pass: 39 }))).toContain(
      "it is marked below",
    );
  });

  it("inconclusive asks for manual validation", () => {
    expect(verdictSentence("inconclusive", tally(12, { manual: 12 }))).toBe(
      "None of the 12 validation criteria could be automated — please validate them manually.",
    );
  });

  // Not a test outcome but a reporting failure, so the sentence says so instead of
  // reading as a failing suite — and it must never quote the terminal reason, which
  // is a wire value, not something to hand a reader.
  it("unreported names the reporting failure, never the terminal reason", () => {
    const s = verdictSentence("unreported", undefined);
    expect(s).toContain("generating the validation report");
    expect(s).not.toContain("validation-unreported");
  });

  // The tile renders before the report loads, and `unreported` has no report at
  // all — every sentence must still read as a whole sentence.
  it("every verdict degrades to a count-free sentence", () => {
    for (const v of ["passed", "partial", "failed", "inconclusive", "unreported"]) {
      const s = verdictSentence(v, undefined);
      expect(s, `no sentence for ${v}`).not.toBe("");
      expect(s, `${v} leaked a count`).not.toMatch(/\d+ of \d+|All 0|the 0 /);
    }
  });

  // A total of one would force verb agreement on every numbered form, so the
  // numbered forms are gated on total > 1 rather than inflected six ways.
  it("skips the numbers for a single-criterion oracle", () => {
    expect(verdictSentence("passed", tally(1, { pass: 1 }))).toBe(
      "Every validation criterion was covered by a test and passed.",
    );
  });

  it("is empty for a verdict it does not speak for", () => {
    expect(verdictSentence("skipped", tally(0))).toBe("");
    expect(verdictSentence("", undefined)).toBe("");
  });
});

describe("verdictCounts", () => {
  it("reads as a run-on line, lowercased", () => {
    expect(verdictCounts(tally(40, { fail: 2, pass: 35, manual: 3 }))).toBe(
      "2 failed · 35 passed · 3 manual",
    );
  });

  it("names an unknown status verbatim rather than dropping it", () => {
    expect(verdictCounts(tally(1, { quarantined: 1 }))).toBe("1 quarantined");
  });

  it("is empty with no report and with no tally", () => {
    expect(verdictCounts(tally(40))).toBe("");
    expect(verdictCounts(undefined)).toBe("");
  });
});

describe("VerdictTile", () => {
  it("leads with the shared mapper's label as its headline", () => {
    render(<VerdictTile verdict="partial" tally={tally(40, { pass: 35, manual: 5 })} />);
    // "validated*" in the mapper; a headline leads.
    expect(screen.getByText("Validated*")).toBeInTheDocument();
  });

  it("renders the counts under the sentence", () => {
    render(<VerdictTile verdict="passed" tally={tally(40, { pass: 40 })} />);
    expect(screen.getByText("40 passed")).toBeInTheDocument();
  });

  // Never success: a tile that looked like a clean pass would reintroduce exactly
  // the lie the verdict split removed. `info` rather than warning because nothing
  // about a partial run FAILED — the asterisk carries the hedge.
  it("tones partial as info and passed as a success", () => {
    const { unmount } = render(<VerdictTile verdict="partial" />);
    expect(screen.getByRole("alert").className).toMatch(/Info/);
    unmount();
    render(<VerdictTile verdict="passed" />);
    expect(screen.getByRole("alert").className).toMatch(/Success/);
  });

  // A reporting failure that FAILS the run — so error, like a failing suite, and
  // distinctly worded from one.
  it("tones unreported as an error", () => {
    render(<VerdictTile verdict="unreported" />);
    expect(screen.getByRole("alert").className).toMatch(/Error/);
  });

  it("renders without a tally, before the report loads", () => {
    render(<VerdictTile verdict="failed" />);
    expect(screen.getByText("Validation failed")).toBeInTheDocument();
    expect(screen.getByText(/At least one criterion failed/)).toBeInTheDocument();
  });

  // skipped has its own empty state on the page — there is no report and no
  // criteria to put a tile above — and an unknown value must not render a shell.
  it("renders nothing for skipped, running, empty or unknown verdicts", () => {
    for (const v of ["skipped", "running", "", "something-new"]) {
      const { container, unmount } = render(<VerdictTile verdict={v} />);
      expect(container.firstChild, `rendered for ${v}`).toBeNull();
      unmount();
    }
  });

  // No Pass/Fail controls: the earlier design had them, and the no-human-gate
  // decision retired them. A verdict never waits on a person.
  it("offers no verdict controls", () => {
    render(<VerdictTile verdict="partial" tally={tally(40, { pass: 35, manual: 5 })} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
