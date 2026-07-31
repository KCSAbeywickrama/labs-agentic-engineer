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
 * Audience filtering (ADR-0013): a skill declares which agent its guidance is
 * written for, and this service — always the DESIGN side — lists the coding
 * agent's skills without letting itself load them. Visible because the design
 * agent has to name a skill to pin it onto a component; unloadable because the
 * body is guidance for work it does not do.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkillsFromSnapshot } from "../src/conversation/load-workspace.js";

/** A `_skills` snapshot holding the given `<name>/SKILL.md` files. */
function snapshotWith(skills: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "aep-skill-audience-"));
  for (const [name, md] of Object.entries(skills)) {
    const skillDir = join(dir, "skills", name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), md);
  }
  return dir;
}

/** A SKILL.md whose frontmatter declares `audience` only when one is given. */
const md = (name: string, audience?: string): string =>
  `---\nname: ${name}\ndescription: ${name} does things.\nmetadata:\n  aep:\n    kind: org\n` +
  (audience === undefined ? "" : `    audience: ${audience}\n`) +
  `---\n\nBODY of ${name}\n`;

test("audience is read from frontmatter; absent means every audience", () => {
  const source = loadSkillsFromSnapshot(
    snapshotWith({
      go: md("go", "[coding]"),
      wireframes: md("wireframes", "[design, coding]"),
      planning: md("planning", "[design]"),
      unmarked: md("unmarked"),
      bogus: md("bogus", "[nonsense]"),
    }),
  );
  const by = new Map(source.catalog().map((e) => [e.name, e.audience]));
  assert.deepEqual(by.get("go"), ["coding"]);
  assert.deepEqual(by.get("wireframes"), ["design", "coding"]);
  assert.deepEqual(by.get("planning"), ["design"]);
  // Nothing declared → permissive, so an org-authored skill keeps working.
  assert.deepEqual(by.get("unmarked"), ["design", "coding"]);
  // An unrecognised value is dropped rather than becoming a third audience,
  // which leaves nothing declared and so resolves permissively too.
  assert.deepEqual(by.get("bogus"), ["design", "coding"]);
});

test("every skill stays in the catalog regardless of audience", () => {
  // The design agent must be able to NAME a coding skill to pin it onto a
  // component; hiding the row would break that handoff (ADR-0013).
  const source = loadSkillsFromSnapshot(
    snapshotWith({ go: md("go", "[coding]"), planning: md("planning", "[design]") }),
  );
  assert.deepEqual(
    source.catalog().map((e) => e.name),
    ["go", "planning"],
  );
});

test("a coding-only skill is refused, not reported missing", () => {
  const source = loadSkillsFromSnapshot(
    snapshotWith({ go: md("go", "[coding]"), planning: md("planning", "[design]") }),
  );
  assert.deepEqual(source.load("go"), { refused: true });
  assert.equal(source.load("nope"), undefined); // unknown stays undefined
  const ok = source.load("planning");
  assert.ok(ok !== undefined && "content" in ok && ok.content.includes("BODY of planning"));
});

test("an unmarked skill is still loadable", () => {
  const source = loadSkillsFromSnapshot(snapshotWith({ legacy: md("legacy") }));
  const got = source.load("legacy");
  assert.ok(got !== undefined && "content" in got);
});
