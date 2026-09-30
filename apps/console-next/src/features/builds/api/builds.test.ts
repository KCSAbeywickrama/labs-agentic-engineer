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
import { buildRefusal, BuildRefusedError } from "./builds";

// How a failed build start reads, as the console's useBuildProject reads it:
// the envelope's message, and the gate's 422 detail rows kept as a checklist.

describe("buildRefusal", () => {
  it("keeps the gate's detail rows, so the refusal renders as a checklist", () => {
    const err = buildRefusal({
      code: "validation_failed",
      message: "Not ready to build yet.",
      details: [
        { field: "body.selection.F3", message: "Payroll export: waiting on Xero" },
        { message: "Something without a field" },
      ],
    });
    expect(err).toBeInstanceOf(BuildRefusedError);
    expect(err.message).toBe("Not ready to build yet.");
    expect(err.problems).toEqual([
      { field: "body.selection.F3", message: "Payroll export: waiting on Xero" },
      { message: "Something without a field" },
    ]);
  });

  it("is the plain message when there are no details (a build already running)", () => {
    const err = buildRefusal({ code: "build_in_progress", message: "A build is already running for this project." });
    expect(err.message).toBe("A build is already running for this project.");
    expect(err.problems).toEqual([]);
  });

  it("falls back when the failure carried no envelope", () => {
    expect(buildRefusal(undefined).message).toBe("Failed to start the build");
  });
});
