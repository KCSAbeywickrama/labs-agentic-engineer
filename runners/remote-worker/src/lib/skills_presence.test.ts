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

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolvePinnedSkills } from "./skills_presence.js";

async function tmpTree(files: Record<string, string>): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "aep-skills-presence-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, content);
  }
  return root;
}

test("resolvePinnedSkills: all present → all preloaded, none dangling", async () => {
  const ws = await tmpTree({
    ".claude/skills/go/SKILL.md": "---\nname: go\n---\n\n# go\n",
    ".claude/skills/react-webapp/SKILL.md": "---\nname: react-webapp\n---\n\n# react-webapp\n",
  });
  const out = await resolvePinnedSkills(ws, ["go", "react-webapp"]);
  assert.deepEqual(out.preload, ["go", "react-webapp"]);
  assert.deepEqual(out.dangling, []);
});

test("resolvePinnedSkills: a missing one is reported and the rest still preload", async () => {
  const ws = await tmpTree({
    ".claude/skills/go/SKILL.md": "---\nname: go\n---\n\n# go\n",
  });
  const lines: string[] = [];
  const out = await resolvePinnedSkills(ws, ["go", "does-not-exist"], (l) => lines.push(l));
  assert.deepEqual(out.preload, ["go"]);
  assert.deepEqual(out.dangling, ["does-not-exist"]);
  assert.ok(
    lines.some((l) => l.includes("does-not-exist")),
    `expected a dangling-pin warning, got ${JSON.stringify(lines)}`,
  );
});

test("resolvePinnedSkills: no .claude/skills/ at all → everything dangling, no throw", async () => {
  const ws = await tmpTree({ "README.md": "no skills mirror here" });
  const out = await resolvePinnedSkills(ws, ["go", "react-webapp"]);
  assert.deepEqual(out.preload, []);
  assert.deepEqual(out.dangling, ["go", "react-webapp"]);
});

test("resolvePinnedSkills: empty pin list → empty result, no fs access", async () => {
  const ws = await tmpTree({ "README.md": "no skills mirror here" });
  const out = await resolvePinnedSkills(ws, []);
  assert.deepEqual(out, { preload: [], dangling: [] });
});
