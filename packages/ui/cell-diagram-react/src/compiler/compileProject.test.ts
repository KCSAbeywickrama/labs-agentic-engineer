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
import { compileProject } from "./compileProject";

describe("compileProject", () => {
  it("wraps a single-cell document in a one-cell ProjectModel", () => {
    const result = compileProject(`component API service\nnorth -> API`);
    expect(result.diagnostics).toEqual([]);
    expect(result.model?.cells).toHaveLength(1);
    expect(result.model?.cells[0].id).toBe("main");
    expect(result.model?.cells[0].components.map((c) => c.id)).toEqual(["API"]);
    expect(result.model?.crossEdges).toEqual([]);
    expect(result.model?.sharedExternals).toEqual([]);
  });

  it("marks an external used by two cells as shared", () => {
    const source = [
      "cell orders {", "  component api", "  api -> east s3", "}",
      "cell inventory {", "  component api", "  api -> south s3", "}"
    ].join("\n");
    const result = compileProject(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.model?.sharedExternals.map((e) => e.id)).toEqual(["s3"]);
    expect(result.model?.cells.flatMap((c) => c.externals.map((e) => e.id))).not.toContain("s3");
  });

  it("keeps a single-use external cell-local", () => {
    const source = ["cell orders {", "  component api", "  api -> east s3", "}", "cell inventory {", "  component api", "}"].join("\n");
    const result = compileProject(source);
    expect(result.model?.sharedExternals).toEqual([]);
    expect(result.model?.cells[0].externals.map((e) => e.id)).toEqual(["s3"]);
  });

  it("resolves a connected cross edge", () => {
    const ok = compileProject("cell a {\n  x -> b.y\n}\ncell b {\n  component y\n}");
    expect(ok.diagnostics).toEqual([]);
    expect(ok.model?.crossEdges[0]).toMatchObject({ sourceCell: "a", targetCell: "b", mode: "connected" });
  });

  it("reports an unknown target cell", () => {
    const bad = compileProject("cell a {\n  x -> zzz.y\n}");
    expect(bad.model).toBeNull();
    expect(bad.diagnostics.some((d) => /unknown cell/i.test(d.message))).toBe(true);
  });

  it("reports an unknown source cell for a top-level cross edge", () => {
    const result = compileProject("cell b {\n  component y\n}\nzzz.x -> b.y");
    expect(result.model).toBeNull();
    expect(result.diagnostics.some((d) => /unknown cell/i.test(d.message))).toBe(true);
  });

  it("keeps cell version and label", () => {
    const result = compileProject("cell orders as \"Order Cell\" {\n  version v2\n  component api\n}");
    expect(result.model?.cells[0]).toMatchObject({ id: "orders", label: "Order Cell", version: "v2" });
  });

  describe("tolerant mode", () => {
    it("returns a partial model alongside diagnostics instead of null", () => {
      const result = compileProject("cell a {\n  x -> zzz.y\n}", { tolerant: true });
      expect(result.model).not.toBeNull();
      expect(result.model?.cells[0].id).toBe("a");
      expect(result.diagnostics.some((d) => /unknown cell/i.test(d.message))).toBe(true);
    });

    it("renders an unclosed trailing cell block", () => {
      const result = compileProject("cell a {\n  component api", { tolerant: true });
      expect(result.model?.cells.map((c) => c.id)).toEqual(["a"]);
      expect(result.model?.cells[0].components.map((c) => c.id)).toEqual(["api"]);
      expect(result.diagnostics.some((d) => /unbalanced/i.test(d.message))).toBe(true);
    });

    it("does not change the default (non-tolerant) behavior", () => {
      const result = compileProject("cell a {\n  x -> zzz.y\n}");
      expect(result.model).toBeNull();
    });

    it("yields a monotonically growing model over successive DSL prefixes", () => {
      const lines = [
        "title Shop",
        "cell orders {",
        "  component api",
        "  component worker",
        "  api -> worker",
        "}",
        "cell inventory {",
        "  component store",
        "}"
      ];
      let previousCount = -1;
      for (let n = 1; n <= lines.length; n++) {
        const prefix = lines.slice(0, n).join("\n");
        const result = compileProject(prefix, { tolerant: true });
        expect(result.model).not.toBeNull();
        const count = result.model!.cells.reduce((sum, c) => sum + c.components.length, 0);
        expect(count).toBeGreaterThanOrEqual(previousCount);
        previousCount = count;
      }
      expect(previousCount).toBe(3);
    });
  });
});
