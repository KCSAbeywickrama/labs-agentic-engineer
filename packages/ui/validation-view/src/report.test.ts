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

import { describe, it, expect } from "vitest";
import { parseValidationReport, type ValidationReport } from "./report.js";

// A trimmed report.json shaped exactly like generate-report.mjs emits.
const REPORT = JSON.stringify({
  schemaVersion: 1,
  issue: 30,
  commit: "abc123",
  totals: { e2e: { total: 3, pass: 1, fail: 1, notRun: 1 }, manual: 1, scenario: 1 },
  criteria: [
    {
      id: "AC-001-a",
      requirementId: "REQ-001",
      must: "x",
      method: "e2e",
      status: "pass",
      spec: "tests/e2e/specs/AC-001-a.spec.ts",
      healed: false,
      flaky: true,
      durationMs: 1200,
      failure: null,
    },
    {
      id: "AC-001-b",
      requirementId: "REQ-001",
      must: "y",
      method: "e2e",
      status: "fail",
      spec: "tests/e2e/specs/AC-001-b.spec.ts",
      healed: true,
      flaky: false,
      durationMs: 800,
      failure: "expected 200, got 500",
    },
    {
      id: "AC-013-a",
      requirementId: "REQ-013",
      must: "z",
      method: "e2e",
      status: "not_run",
      spec: null,
      failure: null,
    },
    { id: "AC-013-b", requirementId: "REQ-013", must: "w", method: "scenario", status: "not_validated" },
    { id: "AC-021-b", requirementId: "REQ-021", must: "v", method: "manual", status: "manual" },
  ],
});

function ok(raw: string): ValidationReport {
  const r = parseValidationReport(raw);
  if ("kind" in r) throw new Error(`unexpected parse error: ${r.message}`);
  return r;
}

describe("parseValidationReport", () => {
  it("maps every criterion by id with its status", () => {
    const r = ok(REPORT);
    expect(r.size).toBe(5);
    expect(r.get("AC-001-a")?.status).toBe("pass");
    expect(r.get("AC-001-b")?.status).toBe("fail");
    expect(r.get("AC-013-a")?.status).toBe("not_run");
    expect(r.get("AC-013-b")?.status).toBe("not_validated");
    expect(r.get("AC-021-b")?.status).toBe("manual");
  });

  it("carries failure/spec/healed/flaky/duration on the failing e2e row", () => {
    const fail = ok(REPORT).get("AC-001-b")!;
    expect(fail.failure).toBe("expected 200, got 500");
    expect(fail.spec).toBe("tests/e2e/specs/AC-001-b.spec.ts");
    expect(fail.healed).toBe(true);
    expect(fail.flaky).toBe(false);
    expect(fail.durationMs).toBe(800);
  });

  it("omits null/absent optional fields", () => {
    const pass = ok(REPORT).get("AC-001-a")!;
    // failure was null → dropped; flaky true kept.
    expect(pass.failure).toBeUndefined();
    expect(pass.flaky).toBe(true);
    const notRun = ok(REPORT).get("AC-013-a")!;
    expect(notRun.spec).toBeUndefined();
    expect(notRun.healed).toBeUndefined();
    const manual = ok(REPORT).get("AC-021-b")!;
    expect(manual.spec).toBeUndefined();
    expect(manual.durationMs).toBeUndefined();
  });

  it("keeps an unrecognized status string verbatim", () => {
    const r = ok(
      JSON.stringify({ criteria: [{ id: "AC-1", status: "quarantined" }] }),
    );
    expect(r.get("AC-1")?.status).toBe("quarantined");
  });

  it("skips rows missing an id or status", () => {
    const r = ok(
      JSON.stringify({
        criteria: [
          { id: "AC-1", status: "pass" },
          { status: "fail" }, // no id
          { id: "AC-2" }, // no status
        ],
      }),
    );
    expect([...r.keys()]).toEqual(["AC-1"]);
  });

  it("returns a ParseError on malformed JSON", () => {
    const r = parseValidationReport("{ not json");
    expect("kind" in r && r.kind).toBe("parse-error");
  });

  it("returns a ParseError when the top level is not an object", () => {
    expect("kind" in parseValidationReport("42")).toBe(true);
    expect("kind" in parseValidationReport("[]")).toBe(true);
  });

  it("returns a ParseError when `criteria` is missing or not an array", () => {
    expect("kind" in parseValidationReport(JSON.stringify({}))).toBe(true);
    expect(
      "kind" in parseValidationReport(JSON.stringify({ criteria: {} })),
    ).toBe(true);
  });
});
