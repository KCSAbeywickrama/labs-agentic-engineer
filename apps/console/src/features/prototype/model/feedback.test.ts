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
import { initialPrototypeView, reducePrototypeView, type PrototypeManifest } from "@wso2/prototype-kit/host";
import { MAX_REQUESTS, enqueue, feedbackBatch, pinsOnScreen, prototypeHash, requestFor, type FeedbackRequest } from "./feedback";

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

const request = (screenId: string, elementIds: string[], text = "Change it"): FeedbackRequest => ({
  screenId,
  roleId: "manager",
  stateId: "state.default",
  elementIds,
  text,
});

describe("requestFor", () => {
  it("is made on what the reviewer looks at, for the selection in the order it was made", () => {
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

  it("leaves the flow out when the reviewer walks freely, and names no element for the whole screen", () => {
    expect(requestFor(initialPrototypeView(manifest), "Too busy")).toEqual(request("screen.claims", [], "Too busy"));
  });
});

describe("pinsOnScreen", () => {
  it("numbers each element by the requests on this screen that name it", () => {
    const queue = [request("screen.claim", ["btn.approve"]), request("screen.claims", ["row.42"]), request("screen.claim", ["btn.approve", "text.total"])];
    expect(pinsOnScreen(queue, "screen.claim")).toEqual({ "btn.approve": [1, 3], "text.total": [3] });
  });
});

describe("the queue", () => {
  it("keeps the revision its first request was made on", () => {
    let queue = enqueue(null, "a".repeat(64), request("screen.claims", []));
    queue = enqueue(queue, "b".repeat(64), request("screen.claim", []));
    expect(queue.hash).toBe("a".repeat(64));
    expect(queue.requests).toHaveLength(2);
  });

  it("takes no more than the contract's limit", () => {
    let queue = enqueue(null, "a".repeat(64), request("screen.claims", []));
    for (let i = 1; i < MAX_REQUESTS + 5; i++) queue = enqueue(queue, "a".repeat(64), request("screen.claims", []));
    expect(queue.requests).toHaveLength(MAX_REQUESTS);
  });

  it("is sent whole as the component's feedback batch", () => {
    const queue = enqueue(null, "c".repeat(64), request("screen.claim", ["btn.approve"]));
    expect(feedbackBatch("expense-web", queue)).toEqual({ prototypeHash: "c".repeat(64), component: "expense-web", requests: queue.requests });
  });
});

describe("prototypeHash", () => {
  it("is the kit's revision hash: SHA-256 of the manifest, a NUL and the source", async () => {
    // What prototype-cli's prototypeHash (node:crypto) gives for these two files.
    const kit = "96974f3d2eb299b476852889a0c56c8d5818797e761f1d6883c377a8678a7305";
    await expect(prototypeHash('{"name":"Ünïcode"}', "export default 1;\n")).resolves.toBe(kit);
  });
});
