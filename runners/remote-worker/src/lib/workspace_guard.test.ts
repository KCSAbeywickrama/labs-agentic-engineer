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

import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { createWorkspaceWriteGuard, workspaceWriteDenial } from "./workspace_guard.js";

const WORKSPACE = "/workspace/project";

// Pins the core containment logic without the machine's real $HOME/tmp deciding it.
const DENY_ALL = () => false;

const preToolUse = (toolName: string, toolInput: unknown): HookInput => ({
  hook_event_name: "PreToolUse",
  tool_name: toolName,
  tool_input: toolInput,
  tool_use_id: "toolu_01",
  session_id: "s1",
  transcript_path: "/tmp/t",
  cwd: WORKSPACE,
}) as HookInput;

test("workspace-guard: a component authored in the RUN dir is denied", () => {
  // The exact measured mistake: a subagent wrote 18 files into the run archive,
  // built them there, and reported green.
  const reason = workspaceWriteDenial("Write", { file_path: "/workspace/run/todo-webapp/src/App.tsx" }, WORKSPACE, DENY_ALL);
  assert.ok(reason);
  // The denial has to name the right root, or the model has nothing to correct to.
  assert.match(reason, /\/workspace\/project/);
  assert.match(reason, /\/workspace\/run\/todo-webapp\/src\/App\.tsx/);
});

test("workspace-guard: writes inside the project are allowed", () => {
  for (const p of [
    "/workspace/project/todo-api/main.bal",
    "/workspace/project/issues/3.md",
    WORKSPACE,
    // Relative paths resolve against the workspace (the session cwd), so they are
    // in-project by construction and must never be denied.
    "todo-webapp/src/App.tsx",
    "./package.json",
  ]) {
    assert.equal(workspaceWriteDenial("Write", { file_path: p }, WORKSPACE, DENY_ALL), undefined, p);
  }
});

test("workspace-guard: a sibling path that merely shares a prefix is denied", () => {
  // `startsWith` on the raw string would allow this one — the classic containment
  // bug. `/workspace/project-archive` is not inside `/workspace/project`.
  assert.ok(workspaceWriteDenial("Write", { file_path: "/workspace/project-archive/x.bal" }, WORKSPACE, DENY_ALL));
});

test("workspace-guard: traversal back out of the project is denied", () => {
  assert.ok(workspaceWriteDenial("Write", { file_path: "/workspace/project/../run/x.ts" }, WORKSPACE, DENY_ALL));
  assert.ok(workspaceWriteDenial("Write", { file_path: "../run/x.ts" }, WORKSPACE, DENY_ALL));
});

test("workspace-guard: any toolchain cache under $HOME is allowed, by one rule", () => {
  // Every toolchain hides its cache in a dot-directory under $HOME, so the rule is
  // "hidden home directory" rather than a list of them — a list silently
  // contradicts the next stack skill added. `.m2` and `.cargo` are here as stacks
  // this image does not ship: they must pass without an edit to the guard.
  const home = os.homedir();
  for (const p of [
    path.join(home, ".ballerina", "repositories", "central.ballerina.io", "bala", "x", "y.bal"),
    path.join(home, ".npm", "_cacache", "index-v5", "aa"),
    path.join(home, ".m2", "repository", "x", "y.jar"),
    path.join(home, ".cargo", "registry", "x"),
    path.join(os.tmpdir(), "scratch.txt"),
  ]) {
    assert.equal(workspaceWriteDenial("Write", { file_path: p }, WORKSPACE), undefined, p);
  }
});

test("workspace-guard: a VISIBLE directory under $HOME is still denied", () => {
  // The rule must not widen into "anything under $HOME": a sibling checkout is
  // exactly the wrong-directory write this guard exists to catch, and it is not
  // hidden. `$HOME` itself is not a write target either.
  const home = os.homedir();
  for (const p of [
    path.join(home, "repos", "other-project", "src", "main.go"),
    path.join(home, "Documents", "notes.md"),
    path.join(home, "x.ts"),
  ]) {
    assert.ok(workspaceWriteDenial("Write", { file_path: p }, WORKSPACE), p);
  }
});

test("workspace-guard: Edit and NotebookEdit are gated, read/search tools are not", () => {
  assert.ok(workspaceWriteDenial("Edit", { file_path: "/etc/hosts" }, WORKSPACE, DENY_ALL));
  assert.ok(workspaceWriteDenial("NotebookEdit", { notebook_path: "/etc/x.ipynb" }, WORKSPACE, DENY_ALL));
  // Reads stay open: a skill's own references/ live outside the project by
  // construction, and gating reads would break the skill system to prevent a
  // writing mistake.
  assert.equal(workspaceWriteDenial("Read", { file_path: "/workspace/run/.aep/skills-plugin/x.md" }, WORKSPACE, DENY_ALL), undefined);
  assert.equal(workspaceWriteDenial("Bash", { command: "bal build" }, WORKSPACE, DENY_ALL), undefined);
  assert.equal(workspaceWriteDenial("Grep", { pattern: "x", path: "/usr/lib/ballerina" }, WORKSPACE, DENY_ALL), undefined);
});

test("workspace-guard: a call naming no path is left alone", () => {
  // Inventing a failure here would only mask whatever the SDK reports about a
  // malformed call.
  assert.equal(workspaceWriteDenial("Write", {}, WORKSPACE, DENY_ALL), undefined);
  assert.equal(workspaceWriteDenial("Write", { file_path: "" }, WORKSPACE, DENY_ALL), undefined);
  assert.equal(workspaceWriteDenial("Write", null, WORKSPACE, DENY_ALL), undefined);
});

test("workspace-guard: the hook denies, announces once, and ignores other events", async () => {
  const seen: string[] = [];
  const hook = createWorkspaceWriteGuard(WORKSPACE, (r) => seen.push(r));
  const ctx = { signal: new AbortController().signal };
  const call = preToolUse("Write", { file_path: "/workspace/run/todo-webapp/src/App.tsx" });

  const out = (await hook(call, undefined, ctx)) as { hookSpecificOutput?: Record<string, unknown> };
  assert.equal(out.hookSpecificOutput?.hookEventName, "PreToolUse");
  // Denied, not rewritten: unlike a backgrounded fan-out there is no correct
  // path to substitute — only the model knows where the file was meant to go.
  assert.equal(out.hookSpecificOutput?.permissionDecision, "deny");

  // Three matchers reach the same call; the feed must say it once.
  await hook(call, undefined, ctx);
  assert.equal(seen.length, 1);

  assert.deepEqual(await hook(preToolUse("Write", { file_path: "/workspace/project/a.bal" }), undefined, ctx), {});
  const post = { ...call, hook_event_name: "PostToolUse" } as HookInput;
  assert.deepEqual(await hook(post, undefined, ctx), {});
});
