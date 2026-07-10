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
import { deriveCellDiagramProject } from "./deriveCellDiagram";

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

describe("deriveCellDiagramProject", () => {
  it("projects component design.json contents into a cell-diagram project", () => {
    const project = deriveCellDiagramProject({
      "specs/design/components/orders/design.json": designJson("orders"),
      "specs/design/components/web/design.json": designJson("web", [
        { kind: "component", name: "orders" },
      ]),
    });
    expect(project).not.toBeNull();
    expect(project!.components.map((c) => c.id).sort()).toEqual(["orders", "web"]);
  });

  it("returns null when there are no component design.json files", () => {
    expect(deriveCellDiagramProject({})).toBeNull();
  });

  it("degrades a malformed design.json to a default component (never throws)", () => {
    // @aep/design-projection's projectComponent is deliberately defensive: a
    // parse failure degrades to a default "service" component rather than
    // throwing, so one bad source never wedges the whole diagram.
    const project = deriveCellDiagramProject({
      "specs/design/components/x/design.json": "{ not json",
    });
    expect(project).not.toBeNull();
    expect(project!.components.map((c) => c.id)).toEqual(["x"]);
  });
});
