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

import { describe, expect, it, vi } from "vitest";
import type { PrototypeManifest } from "@wso2/prototype-kit/host";
import type { AppPrototype, PrototypeFiles } from "./prototypes";
import { createReviewStore } from "./reviewStore";

const manifest: PrototypeManifest = {
  schemaVersion: 3,
  name: "Expenses",
  entryScreen: "screen.claims",
  roles: [{ id: "manager", name: "Manager" }],
  states: [{ id: "state.default", name: "Default" }],
  screens: [{ id: "screen.claims", name: "Claims", roleIds: ["manager"] }],
  flows: [],
};
const V1: PrototypeFiles = { manifestText: JSON.stringify(manifest), manifest, source: "// one" };
const C = "expense-web";
const V2: PrototypeFiles = { ...V1, source: "// two" };
const app = (status: AppPrototype["status"], files: PrototypeFiles = V1): AppPrototype => ({ component: C, status, problem: null, files, exists: true });

describe("the review store", () => {
  it("keeps each project's sessions apart, and tells only that project's subscribers", () => {
    const reviews = createReviewStore();
    const told = vi.fn();
    reviews.subscribe("acme", told);
    reviews.change("other", C, (s) => ({ ...s, revising: true }));
    expect(told).not.toHaveBeenCalled();
    reviews.change("acme", C, (s) => ({ ...s, revising: true }));
    expect(told).toHaveBeenCalledTimes(1);
    expect(reviews.get("acme")[C]?.revising).toBe(true);
    expect(reviews.get("other")[C]?.revising).toBe(true);
  });

  it("hands out the same sessions while nothing changed", () => {
    const reviews = createReviewStore();
    reviews.follow("acme", [app("ready")]);
    const before = reviews.get("acme");
    reviews.follow("acme", [app("ready")]);
    expect(reviews.get("acme")).toBe(before);
  });

  it("announces a revision that landed with no review open, the next time the prototype is followed", () => {
    const reviews = createReviewStore();
    reviews.follow("acme", [app("ready")]);
    reviews.follow("acme", [app("revising")]);
    reviews.follow("acme", [app("ready", V2)]);
    expect(reviews.get("acme")[C]?.notice).toEqual({ kind: "updated" });
  });
});
