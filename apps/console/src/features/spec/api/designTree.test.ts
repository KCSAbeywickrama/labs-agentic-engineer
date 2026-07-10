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

// Full repo-relative paths, mirroring mapping.ts's current scheme
// (SpecFileEntry.path is the same specs/-prefixed path the Files API,
// collab doc, and agent writes all use — the unprefixed room-key scheme is
// retired). group is derived the same way mapping.toSpecEntry does.
const e = (path: string): SpecFileEntry => ({
  path,
  sha: path,
  group: path.startsWith("specs/requirements/")
    ? "requirements"
    : path.startsWith("specs/validation/")
      ? "validation"
      : "designs",
});

describe("componentOf", () => {
  it("extracts the component name from a component path", () => {
    expect(componentOf("specs/design/components/orders/design.json")).toBe("orders");
    expect(componentOf("specs/design/components/orders/wireframes.dsl")).toBe("orders");
  });
  it("returns null for non-component design paths", () => {
    expect(componentOf("specs/design/design.md")).toBeNull();
    expect(componentOf("specs/requirements/prd.md")).toBeNull();
  });
});

describe("buildDesignSection", () => {
  it("splits overview files from per-component groups and finds the wireframe dsl", () => {
    const section = buildDesignSection([
      e("specs/design/design.md"),
      e("specs/design/components/orders/design.json"),
      e("specs/design/components/orders/openapi.yaml"),
      e("specs/design/components/orders/wireframes.dsl"),
      e("specs/design/components/web/design.json"),
      e("specs/design/components/web/wireframes.dsl"),
      e("specs/requirements/prd.md"), // ignored: not a design file
    ]);

    expect(section.overview.map((f) => f.path)).toEqual(["specs/design/design.md"]);
    expect(section.hasComponents).toBe(true);
    expect(section.components.map((c) => c.name)).toEqual(["orders", "web"]);

    const orders = section.components[0]!;
    // The raw .dsl is NOT listed as a browsable file; it drives the wireframe entry.
    expect(orders.files.map((f) => f.path)).toEqual([
      "specs/design/components/orders/design.json",
      "specs/design/components/orders/openapi.yaml",
    ]);
    expect(orders.wireframeDslPath).toBe("specs/design/components/orders/wireframes.dsl");
  });

  it("omits the wireframe entry when a component has no .dsl", () => {
    const section = buildDesignSection([e("specs/design/components/api/design.json")]);
    expect(section.components[0]!.wireframeDslPath).toBeNull();
  });

  it("returns empty section when there are no design files", () => {
    const section = buildDesignSection([e("specs/requirements/prd.md")]);
    expect(section.hasComponents).toBe(false);
    expect(section.components).toEqual([]);
    expect(section.overview).toEqual([]);
  });
});
