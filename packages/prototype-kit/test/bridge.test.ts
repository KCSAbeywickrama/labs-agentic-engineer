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

/** The bridge's parser for what the (untrusted) frame sends: a data snapshot is kept only when it is JSON data. */

import { describe, expect, it } from "vitest";
import { parseFromFrameMessage } from "../src/host/bridge.js";

const data = (snapshot: unknown) => parseFromFrameMessage({ type: "proto:data", data: snapshot });

describe("parseFromFrameMessage — proto:data", () => {
  it("accepts collections and plain JSON values", () => {
    const snapshot = { company: "Acme", count: 3, flags: { a: true, b: null }, contacts: [{ id: "c-1", name: "Ada", tags: ["x"] }], empty: [] };
    expect(data(snapshot)).toEqual({ type: "proto:data", data: snapshot });
  });

  it.each([
    ["not an object", "text"],
    ["an array", []],
    ["null", null],
    ["a non-finite number", { n: Number.NaN }],
    ["a function-free but non-plain object", { d: new Date(0) }],
    ["undefined inside a record", { contacts: [{ id: "c-1", x: undefined }] }],
    ["a bigint", { n: 1n }],
  ])("ignores a snapshot that is %s", (_name, snapshot) => {
    expect(data(snapshot)).toBeNull();
  });

  it("ignores a cyclic snapshot", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(data(cyclic)).toBeNull();
  });
});
