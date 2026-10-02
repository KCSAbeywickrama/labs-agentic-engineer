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
import { countUnread, nextSeenUntil } from "./useAlertsUnread";

type RcaAgentReport = components["schemas"]["RcaAgentReport"];

// createdAt is required by the contract, but the pure functions under test
// defensively fall back to "" when it's absent — cast to simulate a
// malformed/legacy response the type system otherwise wouldn't allow.
function report(id: string, createdAt?: string): RcaAgentReport {
  return {
    id,
    project: "demo-shop",
    title: `report ${id}`,
    summary: "summary",
    classification: "code-level",
    diagnosis: "diagnosis",
    deployed: false,
    ...(createdAt !== undefined && { createdAt }),
  } as RcaAgentReport;
}

describe("countUnread", () => {
  it("counts every timestamped report as unread when there is no watermark yet", () => {
    const reports = [report("a", "2026-07-09T10:00:00Z"), report("b", "2026-07-09T11:00:00Z")];
    expect(countUnread(reports, "")).toBe(2);
  });

  it("excludes reports without a createdAt when there is no watermark", () => {
    const reports = [report("a", "2026-07-09T10:00:00Z"), report("b")];
    expect(countUnread(reports, "")).toBe(1);
  });

  it("counts only reports newer than the watermark", () => {
    const reports = [
      report("a", "2026-07-09T09:00:00Z"),
      report("b", "2026-07-09T11:00:00Z"),
      report("c", "2026-07-09T12:00:00Z"),
    ];
    expect(countUnread(reports, "2026-07-09T10:00:00Z")).toBe(2);
  });

  it("never counts a report missing createdAt, even past a watermark", () => {
    const reports = [report("a", "2026-07-09T12:00:00Z"), report("b")];
    expect(countUnread(reports, "2026-07-09T10:00:00Z")).toBe(1);
  });

  it("returns 0 for an empty list regardless of watermark", () => {
    expect(countUnread([], "")).toBe(0);
    expect(countUnread([], "2026-07-09T10:00:00Z")).toBe(0);
  });
});

describe("nextSeenUntil", () => {
  it("advances to the newest report's createdAt", () => {
    const reports = [report("a", "2026-07-09T09:00:00Z"), report("b", "2026-07-09T12:00:00Z")];
    expect(nextSeenUntil(reports, "")).toBe("2026-07-09T12:00:00Z");
  });

  it("never regresses the watermark when reports are older than it", () => {
    const reports = [report("a", "2026-07-09T09:00:00Z")];
    expect(nextSeenUntil(reports, "2026-07-09T12:00:00Z")).toBe("2026-07-09T12:00:00Z");
  });

  it("ignores reports without a createdAt", () => {
    const reports = [report("a"), report("b")];
    expect(nextSeenUntil(reports, "2026-07-09T10:00:00Z")).toBe("2026-07-09T10:00:00Z");
  });

  it("returns the existing watermark unchanged for an empty list", () => {
    expect(nextSeenUntil([], "2026-07-09T10:00:00Z")).toBe("2026-07-09T10:00:00Z");
  });
});
