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
import { statusIsMoving } from "./queries";

type ProjectStatus = components["schemas"]["ProjectStatus"];
type DeployStage = components["schemas"]["DeployStage"];

/** A settled project: repo ready, spec written, nothing in flight. Every case
 *  below changes one thing, so what it asserts is that one thing. */
function settled(deploy: Partial<DeployStage> = {}, build = "succeeded"): ProjectStatus {
  return {
    phase: "tasks",
    repoStatus: "ready",
    repoUrl: "https://github.com/acme/widgets",
    hasSpec: true,
    hasDesign: true,
    hasTasks: true,
    specStatus: "approved",
    designStatus: "approved",
    spec: { exists: true, version: "v3", dirty: false, design: true, agent: "" },
    build: { status: build, version: "v3" },
    deploy: {
      version: "v3",
      status: "deployed",
      components: { total: 1, ready: 1 },
      validation: "passed",
      ...deploy,
    },
  } as ProjectStatus;
}

describe("statusIsMoving", () => {
  it("holds the fast cadence while a verdict is still expected", () => {
    // The window this exists for. `deploy.status` reads "deployed" the instant
    // the last binding is Ready — before anything has judged the version — so
    // without this clause the poll drops to 30s at exactly the moment the state
    // is about to change, and the page sits on "waiting" long after it stopped
    // being true.
    expect(statusIsMoving(settled({ validation: "none" }))).toBe(true);
  });

  it("holds it through the validation cycle and the repair that follows one", () => {
    expect(statusIsMoving(settled({ validation: "running" }))).toBe(true);
    expect(statusIsMoving(settled({ validation: "awaiting-fix" }))).toBe(true);
  });

  it("does not hold it on a version nothing will ever judge", () => {
    // `none` is two states wearing one name, and this is the other one. A
    // delivery that failed, was cancelled or was blocked leaves the validation
    // state at "none" permanently — so an unscoped clause would park this
    // project on the 5s poll for as long as a tab is open, on a hook that runs
    // from every route for the toolbar badge.
    expect(statusIsMoving(settled({ validation: "none" }, "failed"))).toBe(false);
    expect(statusIsMoving(settled({ validation: "none" }, "cancelled"))).toBe(false);
  });

  it("answers for every validation state a deployed version can be in", () => {
    // Exhaustive by TYPE, so a new member of the enum fails to compile here
    // rather than silently picking up whichever cadence the fall-through gives
    // it. Each entry is whether that state should hold the FAST poll.
    const moving: Record<NonNullable<DeployStage["validation"]>, boolean> = {
      none: true, // a verdict is expected
      running: true, // a validation cycle is in flight
      "awaiting-fix": true, // the coding cycle repairing a failed one
      passed: false,
      partial: false,
      failed: false,
      inconclusive: false,
      unreported: false,
      skipped: false,
      cancelled: false, // a person stopped the judging; nothing is coming
    };
    for (const [validation, want] of Object.entries(moving)) {
      expect(statusIsMoving(settled({ validation: validation as DeployStage["validation"] })))
        .toBe(want);
    }
  });

  it("does not hold it on a version that never deployed", () => {
    // Nothing is coming: there is no deployment for validation to run against,
    // and "none" here is the absence of a question rather than of an answer.
    expect(statusIsMoving(settled({ status: "none", validation: "none" }))).toBe(false);
    expect(statusIsMoving(settled({ status: "failed", validation: "none" }))).toBe(false);
  });

  it("still holds it for the states it always did", () => {
    expect(statusIsMoving(settled({}, "running"))).toBe(true);
    expect(statusIsMoving(settled({ status: "deploying" }))).toBe(true);
  });
});
