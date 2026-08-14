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
 * The UI design system is an ORGANIZATION decision, so swapping it must cost two
 * edits an org is allowed to make: add/remove the design-system skill, and
 * repoint `organization`'s "UI design system" section. `architecture` — which
 * writes the pin — is `kind: platform` and read-only in the console, so the
 * moment it (or any other skill) names a vendor, a swap needs a platform change
 * and the promise is broken. These tests pin that property, because prose drifts
 * and the failure is invisible until an org actually tries to swap.
 *
 * See "Swapping the UI design system" in skills/AGENTS.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mirrorLocalSkillLibrary } from "./local_skill_mirror.js";
import { listMirroredSkills, readSkillBodies, resolvePinnedSkills } from "./skills_presence.js";

// The real authored library: src/lib → remote-worker → runners → repo root.
const LIBRARY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../skills");

/** The shipped default. Only this skill and `organization` may name a vendor. */
const DEFAULT_DESIGN_SYSTEM = "astryx-design-system";
/** Vendor surface that must not leak into a vendor-neutral skill. */
const VENDOR = /astryx|@astryxdesign/i;

const read = (name: string): string => fs.readFileSync(path.join(LIBRARY, name, "SKILL.md"), "utf8");
const skillDirs = (): string[] =>
  fs
    .readdirSync(LIBRARY, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(LIBRARY, e.name, "SKILL.md")))
    .map((e) => e.name);

test("only `organization` and the design-system skill name a design system", () => {
  const allowed = new Set(["organization", DEFAULT_DESIGN_SYSTEM]);
  const offenders = skillDirs().filter((name) => !allowed.has(name) && VENDOR.test(read(name)));
  assert.deepEqual(
    offenders,
    [],
    `these skills name the design-system vendor, so swapping it would need more than the two org-owned edits: ${offenders.join(", ")}`,
  );
});

test("`architecture` pins by reading the org section, never a hardcoded name", () => {
  const arch = read("architecture");
  // It must send the reader to the org's section...
  assert.match(arch, /UI design system/, "architecture must point at the organization's UI design system section");
  // ...and must not carry a vendor name of its own: it is kind: platform, so a
  // name here is a name an org cannot change.
  assert.doesNotMatch(arch, VENDOR, "architecture is kind: platform — a vendor name here cannot be edited by an org");
});

test("`organization` is a pointer, not a second copy of the design system's rules", () => {
  const org = read("organization");
  assert.match(org, /##\s*UI design system/, "organization needs the section architecture reads");
  assert.match(org, new RegExp(DEFAULT_DESIGN_SYSTEM), "organization must name the default design system");
  // Restating the vendor's API here is the drift this indirection exists to
  // prevent — two places to state one rule is two places to disagree.
  assert.doesNotMatch(
    org,
    /@astryxdesign|stylex|VStack|xstyle/i,
    "organization must point at the skill, not restate its API",
  );
});

test("`react-webapp` delegates a verify slot the design system fills", () => {
  const rw = read("react-webapp");
  assert.match(
    rw,
    /design-system skill contributes one step/,
    "react-webapp owns the verify sequence, so it must name the delegated slot",
  );
  const ds = read(DEFAULT_DESIGN_SYSTEM);
  assert.match(ds, /##\s*Verify/, "a design-system skill must declare its Verify section");
});

test("the design-system skill is org-owned and coding-audience", () => {
  const ds = read(DEFAULT_DESIGN_SYSTEM);
  // `org` is what lets an org edit or delete it; `[coding]` is what puts it in
  // the project mirror at all (ADR-0014).
  assert.match(ds, /kind:\s*org/, "a design system must be org-kind so an org can replace it");
  assert.match(ds, /audience:\s*\[coding\]/, "a design system is built against, not designed with");
});

test("swapping the design system reaches the coding agent's prompt", async () => {
  // Two edits, in a copy of the real library: replace the skill, repoint the org
  // pointer. Nothing else — no platform skill is touched.
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), "ds-swap-lib-"));
  fs.cpSync(LIBRARY, lib, { recursive: true });
  fs.rmSync(path.join(lib, DEFAULT_DESIGN_SYSTEM), { recursive: true, force: true });
  fs.mkdirSync(path.join(lib, "acme-design-system"), { recursive: true });
  fs.writeFileSync(
    path.join(lib, "acme-design-system", "SKILL.md"),
    [
      "---",
      "name: acme-design-system",
      "description: ACME's design system. Apply to UI work in a web-application that pins this skill.",
      "metadata:",
      "  aep:",
      "    kind: org",
      "    audience: [coding]",
      "---",
      "",
      "# ACME Design System",
      "",
      "ACME_ONLY_MARKER",
      "",
      "## Verify",
      "",
      "```bash",
      "npx --no acme doctor",
      "```",
      "",
    ].join("\n"),
  );
  const orgPath = path.join(lib, "organization", "SKILL.md");
  fs.writeFileSync(orgPath, fs.readFileSync(orgPath, "utf8").replace(DEFAULT_DESIGN_SYSTEM, "acme-design-system"));

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ds-swap-proj-"));
  const pinned = ["aep", "aep-validation", "wireframes", "react-webapp", "acme-design-system"];
  fs.mkdirSync(path.join(workspace, "specs/design/components/web"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, "specs/design/components/web/design.json"),
    JSON.stringify({ type: "web-application", skillsPinned: pinned }),
  );

  await mirrorLocalSkillLibrary(lib, workspace, new Set(pinned), "local");
  const { preload, dangling } = await resolvePinnedSkills(workspace, pinned);
  const mirrored = await listMirroredSkills(workspace);
  const bodies = await readSkillBodies(workspace, preload);

  assert.ok(mirrored.includes("acme-design-system"), "the replacement must reach the project mirror");
  assert.ok(preload.includes("acme-design-system"), "a pinned design system must be preloaded, not merely listed");
  assert.match(bodies, /ACME_ONLY_MARKER/, "its body must land in the coding agent's system prompt");
  assert.ok(preload.includes("react-webapp"), "the stack skill is unaffected by the swap");
  assert.deepEqual(dangling, [], "no pin may dangle after a swap");
  // The old vendor must be gone from the prompt entirely — any residue means a
  // skill outside the two swap targets was still carrying it.
  assert.doesNotMatch(bodies, VENDOR, "the replaced design system must leave no trace in the prompt");
});
