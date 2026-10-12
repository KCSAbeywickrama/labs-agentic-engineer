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
import { MAX_FEEDBACK_REQUESTS, requestFor } from "@wso2/prototype-kit/feedback";
import { initialPrototypeView, reducePrototypeView, type PrototypeManifest } from "@wso2/prototype-kit/host";
import { commentCount, queueFull } from "./feedback";

const manifest: PrototypeManifest = {
  schemaVersion: 3,
  name: "Expenses",
  entryScreen: "screen.claims",
  roles: [{ id: "manager", name: "Manager" }],
  states: [{ id: "state.default", name: "Default" }],
  screens: [
    { id: "screen.claims", name: "Claims", roleIds: ["manager"] },
    { id: "screen.claim", name: "Claim", roleIds: ["manager"] },
  ],
  flows: [{ id: "flow.approve", name: "Approve", roleId: "manager", screenIds: ["screen.claims", "screen.claim"] }],
};

describe("a request on the review", () => {
  it("is the kit's: made on what the reviewer looks at, for the selection in the order it was made", () => {
    let view = reducePrototypeView(manifest, initialPrototypeView(manifest), { type: "SET_FLOW", flowId: "flow.approve" });
    view = reducePrototypeView(manifest, view, { type: "ENTER_ANNOTATE" });
    view = reducePrototypeView(manifest, view, { type: "TOGGLE_SELECTION", elementKey: "btn.reject" });
    view = reducePrototypeView(manifest, view, { type: "TOGGLE_SELECTION", elementKey: "btn.approve" });
    expect(requestFor(view, "Swap these")).toEqual({
      screenId: "screen.claims",
      flowId: "flow.approve",
      roleId: "manager",
      stateId: "state.default",
      elementIds: ["btn.reject", "btn.approve"],
      text: "Swap these",
    });
  });
});

describe("the queue's count", () => {
  it("is full at the kit's limit for one batch", () => {
    expect(queueFull(MAX_FEEDBACK_REQUESTS - 1)).toBe(false);
    expect(queueFull(MAX_FEEDBACK_REQUESTS)).toBe(true);
  });

  it("counts comments in words", () => {
    expect([commentCount(1), commentCount(3)]).toEqual(["1 comment", "3 comments"]);
  });
});
