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
import { activeFlow, designSteps, interviewSteps } from "./flowProgress";

describe("interviewSteps", () => {
  it("marks the furthest named section current and earlier ones done", () => {
    const steps = interviewSteps(["Problem — who hurts?", "Actors — who uses this?"]);
    expect(steps[0]!).toMatchObject({ label: "Problem", state: "done" });
    expect(steps[1]!).toMatchObject({ label: "Actors", state: "current" });
    expect(steps[2]!.state).toBe("todo");
  });

  it("is all-todo before any section heading appears", () => {
    expect(interviewSteps([]).every((s) => s.state === "todo")).toBe(true);
  });
});

describe("designSteps", () => {
  it("derives done/current from file presence in emission order", () => {
    const steps = designSteps([
      "specs/design/design.cell",
      "specs/design/components/api/design.json",
    ]);
    expect(steps[0]!.state).toBe("done");
    expect(steps[1]!.state).toBe("done");
    expect(steps[2]!).toMatchObject({ label: "design.md · security.md", state: "current" });
    expect(steps[4]!.state).toBe("todo");
  });
});

describe("activeFlow", () => {
  it("is the interview before a PRD exists, design once design files do", () => {
    expect(activeFlow([], true)).toBe("interview");
    expect(activeFlow(["specs/requirements/prd.md", "specs/design/design.cell"], true)).toBe("design");
    expect(activeFlow(["specs/requirements/prd.md"], true)).toBeNull();
    expect(activeFlow([], false)).toBeNull();
  });
});
