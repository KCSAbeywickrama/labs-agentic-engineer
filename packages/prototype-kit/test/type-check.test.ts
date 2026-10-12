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
 * The type stage: what transpiling erases and only the source's own types can
 * tell. The fixture is a real design agent run whose field rename left one
 * stale use; it passed every other stage.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { checkPrototypeFiles } from "../src/check/index.js";
import { checkSourceTypes, MAX_TYPE_FINDINGS } from "../src/check/types.js";
import { parseManifestJson } from "../src/manifest/parse.js";
import { sourceReferenceFindings } from "../src/source/references.js";
import { checkSource } from "../src/source/static-check.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "stale-field");
const STALE = readFileSync(join(FIXTURE, "prototype.tsx"), "utf8");
const MANIFEST = readFileSync(join(FIXTURE, "prototype.json"), "utf8");
/** The same prototype with the rename finished. */
const RENAMED = STALE.replaceAll("c.totalAmountCents", "c.totalCents");

const lineOf = (text: string, needle: string) => text.split("\n").findIndex((l) => l.includes(needle)) + 1;

/** Never reached: the type stage refuses before anything renders. */
const NO_THEME = { name: "none", frameRuntimePath: "/nonexistent/frame-runtime.js", checkRuntimePath: "/nonexistent/check-runtime.js" };

const tiny = (body: string) => `
import { Heading, Screen, defineApp, useCollection } from "@wso2/prototype-kit";

interface Claim { id: string; totalCents: number }

function Home() {
  const claims = useCollection<Claim>("claims");
  ${body}
}

export default defineApp({ screens: { "screen.home": Home }, data: { claims: [] as Claim[] } });
`;

describe("the type stage", () => {
  // The first check in a process reads and parses the standard library's,
  // React's and the kit's declarations. Paid once here, so each test below
  // times only its own check; on a shared CI runner that first parse alone
  // can take several seconds.
  beforeAll(() => {
    checkSourceTypes(RENAMED);
  }, 30_000);

  it("is what catches the stale field: every earlier stage passes it", () => {
    const parsed = parseManifestJson(MANIFEST);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.findings));
    expect(checkSource(STALE)).toEqual([]);
    expect(sourceReferenceFindings(STALE, parsed.manifest)).toEqual([]);
  });

  it("refuses the stale field with its line and the property it names", async () => {
    const findings = await checkPrototypeFiles({ manifest: MANIFEST, source: STALE }, { theme: NO_THEME });
    expect(findings).toEqual([
      {
        code: "TYPE_ERROR",
        file: "prototype.tsx",
        location: `line ${lineOf(STALE, "money(c.totalAmountCents)")}`,
        message: "Property 'totalAmountCents' does not exist on type 'Claim'.",
      },
    ]);
  });

  it("passes the prototype once the rename is finished", () => {
    expect(checkSourceTypes(RENAMED)).toEqual([]);
  });

  it("refuses a prop a kit component does not have", () => {
    const findings = checkSourceTypes(tiny(`return <Screen><Heading id="heading.home" txt="Home" /></Screen>;`));
    expect(findings.map((f) => [f.code, f.location])).toEqual([["TYPE_ERROR", "line 8"]]);
    expect(findings[0]?.message).toMatch(/'txt' does not exist/);
  });

  it("reads a collection's records as the type the screen names, and without one as nothing but an id", () => {
    const read = `return <Screen><Heading id="heading.home" text={String(claims.items[0]?.totalCents)} /></Screen>;`;
    expect(checkSourceTypes(tiny(read))).toEqual([]);
    const untyped = tiny(read).replace('useCollection<Claim>("claims")', 'useCollection("claims")');
    expect(checkSourceTypes(untyped).map((f) => [f.code, f.message])).toEqual([
      ["TYPE_ERROR", "Property 'totalCents' does not exist on type '{ id: string; }'."],
    ]);
  });

  it("lists at most MAX_TYPE_FINDINGS, in line order", () => {
    const many = Array.from({ length: MAX_TYPE_FINDINGS + 5 }, (_, i) => `const x${i}: number = claims.items[0].stale${i};`).join("\n  ");
    const findings = checkSourceTypes(tiny(`${many}\n  return <Screen><Heading id="heading.home" text="Home" /></Screen>;`));
    expect(findings).toHaveLength(MAX_TYPE_FINDINGS);
    const lines = findings.map((f) => Number(f.location.replace("line ", "")));
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    expect(findings[0]?.message).toMatch(/'stale0' does not exist/);
  });

  it("parses the declarations once: a warm check reads none of them again", () => {
    const readFile = vi.spyOn(ts.sys, "readFile");
    try {
      checkSourceTypes(STALE);
      // package.json lookups are the compiler's own per-program module resolution, not a re-parse.
      const reread = readFile.mock.calls.map(([fileName]) => fileName).filter((f) => !f.endsWith("/package.json"));
      expect(reread).toEqual([]);
    } finally {
      readFile.mockRestore();
    }
  });
});
