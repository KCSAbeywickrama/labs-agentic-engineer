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
import { rolloutLine } from "./summary";

describe("the Build card's rollout line", () => {
  it("says where the version is in its rollout", () => {
    expect(rolloutLine("v2", { status: "deployed", version: "v2" }, false)).toBe("v2 is live.");
    expect(rolloutLine("v2", { status: "deploying", version: "v2" }, false)).toBe("v2 is rolling out now.");
    expect(rolloutLine("v2", { status: "failed", version: "v2" }, false)).toBe("v2 failed to deploy.");
  });

  it("says it deploys as its tasks merge while another version is the one deployed", () => {
    expect(rolloutLine("v2", { status: "deployed", version: "v1" }, false)).toBe("v2 deploys as its tasks merge.");
    expect(rolloutLine("v2", undefined, false)).toBe("v2 deploys as its tasks merge.");
  });

  it("says a parked version waits for its dependencies' values", () => {
    expect(rolloutLine("v2", { status: "deployed", version: "v1" }, true)).toBe(
      "v2 is built and waits for its dependencies' values before it deploys.",
    );
  });
});
