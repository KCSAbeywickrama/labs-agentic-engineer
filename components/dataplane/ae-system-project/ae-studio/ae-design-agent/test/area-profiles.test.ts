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
 * The tool registry and the area profiles are data the generic sub-agent is
 * built from, so the data is checked here: every tool a profile names is
 * registered, every write a profile can reach has a confirmation, every skill
 * a profile inlines ships in `skills/` for the chat audience, and a hand-off
 * target says when to hand off.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { AREAS, scopeFor, scopeProblems, type AreaScope } from "../src/areas/profiles.js";
import { describeChange, registeredTool, TOOLS } from "../src/tools/registry.js";
import { loadSkillsFromSnapshot } from "../src/conversation/load-workspace.js";

/** The repo root: its `skills/` tree is laid out as a `_skills` snapshot. */
const REPO_ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));

/** Every scope a profile can resolve to: its base and each focus. */
const SCOPES = Object.values(AREAS).flatMap((area) => [
  { name: area.id, scope: scopeFor(area.id) },
  ...Object.keys(area.focus ?? {}).map((kind) => ({
    name: `${area.id} › ${kind}`,
    scope: scopeFor(area.id, { kind: kind as "issue", number: 1 }),
  })),
]);

test("every tool a profile names is registered, and every write in it has a confirmation", () => {
  for (const { name, scope } of SCOPES) {
    assert.deepEqual(scopeProblems(scope), [], name);
    for (const tool of scope.tools) {
      const entry = registeredTool(tool)!;
      if (!entry.readOnly) assert.ok(entry.confirm, `${name}: ${tool} is a write without a confirmation`);
    }
  }
});

test("a scope naming an unknown tool or an unconfirmed write is refused", () => {
  const bad: AreaScope = { tools: ["ask_question", "delete_repo"], skills: [], reportsBack: "none" };
  assert.deepEqual(scopeProblems(bad), ["delete_repo: not a registered tool"]);
  // A write the registry knows but cannot hold.
  const registry = { ...TOOLS, wipe_issue: { source: "mcp" as const, readOnly: false } };
  assert.deepEqual(scopeProblems({ ...bad, tools: ["ask_question", "wipe_issue"] }, registry), [
    "wipe_issue: a write without a confirmation",
  ]);
});

test("a focus replaces only the base fields it states", () => {
  const base = scopeFor("issues");
  const issue = scopeFor("issues", { kind: "issue", number: 12 });
  assert.deepEqual(base.tools, ["ask_question", "ask_questions", "classify_report", "search_issues", "create_issue"]);
  assert.deepEqual(base.skills, ["issue-triage"]);
  assert.equal(base.reportsBack, "outcome-note");
  assert.equal(base.focus, undefined);
  assert.deepEqual(issue.tools, [
    "ask_question",
    "ask_questions",
    "get_issue",
    "list_components",
    "comment_issue",
    "edit_issue",
    "close_issue",
    "reopen_issue",
    "hand_to_coding_agent",
  ]);
  assert.deepEqual(issue.skills, ["issue-work"]);
  assert.equal(issue.reportsBack, "on-close-summary");
  assert.deepEqual(issue.focus, { kind: "issue", number: 12 });
  assert.equal(issue.area.label, "Issues");
});

test("every skill a profile inlines ships in skills/ for the chat audience only", () => {
  const library = new Map(loadSkillsFromSnapshot(REPO_ROOT).catalog().map((e) => [e.name, e]));
  for (const { name, scope } of SCOPES) {
    assert.ok(scope.skills.length > 0, `${name} inlines a skill`);
    for (const skill of scope.skills) {
      const entry = library.get(skill);
      assert.ok(entry, `${name}: skills/${skill}/SKILL.md exists`);
      assert.deepEqual(entry.audience, ["chat"], `${name}: ${skill} is the chat's only`);
      assert.ok(entry.description.length > 0, `${name}: ${skill} has a description`);
    }
  }
  // A skill states know-how, never the confirmation strings: those are the registry's.
  const source = loadSkillsFromSnapshot(REPO_ROOT);
  for (const skill of ["issue-triage", "issue-work"]) {
    const body = source.load(skill, "chat");
    assert.ok(body !== undefined && "content" in body, skill);
    for (const entry of Object.values(TOOLS)) {
      if (entry.confirm === undefined) continue;
      assert.equal(body.content.includes(entry.confirm.question), false, `${skill} restates "${entry.confirm.question}"`);
    }
  }
});

test("a hand-off target says when to hand off", () => {
  const targets = Object.values(AREAS).filter((a) => a.handOff !== undefined);
  assert.deepEqual(targets.map((a) => a.id), ["issues"]);
  for (const area of targets) {
    assert.ok(area.handOff!.sentence.trim().length > 0, area.id);
    assert.match(area.handOff!.sentence, /\/issue/);
  }
});

test("the registry's confirmations, word for word, and how each change is shown", () => {
  const table = Object.fromEntries(
    Object.entries(TOOLS).flatMap(([name, t]) =>
      t.confirm ? [[name, [t.confirm.question, t.confirm.option, t.confirm.decline]]] : [],
    ),
  );
  assert.deepEqual(table, {
    create_issue: ["File this issue?", "File it", "Change it"],
    comment_issue: ["Post this comment?", "Post it", "Not now"],
    edit_issue: ["Apply this edit?", "Apply it", "Not now"],
    close_issue: ["Close this issue?", "Close it", "Not now"],
    reopen_issue: ["Reopen this issue?", "Reopen it", "Not now"],
    hand_to_coding_agent: ["Hand this to the coding agent?", "Hand it over", "Not now"],
  });
  assert.equal(
    describeChange("create_issue", { title: "T", kind: "bug", body: "B" }),
    "Title: T\n\nKind: bug\n\nBody:\nB",
  );
  assert.equal(describeChange("edit_issue", { title: "T", body: "B" }), "Title: T\n\nBody:\nB");
  assert.equal(describeChange("reopen_issue", {}), "");
  assert.throws(() => describeChange("get_issue", {}), /no confirmation/);
  // Built-ins and MCP tools are told apart by source; the read tools are read-only.
  for (const name of ["ask_question", "ask_questions", "classify_report"]) assert.equal(TOOLS[name]!.source, "built-in");
  for (const name of ["search_issues", "get_issue", "list_components"]) {
    assert.equal(TOOLS[name]!.source, "mcp");
    assert.equal(TOOLS[name]!.readOnly, true);
  }
});
