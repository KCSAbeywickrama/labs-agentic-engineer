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
import type { components } from "../../../generated/aep-api";
import { mergeCriterionStatus, splitCriterionLines } from "./criterionStatus";

type TimelineEvent = components["schemas"]["TimelineEvent"];
type CriterionStatusRow = components["schemas"]["CriterionStatus"];

function line(overrides: Partial<TimelineEvent> & { kind: string }): TimelineEvent {
  return {
    schemaVersion: 1,
    ts: "2026-07-10T09:00:00Z",
    seq: 0,
    executionId: "exec-1",
    executionKind: "coding",
    ...overrides,
  } as TimelineEvent;
}

function row(id: string, status: string): CriterionStatusRow {
  return { id, requirementId: "REQ-001", status, updatedAt: "2026-07-10T09:00:00Z" };
}

describe("mergeCriterionStatus", () => {
  it("seeds from the durable rows", () => {
    const out = mergeCriterionStatus([row("AC-001-a", "passed"), row("AC-001-b", "failed")], []);
    expect(out).toEqual({ "AC-001-a": "passed", "AC-001-b": "failed" });
  });

  it("overlays live stream frames on top of the durable seed (fresher wins)", () => {
    const durable = [row("AC-001-a", "validating")];
    const lines = [line({ kind: "criterion", step: "AC-001-a", status: "passed" })];
    expect(mergeCriterionStatus(durable, lines)).toEqual({ "AC-001-a": "passed" });
  });

  it("takes the last live frame for a criterion (validating → passed)", () => {
    const lines = [
      line({ kind: "criterion", step: "AC-001-a", status: "validating", seq: 1 }),
      line({ kind: "criterion", step: "AC-001-a", status: "passed", seq: 2 }),
    ];
    expect(mergeCriterionStatus([], lines)).toEqual({ "AC-001-a": "passed" });
  });

  it("ignores non-criterion lines and unknown statuses", () => {
    const lines = [
      line({ kind: "log", message: "hi" }),
      line({ kind: "criterion", step: "AC-001-a", status: "bogus" }),
      line({ kind: "criterion", step: "", status: "passed" }),
    ];
    expect(mergeCriterionStatus([], lines)).toEqual({});
  });
});

describe("splitCriterionLines", () => {
  it("separates criterion frames from the flat log", () => {
    const lines = [
      line({ kind: "log", message: "a" }),
      line({ kind: "criterion", step: "AC-001-a", status: "passed" }),
      line({ kind: "tool_use", tool: "Bash" }),
    ];
    const { logLines, criterionLines } = splitCriterionLines(lines);
    expect(logLines.map((l) => l.kind)).toEqual(["log", "tool_use"]);
    expect(criterionLines.map((l) => l.kind)).toEqual(["criterion"]);
  });
});
