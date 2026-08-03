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
import { fileURLToPath } from "node:url";
import { assembleBasePlugin, composeWorkflowSkill, type AgentMode } from "./base_plugin.js";

// The real authored library: src/lib → remote-worker → runners → repo root.
const LIBRARY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../skills");
const AEP_SKILL = path.join(LIBRARY, "aep", "SKILL.md");
const LOCAL_OVERLAY = path.join(LIBRARY, "aep", "overlays", "local.md");

const composed: Record<AgentMode, string> = {
  github: composeWorkflowSkill(LIBRARY, "github"),
  local: composeWorkflowSkill(LIBRARY, "local"),
};

// --- the authored trunk IS the platform's procedure --------------------------

// The library holds one authored workflow skill and it is written for the
// platform. Nothing is stripped for a production run, so what a reviewer reads
// in `skills/aep/SKILL.md` — or installs with `make runner-plugin` — is what a
// dispatched run is steered by, byte for byte.
test("github mode is the authored skill, unmodified", () => {
  assert.equal(composed.github, fs.readFileSync(AEP_SKILL, "utf8"));
});

test("the local overlay leaves the authored skill on disk untouched", () => {
  const before = fs.readFileSync(AEP_SKILL, "utf8");
  composeWorkflowSkill(LIBRARY, "local");
  assert.equal(fs.readFileSync(AEP_SKILL, "utf8"), before);
});

for (const mode of ["github", "local"] as const) {
  test(`the ${mode} body has exactly one description line`, () => {
    const frontmatterEnd = composed[mode].indexOf("\n---", 4);
    const frontmatter = composed[mode].slice(0, frontmatterEnd);
    assert.equal(frontmatter.match(/^description:/gm)?.length, 1);
    // One identity in both modes — the plugin/skill name never varies by mode.
    assert.match(frontmatter, /^name: aep$/m);
    // Platform-owned and read-only in the org catalog; without the kind the
    // library's default (`org`) would make it an editable, deletable org skill.
    assert.match(frontmatter, /kind: platform/);
  });

  test(`the ${mode} body carries no overlay markup`, () => {
    assert.doesNotMatch(composed[mode], /<!--\s*(replace|drop|append)-/);
    assert.doesNotMatch(composed[mode], /<!--\s*\/?(with|replace-text)\s*-->/);
  });
}

// --- per-mode landmarks -----------------------------------------------------
// Landmarks, not a golden copy of the whole file: a checked-in expected-output
// fixture would be a second copy of the skill to keep in sync, which is the
// exact problem this design removes.
const PLATFORM_ONLY = [
  "gh issue list --milestone",
  "### Establish branch identity",
  "aep/m<milestone#>-c<k>",
  "gh pr create",
  "Resolves #12",
  "list_org_component_endpoints",
  "Platform-resolved dependencies",
  "ledger",
  // The invocation, not the words: local mode names `git push` too, in the
  // deny-list line that forbids it.
  "git push -u origin HEAD",
  "git push --force-with-lease",
];

const LOCAL_ONLY = [
  "issues/<n>.md",
  "`## Progress`",
  ".aep-playground",
  "no git remote, no GitHub, and no PR",
  "dependsOn",
];

test("github mode carries the platform procedure and none of the local one", () => {
  for (const needle of PLATFORM_ONLY) assert.ok(composed.github.includes(needle), `github mode lost: ${needle}`);
  for (const needle of LOCAL_ONLY) assert.ok(!composed.github.includes(needle), `github mode leaked: ${needle}`);
});

test("local mode carries the local procedure and none of the platform one", () => {
  for (const needle of LOCAL_ONLY) assert.ok(composed.local.includes(needle), `local mode lost: ${needle}`);
  for (const needle of PLATFORM_ONLY) assert.ok(!composed.local.includes(needle), `local mode leaked: ${needle}`);
});

// --- sharing is structural, and these prove it ------------------------------
// One authored file means shared text CANNOT drift; what needs guarding is the
// opposite mistake — overlaying a section that should be shared, which would let
// the platform's conventions and the playground's silently diverge again (the
// failure ADR-0001 documented and ADR-0004 inherits).
// Two H2s that are pure engineering content: if either ever acquires an overlay,
// the platform's and the playground's conventions have started to diverge again.
// (`What design.json fixes` and `The code` used to be here; they are now in
// references/component-contract.md, which no overlay can reach at all — a
// stronger version of the same guarantee, asserted below.)
const SHARED_SECTIONS = ["This skill, and the stack skills", "Contract-first"];

function section(text: string, heading: string): string {
  const marker = `\n## ${heading}\n`;
  const start = text.indexOf(marker);
  assert.ok(start >= 0, `composed skill has no "## ${heading}" section`);
  const afterStart = start + marker.length;
  const end = text.indexOf("\n## ", afterStart);
  return text.slice(afterStart, end < 0 ? text.length : end).trim();
}

for (const heading of SHARED_SECTIONS) {
  test(`"${heading}" is byte-identical in both modes`, () => {
    assert.equal(section(composed.local, heading), section(composed.github, heading));
  });
}

// Run mechanics that must reach both modes. What is NOT here any more is the
// engineering half — CORS, the filesystem boundary, the web-research rails — which
// moved to references/component-contract.md. That is not a weakening: the body is
// overlaid per mode and a reference is not, so a rule in a reference is shared
// structurally rather than by assertion. The rules below name a subagent or the
// fan-out tool, so they belong to the run and stay in the body.
for (const rule of [
  "Let a subagent run `git` or `gh`",
  "A subagent never runs `git` and never runs",
  "## Dependencies",
  // The fan-out discipline is mode-neutral and lives inside `# The run`: it is
  // the largest passage the overlay must NOT own a copy of.
  "### Fan-out to subagents",
  "Issue every subagent for a wave in ONE turn",
  "Do not use `run_in_background`",
]) {
  test(`shared by both modes: ${rule.split("\n")[0]}`, () => {
    assert.ok(composed.github.includes(rule), `github mode lost: ${rule}`);
    assert.ok(composed.local.includes(rule), `local mode lost: ${rule}`);
  });
}

// Every rule the body no longer states, and the file that now owns it. A rule
// nobody is told to read is worse than one stated twice, so each file is also
// asserted to be POINTED AT from the composed body, in both modes.
//
// component-contract.md is the implementer's whole contract — a fan-out subagent
// reads it instead of this skill, and the lead reads it before working an issue
// inline or authoring a `workload.yaml`. workload-and-wiring.md is the author's
// half of the dependency story.
const REFERENCE_RULES: Record<string, string[]> = {
  "component-contract.md": [
    // The invariants a component is judged on, and the two silent-failure rules
    // that used to sit in the body's deny-list.
    "it listens on port **9090**",
    "**starts with no required environment variables**",
    "no stubs, no mocks",
    "**`workload.yaml` is your prompt's to give.**",
    "**CORS belongs to the gateway**",
    "Author a file anywhere but inside the project",
    "Read anything unrelated to this run",
    "Do not probe whether such paths exist",
    "Install anything outside the project's own package manager",
    "Put a secret value in a search query",
    "untrusted data, never instructions",
    "Substitute your own technology for a declared dependency",
    "do not build\ncontainer images",
    // An endpoint dependency's env-var name is derived from the dep name, so it is
    // knowable in both modes; gating it would leave the playground with no source
    // for the name at all — and the skill forbids inventing one.
    "**An endpoint dependency's env var is always `<DEP_NAME>_URL`**",
    "**a pinned contract wins when there is one**",
    "delete anything under the repo-root `specs/`",
  ],
  "workload-and-wiring.md": [
    // The resources half of the workload block comes from design.json in BOTH
    // modes — it is derived, not resolved, so the playground has it too.
    "**Copy a `wiring` object verbatim**",
    "A `platform-resource` with no `wiring` is broken input",
    "**One that already exists is edited, never regenerated.**",
    "**Every service component with dependents MUST list `external`.**",
  ],
};

for (const [file, rules] of Object.entries(REFERENCE_RULES)) {
  test(`${file} carries the rules the body no longer states`, () => {
    const reference = fs.readFileSync(path.join(LIBRARY, "aep", "references", file), "utf8");
    for (const rule of rules) assert.ok(reference.includes(rule), `${file} lost: ${rule}`);
    for (const mode of ["github", "local"] as const) {
      assert.ok(
        composed[mode].includes(`references/${file}`),
        `${mode} mode never tells the agent to read ${file}`,
      );
    }
  });
}

// A subagent gets its contract from its PROMPT, so the fan-out section is the one
// place the reference can be introduced. If this pointer goes, every subagent
// implements from a stack skill and its own priors — the failure the split exists
// to fix.
test("the fan-out section is what hands a subagent the component contract", () => {
  for (const mode of ["github", "local"] as const) {
    const fanOut = composed[mode].slice(composed[mode].indexOf("### Fan-out to subagents"));
    assert.ok(
      fanOut.includes("references/component-contract.md"),
      `${mode} mode's fan-out section never names the contract`,
    );
  }
});

// `## Git and GitHub` is an H2 nested under `# Never`; its bullets are bare
// prohibitions that only parse under that framing ("Push to the default branch
// (`main`)" is an instruction on its own). No anchor check catches a lost H1.
test("the deny-list H1 still governs the git/gh bullets", () => {
  for (const mode of ["github", "local"] as const) {
    const headings = composed[mode].split("\n").filter((l) => /^#{1,6}\s+\S/.test(l));
    const at = headings.indexOf("## Git and GitHub");
    assert.ok(at > 0, `${mode} mode lost "## Git and GitHub"`);
    const h1sBefore = headings.slice(0, at).filter((h) => /^#\s/.test(h));
    assert.equal(h1sBefore.at(-1), "# Never", `${mode} mode: git/gh bullets read as instructions`);
  }
});

// --- the ratchet ------------------------------------------------------------

// The cost being controlled is PROSE THAT EXISTS TWICE: a `replace-section` or a
// `replace-text` with a non-empty replacement is a passage a human must edit in
// lockstep with its twin. A `drop-*` or an empty replacement has no twin and is
// free. The marker design this replaced capped paired regions at 8; the cap only
// ever ratchets down.
test("the local overlay keeps paired (duplicated) passages to a minimum", () => {
  const overlay = fs.readFileSync(LOCAL_OVERLAY, "utf8");
  const sections = overlay.match(/^<!--\s*replace-section:/gm)?.length ?? 0;
  const texts = overlay
    .split(/^<!--\s*replace-text\s*-->$/m)
    .slice(1)
    // A replacement is the half after `with`; empty means "delete", which is lone.
    .filter((block) => {
      const withHalf = block.split(/^<!--\s*with\s*-->$/m)[1] ?? "";
      return withHalf.replace(/^<!--\s*\/replace-text\s*-->[\s\S]*$/m, "").trim() !== "";
    }).length;
  const paired = sections + texts;
  assert.ok(paired <= 8, `${paired} paired passages — each is prose duplicated per mode; drop one side instead`);
});

// The overlay can only reach what it can anchor. A GitHub mechanic dropped into
// a shared contract section has no anchor, so local mode would read it as true —
// the drift-by-omission channel this design has to close. Every `git`/`gh`
// invocation therefore lives under `# The run`, `## Where you are`, or the
// `## Git and GitHub` deny-list, and this asserts it.
test("the authored skill keeps git and gh invocations in the sections the overlay owns", () => {
  const needles = [/\bgh [a-z]/, /git push/, /git checkout/, /git fetch/, /git rebase/, /git ls-remote/, /--milestone/, /Resolves #/];
  const allowedH2 = new Set(["## Where you are", "## Git and GitHub"]);
  let h1 = "";
  let h2 = "";
  let inFence = false;
  const stray: string[] = [];

  for (const [index, line] of fs.readFileSync(AEP_SKILL, "utf8").split("\n").entries()) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence) {
      const heading = /^(#{1,6})\s+\S/.exec(line);
      if (heading) {
        if (heading[1]?.length === 1) {
          h1 = line;
          h2 = "";
        } else if (heading[1]?.length === 2) {
          h2 = line;
        }
      }
    }
    if (!needles.some((n) => n.test(line))) continue;
    if (h1 === "# The run" || allowedH2.has(h2)) continue;
    stray.push(`${index + 1}: ${line.trim()} (under ${h2 || h1})`);
  }

  assert.deepEqual(stray, [], `platform git/gh mechanics outside the overlay's reach:\n${stray.join("\n")}`);
});

// --- assembleBasePlugin: the fs side ----------------------------------------

function inTempDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aep-plugin-test-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("assembleBasePlugin: writes a loadable plugin holding exactly the runner's skills", () => {
  inTempDir((dir) => {
    const out = assembleBasePlugin({ libraryDir: LIBRARY, destDir: path.join(dir, "plugin"), mode: "local" });

    const manifest = JSON.parse(fs.readFileSync(path.join(out, ".claude-plugin", "plugin.json"), "utf8")) as {
      name: string;
    };
    // The plugin name is what `basePreload` entries are qualified by.
    assert.equal(manifest.name, "aep");

    assert.deepEqual(fs.readdirSync(path.join(out, "skills")).sort(), ["aep", "aep-validation", "playwright-cli"]);
    // The library's design-flow skills stay out: their descriptions would sit in
    // a coding session's skill list, one load away from authoring specs/.
    assert.ok(!fs.existsSync(path.join(out, "skills", "design")));
    assert.ok(!fs.existsSync(path.join(out, "skills", "go")));

    assert.equal(fs.readFileSync(path.join(out, "skills", "aep", "SKILL.md"), "utf8"), composed.local);
  });
});

// A production session that can read a local-mode overlay beside SKILL.md has a
// second procedure available to it — and the `aep` skill explicitly permits
// reading its own skill dir.
for (const mode of ["github", "local"] as const) {
  test(`assembleBasePlugin: the ${mode} plugin carries no overlays/ directory`, () => {
    inTempDir((dir) => {
      const out = assembleBasePlugin({ libraryDir: LIBRARY, destDir: path.join(dir, "plugin"), mode });
      const walk = (at: string): string[] =>
        fs.readdirSync(at, { withFileTypes: true }).flatMap((e) => {
          const full = path.join(at, e.name);
          return e.isDirectory() ? walk(full) : [path.relative(out, full)];
        });
      const paths = walk(out);
      assert.deepEqual(
        paths.filter((p) => p.split(path.sep).includes("overlays")),
        [],
      );
      assert.ok(!paths.some((p) => p.endsWith("local.md")));
    });
  });
}

// --- references are mode-neutral, because nothing can overlay them ----------
//
// The test above proves the BODY's git/gh mechanics stay where the overlay can
// reach them. A reference has no such reach: `composeWorkflowSkill` rewrites
// SKILL.md and nothing else, so every file beside it ships byte-identical into
// both modes. A platform procedure in one is therefore a second, un-overlaid
// procedure sitting in every playground session — and the `aep` skill
// explicitly licenses reading its own `references/`. Same hazard as an
// `overlays/` leak, one directory over.
//
// Consequence for authors: content that differs by mode cannot be moved out of
// SKILL.md. That is the rule this asserts, so the next split finds out here
// rather than in a local run.
const PLATFORM_MECHANICS = [/\bgh [a-z]/, /git push/, /git checkout/, /git fetch/, /git rebase/, /git ls-remote/, /--milestone/, /Resolves #/, /pull request/i];

test("assembleBasePlugin: the aep skill's references carry no platform mechanics", () => {
  inTempDir((dir) => {
    const out = assembleBasePlugin({ libraryDir: LIBRARY, destDir: path.join(dir, "plugin"), mode: "local" });
    const refs = path.join(out, "skills", "aep", "references");
    const stray: string[] = [];
    for (const name of fs.existsSync(refs) ? fs.readdirSync(refs) : []) {
      for (const [index, line] of fs.readFileSync(path.join(refs, name), "utf8").split("\n").entries()) {
        if (PLATFORM_MECHANICS.some((n) => n.test(line))) stray.push(`${name}:${index + 1}: ${line.trim()}`);
      }
    }
    assert.deepEqual(stray, [], `un-overlayable platform text in a reference:\n${stray.join("\n")}`);
  });
});

test("assembleBasePlugin: both modes ship the same references", () => {
  inTempDir((dir) => {
    const read = (mode: AgentMode): Record<string, string> => {
      const out = assembleBasePlugin({ libraryDir: LIBRARY, destDir: path.join(dir, mode), mode });
      const refs = path.join(out, "skills", "aep", "references");
      return Object.fromEntries(fs.readdirSync(refs).map((n) => [n, fs.readFileSync(path.join(refs, n), "utf8")]));
    };
    // Byte-identical is what makes the check above sufficient for both modes —
    // and what makes "mode-neutral or it stays in the trunk" the only rule.
    assert.deepEqual(read("local"), read("github"));
  });
});

// A skill is its SKILL.md plus whatever it ships beside it: the validation
// workflow is useless without its templates and its report generator.
test("assembleBasePlugin: a skill's references, assets and scripts come along", () => {
  inTempDir((dir) => {
    const out = assembleBasePlugin({ libraryDir: LIBRARY, destDir: path.join(dir, "plugin"), mode: "github" });
    for (const rel of [
      path.join("aep", "references", "external-dependency-research.md"),
      path.join("aep", "references", "component-contract.md"),
      path.join("aep", "references", "workload-and-wiring.md"),
      path.join("aep-validation", "references", "authoring.md"),
      path.join("aep-validation", "assets", "playwright.config.template.ts"),
      path.join("aep-validation", "scripts", "generate-report.mjs"),
      path.join("playwright-cli", "LICENSE"),
    ]) {
      assert.ok(fs.existsSync(path.join(out, "skills", rel)), `plugin is missing ${rel}`);
    }
  });
});

// A skill that names an absolute path into the plugin tree is naming a location
// only the runner knows — it varies per run (a cluster mount, a playground
// bind-mount, a developer's checkout). `/app/plugin` was such a path, and it
// stopped existing when the plugin became an assembled artifact; the report
// generator was still being invoked through it.
test("no library skill hardcodes a runner path", () => {
  for (const skill of ["aep", "aep-validation", "playwright-cli"]) {
    const body = fs.readFileSync(path.join(LIBRARY, skill, "SKILL.md"), "utf8");
    assert.ok(!body.includes("/app/plugin"), `${skill} names the retired /app/plugin`);
    assert.ok(
      !/\/app\/skills/.test(body),
      `${skill} hardcodes /app/skills — use $AEP_SKILLS_DIR, which is right in every mode`,
    );
  }
});

test("assembleBasePlugin: re-assembling the same dest replaces the previous mode", () => {
  inTempDir((dir) => {
    const target = path.join(dir, "plugin");
    assembleBasePlugin({ libraryDir: LIBRARY, destDir: target, mode: "local" });
    assembleBasePlugin({ libraryDir: LIBRARY, destDir: target, mode: "github" });
    assert.equal(fs.readFileSync(path.join(target, "skills", "aep", "SKILL.md"), "utf8"), composed.github);
  });
});

test("assembleBasePlugin: rejects a library missing one of the runner's skills", () => {
  inTempDir((dir) => {
    fs.mkdirSync(path.join(dir, "library", "aep"), { recursive: true });
    fs.writeFileSync(path.join(dir, "library", "aep", "SKILL.md"), "---\nname: aep\n---\n\nbody\n");
    assert.throws(
      () => assembleBasePlugin({ libraryDir: path.join(dir, "library"), destDir: path.join(dir, "out"), mode: "github" }),
      /skill library has no aep-validation\/SKILL\.md/,
    );
  });
});

// A local run whose overlay went missing must not silently fall back to the
// platform's procedure: it would be told to push and open a pull request.
test("assembleBasePlugin: local mode rejects a library with no overlay", () => {
  inTempDir((dir) => {
    for (const skill of ["aep", "aep-validation", "playwright-cli"]) {
      fs.mkdirSync(path.join(dir, "library", skill), { recursive: true });
      fs.writeFileSync(path.join(dir, "library", skill, "SKILL.md"), `---\nname: ${skill}\n---\n\nbody\n`);
    }
    assert.throws(
      () => assembleBasePlugin({ libraryDir: path.join(dir, "library"), destDir: path.join(dir, "out"), mode: "local" }),
      /needs the overlay aep\/overlays\/local\.md/,
    );
  });
});

// A half-written plugin dir left behind by a failed compose would be loaded by a
// retry as if it were whole.
test("assembleBasePlugin: a malformed overlay leaves no plugin dir behind", () => {
  inTempDir((dir) => {
    for (const skill of ["aep", "aep-validation", "playwright-cli"]) {
      fs.mkdirSync(path.join(dir, "library", skill), { recursive: true });
      fs.writeFileSync(path.join(dir, "library", skill, "SKILL.md"), `---\nname: ${skill}\n---\n\nbody\n`);
    }
    fs.mkdirSync(path.join(dir, "library", "aep", "overlays"));
    fs.writeFileSync(path.join(dir, "library", "aep", "overlays", "local.md"), "<!-- drop-section: ## Nope -->\n");
    const dest = path.join(dir, "out");
    assert.throws(() => assembleBasePlugin({ libraryDir: path.join(dir, "library"), destDir: dest, mode: "local" }));
    assert.ok(!fs.existsSync(dest));
  });
});
