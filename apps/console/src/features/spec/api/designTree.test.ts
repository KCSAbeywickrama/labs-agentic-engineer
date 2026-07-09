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
import { buildDesignSection, componentOf } from "./designTree";
import type { SpecFileEntry } from "./mapping";

// group is derived from the path prefix, mirroring mapping.toSpecEntry.
const e = (path: string): SpecFileEntry => ({
  path,
  sha: path,
  group: path.startsWith("requirements/")
    ? "requirements"
    : path.startsWith("validation/")
      ? "validation"
      : "designs",
});

describe("componentOf", () => {
  it("extracts the component name from a component path", () => {
    expect(componentOf("design/components/orders/design.json")).toBe("orders");
    expect(componentOf("design/components/orders/wireframes.dsl")).toBe("orders");
  });
  it("returns null for non-component design paths", () => {
    expect(componentOf("design/design.md")).toBeNull();
    expect(componentOf("requirements/prd.md")).toBeNull();
  });
});

describe("buildDesignSection", () => {
  it("splits overview files from per-component groups and finds the wireframe dsl", () => {
    const section = buildDesignSection([
      e("design/design.md"),
      e("design/components/orders/design.json"),
      e("design/components/orders/openapi.yaml"),
      e("design/components/orders/wireframes.dsl"),
      e("design/components/web/design.json"),
      e("design/components/web/wireframes.dsl"),
      e("requirements/prd.md"), // ignored: not a design file
    ]);

    expect(section.overview.map((f) => f.path)).toEqual(["design/design.md"]);
    expect(section.hasComponents).toBe(true);
    expect(section.components.map((c) => c.name)).toEqual(["orders", "web"]);

    const orders = section.components[0]!;
    // The raw .dsl is NOT listed as a browsable file; it drives the wireframe entry.
    expect(orders.files.map((f) => f.path)).toEqual([
      "design/components/orders/design.json",
      "design/components/orders/openapi.yaml",
    ]);
    expect(orders.wireframeDslPath).toBe("design/components/orders/wireframes.dsl");
  });

  it("omits the wireframe entry when a component has no .dsl", () => {
    const section = buildDesignSection([e("design/components/api/design.json")]);
    expect(section.components[0]!.wireframeDslPath).toBeNull();
  });

  it("returns empty section when there are no design files", () => {
    const section = buildDesignSection([e("requirements/prd.md")]);
    expect(section.hasComponents).toBe(false);
    expect(section.components).toEqual([]);
    expect(section.overview).toEqual([]);
  });
});
