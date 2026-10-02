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
 * `prototype check --json` over fixture folders: one valid folder per
 * shipped example, one invalid folder per finding. Each row asserts the exit
 * code and the exact codes, files and locations an agent would act on.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkJson, fixturePath, tempDir } from "./harness.js";

type Expected = [code: string, file: string, location: string];

interface Row {
  fixture: string;
  findings: Expected[];
  /** A pattern the first finding's message must match. */
  message?: RegExp;
}

const valid = ["baseline"];

const invalid: Row[] = [
  { fixture: "missing-source", findings: [["MISSING_FILE", "prototype.tsx", "(file)"]] },
];

describe("prototype check --json", () => {
  it.each(valid)("passes the valid fixture %s with exit 0", (name) => {
    const { status, ok, findings } = checkJson(fixturePath(`valid/${name}`));
    expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
    expect(ok).toBe(true);
    expect(status).toBe(0);
  });

  it.each(invalid)("reports $fixture", ({ fixture, findings: expected, message }) => {
    const { status, ok, findings } = checkJson(fixturePath(`invalid/${fixture}`));
    expect(findings.map((f): Expected => [f.code, f.file, f.location]), JSON.stringify(findings, null, 2)).toEqual(expected);
    if (message) expect(findings[0]?.message).toMatch(message);
    expect(ok).toBe(false);
    expect(status).toBe(1);
  });

  it("reports both files of a folder that has neither", () => {
    const { status, findings } = checkJson(join(tempDir(), "nothing-here"));
    expect(findings.map((f): Expected => [f.code, f.file, f.location])).toEqual([
      ["MISSING_FILE", "prototype.json", "(file)"],
      ["MISSING_FILE", "prototype.tsx", "(file)"],
    ]);
    expect(status).toBe(1);
  });
});
