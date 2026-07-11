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
import { deriveCellDsl } from "./deriveCellDiagram";

const designJson = (name: string, deps: unknown[] = []) =>
  JSON.stringify({
    name,
    type: "service",
    version: "0.1.0",
    language: "Go",
    buildpack: "docker",
    appPath: name,
    entrypoint: "cmd/main",
    exposure: "internet",
    description: "x",
    dependencies: deps,
  });

describe("deriveCellDsl", () => {
  it("derives the cell DSL from component design.json contents", () => {
    const dsl = deriveCellDsl("shop", {
      "specs/design/components/orders/design.json": designJson("orders"),
      "specs/design/components/web/design.json": designJson("web", [
        { kind: "component", name: "orders" },
      ]),
    });
    expect(dsl).not.toBeNull();
    expect(dsl).toContain("title shop");
    expect(dsl).toContain("component orders as");
    expect(dsl).toContain("component web as");
    expect(dsl).toContain("web -> orders");
  });

  it("returns null when there are no component design.json files", () => {
    expect(deriveCellDsl("shop", {})).toBeNull();
  });

  it("skips a malformed design.json (never throws)", () => {
    const dsl = deriveCellDsl("shop", {
      "specs/design/components/x/design.json": "{ not json",
    });
    expect(dsl).toBeNull();
  });
});
