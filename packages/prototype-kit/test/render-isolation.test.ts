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

/**
 * The isolated render's own boundary, below the static rules: the source here
 * goes to `checkRenderIsolated` directly, so it reaches the global object by
 * name (which `checkSource` would refuse) and must still get no host `Function`.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRenderIsolated } from "../src/check/render.js";
import type { PrototypeManifest } from "../src/manifest/types.js";

/** A runtime that only runs the module: no React, no theme. */
const STUB_RUNTIME = `globalThis.__protoPrototypeCheck = () => { __protoModuleFactory(() => ({}), { exports: {} }, {}); return "[]"; };`;

function run(source: string) {
  const dir = mkdtempSync(join(tmpdir(), "proto-isolation-"));
  const checkRuntimePath = join(dir, "check-runtime.js");
  writeFileSync(checkRuntimePath, STUB_RUNTIME);
  return checkRenderIsolated({} as PrototypeManifest, source, { name: "stub", checkRuntimePath });
}

describe("render isolation", () => {
  it("gives the context no host Function through the global object's constructor chain", () => {
    const findings = run(`const g = globalThis as any;\nexport default g["constr" + "uctor"]["constr" + "uctor"]("return typeof process")();\n`);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: "RENDER_FAILED", location: "module" });
    expect(findings[0]?.message).toMatch(/Code generation from strings disallowed/);
  });

  it("runs a plain module cleanly", () => {
    expect(run(`export default 1;\n`)).toEqual([]);
  });
});
