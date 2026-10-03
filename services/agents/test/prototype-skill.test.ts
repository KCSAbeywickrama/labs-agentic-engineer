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
 * The prototype skill teaches the v3 pair (a manifest and a React module over
 * the kit), and the kit is the source of truth for it. These pin the two
 * together: the skill's kit block IS the kit's own generated `reference.md`
 * (pasted by `pnpm --filter @aep/agents gen`), and the skill's worked example
 * is a pair the kit's check, render included, accepts: an example the gate
 * refuses teaches the agent to be refused.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkPrototypeFiles, resolveTheme } from "@wso2/prototype-kit/check";
import { loadSkillsFromSnapshot } from "../src/conversation/load-workspace.js";
import { eagerSkillsFor } from "../src/prompts/turn.js";
import { KIT_REFERENCE, kitBlock, kitBlockOf, PROTOTYPE_SKILL_PATH } from "../scripts/prototype-skill-reference.js";

const SKILLS_DIR = path.resolve(fileURLToPath(import.meta.url), "../../../../skills");
const SKILL = fs.readFileSync(PROTOTYPE_SKILL_PATH, "utf8");

/** The skill's prose with line wrapping undone, so a phrase matches across a break. */
const PROSE = SKILL.replace(/\s+/g, " ");

test("the skill's kit block is the kit's reference, verbatim", () => {
  assert.equal(
    kitBlockOf(SKILL),
    kitBlock(fs.readFileSync(KIT_REFERENCE, "utf8")),
    "skills/prototype/SKILL.md is stale against the kit: run `pnpm --filter @aep/agents gen`",
  );
});

test("the skill's worked example is a prototype pair the kit's check accepts", () => {
  const manifest = /```json\n([\s\S]*?)\n```/.exec(SKILL)?.[1];
  const source = /```tsx\n([\s\S]*?)\n```/.exec(SKILL)?.[1];
  assert.ok(manifest && source, "the skill carries a manifest and a screens example");
  assert.equal((JSON.parse(manifest) as { schemaVersion: unknown }).schemaVersion, 3);
  const theme = resolveTheme("@wso2/prototype-theme-default", [import.meta.dirname]);
  assert.deepEqual(checkPrototypeFiles({ manifest, source }, { theme }), []);
});

test("the skill describes the Oxygen look but never has the source name a theme", () => {
  assert.match(PROSE, /### The Oxygen look/);
  assert.match(PROSE, /the source never imports one/i);
  const source = /```tsx\n([\s\S]*?)\n```/.exec(SKILL)?.[1] ?? "";
  assert.doesNotMatch(source, /oxygen|prototype-theme/i);
});

// Live bug: asked for an account button and sign-out on a screen, the design
// agent declined, claiming the platform draws a user menu on every screen. The
// skill has to say exactly what the renderer draws.
test("the skill says the review renderer draws only the screen's components and its navigation", () => {
  assert.match(PROSE, /renderer draws only/i);
  assert.match(PROSE, /`<Screen nav>`/);
  assert.match(PROSE, /no header, user menu, account menu, sign-out/i);
  assert.match(PROSE, /model it in the kit/i);
  assert.match(PROSE, /outside the kit/i);
});

test("the skill explains the screens: one per manifest screen, shared navigation, hooks, overlays, data", () => {
  assert.match(PROSE, /One component per manifest screen/);
  assert.match(PROSE, /exactly the manifest's screens/);
  assert.match(PROSE, /pass it to every `<Screen nav>`/);
  assert.match(PROSE, /useDisplayState\(\)/);
  assert.match(PROSE, /useRole\(\)/);
  assert.match(PROSE, /draw \*\*without\*\* params/);
  assert.match(PROSE, /Overlays are the screen's own state/);
  assert.match(PROSE, /`defineApp\(\{ data \}\)`/);
  assert.match(PROSE, /`useCollection\(name\)`/);
  assert.match(PROSE, /raw HTML elements/);
  assert.match(PROSE, /Math\.random\(\)/);
});

test("the skill writes the manifest first, whole new files once, and revisions as edits", () => {
  assert.match(PROSE, /keeps every key and id whose thing still exists/i);
  assert.match(PROSE, /Write it \*\*first\*\*/);
  assert.match(PROSE, /ONE `addFile` of the whole file/);
  assert.match(PROSE, /with `editFile` edits/);
});

test("the skill derives roles verbatim from security.json and reads the stories, flows and API", () => {
  assert.match(PROSE, /copied verbatim/);
  assert.match(PROSE, /specs\/design\/security\.json/);
  assert.match(PROSE, /specs\/requirements\/prd\.md/);
  assert.match(PROSE, /specs\/design\/flows\/\*\.md/);
  assert.match(PROSE, /`openapi\.yaml` of every component/);
  assert.match(PROSE, /Every story gets at least one screen/);
  assert.match(PROSE, /Every flow a web-application's users walk becomes a `flows` entry/);
});

test("the skill asks for validation-error and failure states where the API has error responses", () => {
  assert.match(PROSE, /error responses/i);
  assert.match(PROSE, /state\.validation-error/);
  assert.match(PROSE, /state\.failed/);
  assert.match(PROSE, /state\.delayed/);
});

test("every skill /prototype inlines is design-readable, so the flow can load it", () => {
  const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), "aep-prototype-skills-"));
  try {
    for (const name of eagerSkillsFor({ kind: "flow", skill: "prototype" })) {
      const dir = path.join(snapshot, "skills", name);
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(path.join(SKILLS_DIR, name, "SKILL.md"), path.join(dir, "SKILL.md"));
    }
    const catalog = loadSkillsFromSnapshot(snapshot).catalog();
    for (const entry of catalog) {
      assert.ok(entry.audience.includes("design"), `${entry.name} is not for the design side, so /prototype cannot load it`);
    }
    assert.equal(catalog.length, eagerSkillsFor({ kind: "flow", skill: "prototype" }).length);
  } finally {
    fs.rmSync(snapshot, { recursive: true, force: true });
  }
});
