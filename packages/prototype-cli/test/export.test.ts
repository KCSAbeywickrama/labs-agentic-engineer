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

/** `prototype export`: one self-contained HTML file, written only for a clean prototype. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyFixture, runCli, tempDir } from "./harness.js";

describe("prototype export", () => {
  it("writes <dir>/prototype.html by default, with everything inline and a no-network CSP", () => {
    const dir = copyFixture("valid/contacts");
    const run = runCli(["export", dir]);
    expect(run.status).toBe(0);
    const html = readFileSync(join(dir, "prototype.html"), "utf8");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain('id="proto-config"');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
  });

  it("writes to -o", () => {
    const dir = copyFixture("valid/contacts");
    const out = join(tempDir(), "contacts.html");
    expect(runCli(["export", dir, "-o", out]).status).toBe(0);
    expect(existsSync(out)).toBe(true);
  });

  it("refuses a prototype with findings, prints them, and writes nothing", () => {
    const dir = copyFixture("invalid/source-fetch");
    const run = runCli(["export", dir]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("FORBIDDEN_API");
    expect(existsSync(join(dir, "prototype.html"))).toBe(false);
  });
});
