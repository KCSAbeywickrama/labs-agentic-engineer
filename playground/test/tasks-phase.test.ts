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
 * Tasks-phase tests: the issue file's round trip, and `tasks` end to end over
 * the REAL task-plan toolset (mock model) on the Turn socket, with the
 * `cmd/build-plan` runner injected: the selection is passed to it, its scope
 * reaches the plan turn, the last ok planBuild becomes ONE build issue holding
 * its render, and the version is recorded only then.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mockModel, type MockStep } from "@aep/ae-design-agent/shared/mock-model";
import { tasksCommand } from "../src/commands.js";
import type { BuildPlanRunner } from "../src/engine/build-plan.js";
import type { DeriveOutcome } from "../src/engine/design-derive.js";
import { checklistDone, FsIssueStore, parseIssueFile, renderIssueFile } from "../src/ports/issue-store.js";
import { loadProjectState } from "../src/state/project.js";

test("an issue file round-trips, and its checklist ticks are read", () => {
  const body = "Version `v1`.\n\n- [x] **foundation** Shared setup: `api`.\n- [ ] **F1** Claims: `api`, `web`.\n";
  const file = renderIssueFile({ issueNumber: 4, title: 'Build "v1"', version: "v1", body });
  assert.equal(file, '---\nissueNumber: 4\ntitle: "Build \\"v1\\""\nversion: "v1"\n---\n\n' + body);
  const issue = parseIssueFile("issues/4.md", 4, file)!;
  assert.equal(issue.title, 'Build "v1"');
  assert.equal(issue.version, "v1");
  assert.equal(issue.body, body);
  assert.deepEqual(issue.items, [
    { item: "foundation", done: true },
    { item: "F1", done: false },
  ]);
  assert.equal(checklistDone(issue), false);
  assert.equal(parseIssueFile("issues/5.md", 5, "no frontmatter"), null);
  const handWritten = parseIssueFile("issues/6.md", 6, "---\ntitle: Fix the login\n---\n\nIt 500s.\n")!;
  assert.equal(handWritten.issueNumber, 6, "the number falls back to the file name");
  assert.equal(handWritten.version, undefined);
});

test("the checklist reader agrees with aep-api's build issue reader", () => {
  // Byte-identical to the BuildIssue.Body() golden in
  // services/aep-api/internal/platform/taskplan/build_issue_test.go: change both together.
  const body =
    "Version `v2`: the spec is `specs/` at tag `v2`.\n\n" +
    "- [ ] **foundation** Shared setup and product-wide requirements: `hello-api`, `hello-webapp`. Sign-in on both.\n" +
    "- [ ] **F1** Greeting page: `hello-api`, `hello-webapp`. The greeting.\n" +
    "- [ ] **F3** Edit greeting: `hello-api`.\n" +
    "\nProduct-wide: P1\nHeld back: F3.4\n";
  const issue = parseIssueFile("issues/7.md", 7, renderIssueFile({ issueNumber: 7, title: "Build v2", version: "v2", body }))!;
  assert.deepEqual(issue.items, [
    { item: "foundation", done: false },
    { item: "F1", done: false },
    { item: "F3", done: false },
  ]);
  const unclosed = parseIssueFile("issues/8.md", 8, "---\ntitle: t\n---\n\n- [ ] **F1\n- [ ] **F2** x\n")!;
  assert.deepEqual(unclosed.items, [{ item: "F2", done: false }], "an item never spans lines");
});

const VALID_DESIGN = (name: string, type: string): string =>
  JSON.stringify({
    name,
    type,
    version: "0.1.0",
    language: "go",
    buildpack: "docker",
    appPath: `./${name}`,
    entrypoint: "cmd/main.go",
    exposure: "internet",
    dependencies: [],
    description: `${name} component`,
  });

function seedDesignedProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "aep-play-tasks-"));
  mkdirSync(join(dir, "specs/requirements"), { recursive: true });
  writeFileSync(join(dir, "specs/requirements/prd.md"), "# R\n");
  for (const [name, type] of [["claims-api", "service"], ["claims-web", "web-application"]] as const) {
    mkdirSync(join(dir, "specs/design/components", name), { recursive: true });
    writeFileSync(join(dir, "specs/design/components", name, "design.json"), VALID_DESIGN(name, type));
  }
  writeFileSync(join(dir, "specs/design/design.cell"), "title R\n\ncomponent claims-api service\ncomponent claims-web web-application\n");
  return dir;
}

function tempSkills(): string {
  const dir = mkdtempSync(join(tmpdir(), "aep-play-skills-"));
  mkdirSync(join(dir, "task-planning"), { recursive: true });
  writeFileSync(join(dir, "task-planning", "SKILL.md"), "---\nname: task-planning\ndescription: plan the build\n---\n\nPlan.\n");
  return dir;
}

const SCOPE = { tag: "v1", features: [{ id: "F1", name: "Claims" }, { id: "F2", name: "Approvals", needs: ["F1"] }] };

/** A `cmd/build-plan` stand-in: answers `scope` with SCOPE, `issue` with a body naming the items; records each call. */
function fakeBuildPlan(calls: { args: string[]; stdin?: string }[], overrides: { scopeCode?: number; stderr?: string } = {}): BuildPlanRunner {
  return async (args, stdin) => {
    calls.push({ args, ...(stdin !== undefined ? { stdin } : {}) });
    if (args[0] === "scope") {
      if (overrides.scopeCode) return { code: overrides.scopeCode, stdout: "", stderr: overrides.stderr ?? "" };
      const plan = { features: ["F1", "F2"], pulledIn: ["F1"], productWide: [], heldBack: [] };
      return { code: 0, stdout: JSON.stringify({ plan, scope: SCOPE }), stderr: "" };
    }
    const { items } = JSON.parse(stdin ?? "{}") as { items: { item: string }[] };
    const body = "Version `v1`.\n\n" + items.map((i) => `- [ ] **${i.item}** x: \`claims-api\`.`).join("\n") + "\n";
    return { code: 0, stdout: JSON.stringify({ title: "Build v1", body }), stderr: "" };
  };
}

/** The pre-tag derivation stand-in: nothing to derive. */
const noDerive = async (): Promise<DeriveOutcome> => ({ ok: true, changed: [] });

const planBuild = (id: string, items: string[]): MockStep => ({
  kind: "toolCall",
  toolCallId: id,
  toolName: "planBuild",
  input: { items: items.map((item) => ({ item, components: ["claims-api"], note: `Build ${item}.` })) },
});

test("tasks: the selection's scope reaches the plan, its last ok planBuild becomes one build issue, and the version is recorded", async () => {
  const projectDir = seedDesignedProject();
  const skillsDir = tempSkills();
  const calls: { args: string[]; stdin?: string }[] = [];
  try {
    const model = mockModel([
      planBuild("p1", ["F2", "F1"]), // refused: F2 needs F1
      planBuild("p2", ["F1", "F2"]),
      planBuild("p3", ["foundation", "F1", "F2"]),
      { kind: "text", text: "Planned." },
    ]);
    const outcome = await tasksCommand(projectDir, { model, skillsDir, silent: true, features: ["F2"], deriveDesign: noDerive, buildPlan: fakeBuildPlan(calls) });
    assert.equal(outcome.ok, true, outcome.detail);

    assert.deepEqual(calls[0]!.args.slice(0, 1), ["scope"]);
    assert.ok(calls[0]!.args.join(" ").includes("--version v1 --features F2"), calls[0]!.args.join(" "));
    // scope runs POST /build's gate over the design and the acceptance files; issue gates nothing.
    const flag = (args: string[], name: string): string | undefined => args[args.indexOf(name) + 1];
    assert.equal(flag(calls[0]!.args, "--design-dir"), join(projectDir, "specs", "design"));
    assert.equal(flag(calls[0]!.args, "--acceptance-dir"), join(projectDir, "specs", "validation", "acceptance"));
    assert.equal(calls[1]!.args.includes("--design-dir"), false, "issue takes no gate folders");
    assert.deepEqual(JSON.parse(calls[1]!.stdin!).items.map((i: { item: string }) => i.item), ["foundation", "F1", "F2"], "the last ok plan is rendered");

    const issues = new FsIssueStore(projectDir).list();
    assert.equal(issues.length, 1, "one build issue");
    assert.equal(issues[0]!.title, "Build v1");
    assert.equal(issues[0]!.version, "v1");
    assert.deepEqual(issues[0]!.items.map((i) => i.item), ["foundation", "F1", "F2"]);
    assert.deepEqual(loadProjectState(projectDir, "p").versions, [{ tag: "v1", features: ["F1", "F2"], productWide: [] }]);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(skillsDir, { recursive: true, force: true });
  }
});

test("tasks: a later version waits for the earlier one's checklist, then carries what was built", async () => {
  const projectDir = seedDesignedProject();
  const skillsDir = tempSkills();
  const calls: { args: string[]; stdin?: string }[] = [];
  try {
    const first = mockModel([planBuild("p1", ["F1", "F2"]), { kind: "text", text: "ok" }]);
    assert.equal((await tasksCommand(projectDir, { model: first, skillsDir, silent: true, deriveDesign: noDerive, buildPlan: fakeBuildPlan(calls) })).ok, true);

    const waiting = await tasksCommand(projectDir, { model: mockModel([]), skillsDir, silent: true, deriveDesign: noDerive, buildPlan: fakeBuildPlan(calls) });
    assert.equal(waiting.ok, false);
    assert.match(waiting.detail ?? "", /issues\/1\.md \(Build v1\) still has unticked items/);

    const file = join(projectDir, "issues/1.md");
    writeFileSync(file, readFileSync(file, "utf8").replaceAll("- [ ]", "- [x]"));
    calls.length = 0;
    const second = mockModel([planBuild("p2", ["F1", "F2"]), { kind: "text", text: "ok" }]);
    assert.equal((await tasksCommand(projectDir, { model: second, skillsDir, silent: true, features: ["F3"], deriveDesign: noDerive, buildPlan: fakeBuildPlan(calls) })).ok, true);
    const args = calls[0]!.args.join(" ");
    assert.ok(args.includes("--version v2") && args.includes("--built-features F1,F2"), args);
    assert.equal(new FsIssueStore(projectDir).list().length, 2);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(skillsDir, { recursive: true, force: true });
  }
});

test("tasks: a design POST /build's gate refuses never plans; the gate's findings are the refusal", async () => {
  const projectDir = seedDesignedProject();
  const skillsDir = tempSkills();
  const calls: { args: string[]; stdin?: string }[] = [];
  try {
    const stderr =
      "specs/design/design.cell: story F1.1 is in the requirements but no component's design.json lists it in `stories` — extend the design or drop the story\n" +
      'specs/design/components/claims-web/prototype.tsx: component "claims-web" has prototype.tsx but no prototype.json — a prototype is both files; write the missing one or remove the other\n';
    const refused = await tasksCommand(projectDir, {
      model: mockModel([planBuild("p1", ["F1"]), { kind: "text", text: "ok" }]),
      skillsDir,
      silent: true,
      deriveDesign: noDerive, buildPlan: fakeBuildPlan(calls, { scopeCode: 1, stderr }),
    });
    assert.equal(refused.ok, false);
    assert.match(refused.detail ?? "", /^the build is refused: specs\/design\/design\.cell: story F1\.1 .*; specs\/design\/components\/claims-web\/prototype\.tsx: /);
    assert.deepEqual(calls.map((c) => c.args[0]), ["scope"], "no plan turn and no issue render after a refusal");
    assert.equal(existsSync(join(projectDir, "issues")), false, "no issue written");
    assert.deepEqual(loadProjectState(projectDir, "p").versions, []);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(skillsDir, { recursive: true, force: true });
  }
});

test("tasks: production's pre-tag derivation runs before the gate, and its refusal plans nothing", async () => {
  const projectDir = seedDesignedProject();
  const skillsDir = tempSkills();
  const calls: { args: string[]; stdin?: string }[] = [];
  try {
    const order: string[] = [];
    const buildPlan = fakeBuildPlan(calls);
    const ok = await tasksCommand(projectDir, {
      model: mockModel([planBuild("p1", ["F1", "F2"]), { kind: "text", text: "ok" }]),
      skillsDir,
      silent: true,
      deriveDesign: async (dir) => {
        order.push(`derive ${dir}`);
        return { ok: true, changed: ["claims-api"] };
      },
      buildPlan: async (args, stdin) => {
        order.push(args[0]!);
        return buildPlan(args, stdin);
      },
    });
    assert.equal(ok.ok, true, ok.detail);
    assert.deepEqual(order, [`derive ${projectDir}`, "scope", "issue"]);

    rmSync(join(projectDir, "issues"), { recursive: true, force: true });
    calls.length = 0;
    const refused = await tasksCommand(projectDir, {
      model: mockModel([]),
      skillsDir,
      silent: true,
      deriveDesign: async () => ({ ok: false, detail: "claims-api: dependency user-auth names no resource type" }),
      buildPlan: fakeBuildPlan(calls),
    });
    assert.deepEqual(refused, { ok: false, detail: "claims-api: dependency user-auth names no resource type" });
    assert.equal(calls.length, 0, "no selection after a refused derivation");
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(skillsDir, { recursive: true, force: true });
  }
});

test("tasks: a refused selection, or a plan turn that never plans, writes nothing and records no version", async () => {
  const projectDir = seedDesignedProject();
  const skillsDir = tempSkills();
  try {
    const refused = await tasksCommand(projectDir, {
      model: mockModel([]),
      skillsDir,
      silent: true,
      features: ["F9"],
      deriveDesign: noDerive, buildPlan: fakeBuildPlan([], { scopeCode: 1, stderr: "specs/requirements/prd.md: F9 is not a feature of the requirements\n" }),
    });
    assert.equal(refused.ok, false);
    assert.match(refused.detail ?? "", /the build is refused: .*F9 is not a feature/);

    const silent = await tasksCommand(projectDir, {
      model: mockModel([planBuild("p1", ["F2"]), { kind: "text", text: "I could not plan." }]),
      skillsDir,
      silent: true,
      deriveDesign: noDerive, buildPlan: fakeBuildPlan([]),
    });
    assert.equal(silent.ok, false);
    assert.match(silent.detail ?? "", /without a build plan/);

    assert.equal(existsSync(join(projectDir, "issues")), false, "no issue written");
    assert.deepEqual(loadProjectState(projectDir, "p").versions, []);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(skillsDir, { recursive: true, force: true });
  }
});

test("safeAllocator never clobbers an existing issue file (copied project, fresh counter)", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "aep-play-alloc-"));
  try {
    mkdirSync(join(projectDir, "issues"), { recursive: true });
    writeFileSync(join(projectDir, "issues/1.md"), "---\ntitle: hand-written\n---\n");
    let counter = 1;
    const store = new FsIssueStore(projectDir);
    const allocate = store.safeAllocator(
      () => counter,
      (n) => {
        counter = n;
      },
    );
    assert.equal(allocate(), 2);
    assert.equal(counter, 3);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
