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
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_SETTING_SOURCES,
  DISALLOWED_TOOLS,
  buildMcpOptions,
  buildSessionSkills,
  contractReferencePath,
  promptWithProjectRoot,
  resolveBaseAgentConfig,
} from "./runner.js";

// D9 secure search (Task 12) — WebSearch joins the base tool set (gated by
// the PreToolUse DLP hook wired in runClaudeQuery; see websearch_dlp.ts).
// WebFetch joins it too (see webfetch_guard.ts's PreToolUse SSRF + secret
// guard, wired the same way) — fail-closed, so this is safe to enable.
// Agent joins it for the milestone run loop's subagent fan-out (design §9.3).
// It is `Agent`, not `Task`: SDK 0.3.220 declares AgentInput and no TaskInput,
// so the old name named nothing — and because bypassPermissions ignores this
// list entirely, that mismatch could not fail loudly. Hence the pin.
const BASE_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch", "Agent"];
const MCP_TOOLS = [
  "mcp__aep__list_org_component_endpoints",
  "mcp__aep__get_remote_git_file_contents",
  "mcp__aep__search_remote_git_code",
];

test("buildMcpOptions: registers the aep MCP server and tools when both envs are set", () => {
  const result = buildMcpOptions("https://bff.example.com/internal/v1/mcp", "mcp-token-xyz");

  assert.deepEqual(result.mcpServers, {
    aep: {
      type: "http",
      url: "https://bff.example.com/internal/v1/mcp",
      headers: { Authorization: "Bearer mcp-token-xyz" },
    },
  });
  assert.deepEqual(result.allowedTools, [...BASE_TOOLS, ...MCP_TOOLS]);
});

test("buildMcpOptions: omits mcpServers and MCP tools when the token is missing", () => {
  const result = buildMcpOptions("https://bff.example.com/internal/v1/mcp", undefined);

  assert.equal(result.mcpServers, undefined);
  assert.deepEqual(result.allowedTools, BASE_TOOLS);
});

test("buildMcpOptions: omits mcpServers and MCP tools when the url is missing", () => {
  const result = buildMcpOptions(undefined, "mcp-token-xyz");

  assert.equal(result.mcpServers, undefined);
  assert.deepEqual(result.allowedTools, BASE_TOOLS);
});

test("buildMcpOptions: omits mcpServers and MCP tools when both are empty strings", () => {
  const result = buildMcpOptions("", "");

  assert.equal(result.mcpServers, undefined);
  assert.deepEqual(result.allowedTools, BASE_TOOLS);
});

test("buildMcpOptions: omits mcpServers and MCP tools when both are undefined", () => {
  const result = buildMcpOptions(undefined, undefined);

  assert.equal(result.mcpServers, undefined);
  assert.deepEqual(result.allowedTools, BASE_TOOLS);
});

test("buildMcpOptions: allowedTools includes both WebSearch and WebFetch (D9)", () => {
  const result = buildMcpOptions(undefined, undefined);

  assert.ok(result.allowedTools.includes("WebSearch"));
  assert.ok(result.allowedTools.includes("WebFetch"));
});

// The milestone run loop fans big, independent issues out to subagents; without
// Agent in allowedTools the `aep` skill's fan-out section names a tool the
// intended surface does not include.
test("buildMcpOptions: allowedTools includes Agent, with and without MCP", () => {
  assert.ok(buildMcpOptions(undefined, undefined).allowedTools.includes("Agent"));
  assert.ok(
    buildMcpOptions("https://bff.example.com/internal/v1/mcp", "mcp-token-xyz").allowedTools.includes("Agent"),
  );
  // The retired name must not creep back: it is the one that silently named
  // nothing for a whole SDK generation.
  assert.ok(!buildMcpOptions(undefined, undefined).allowedTools.includes("Task"));
});

// Subagents inherit the parent's allowedTools, so the git tools stay in the set
// and the main-agent-is-sole-git-writer rule is enforced by the skill's
// deny-list, not by the tool list. Pinned so a future "just drop Bash for
// subagents" idea has to confront that the seam does not exist here.
test("buildMcpOptions: Bash stays in the base set alongside Agent", () => {
  const tools = buildMcpOptions(undefined, undefined).allowedTools;
  assert.ok(tools.includes("Bash"));
  assert.ok(tools.includes("Agent"));
});

// --- resolveBaseAgentConfig: production behavior is what you get when a caller
// passes nothing at all ------------------------------------------------------

const SHIPPED_LIBRARY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../skills");
const TASK_ID = "11111111-2222-3333-4444-555555555555";

test("resolveBaseAgentConfig: defaults pin today's library + preload exactly", () => {
  const impl = resolveBaseAgentConfig(undefined, "implementation", TASK_ID);
  assert.equal(impl.libraryPath, SHIPPED_LIBRARY);
  assert.deepEqual(impl.preload, ["aep:aep"]);

  const val = resolveBaseAgentConfig(undefined, "validation", TASK_ID);
  assert.equal(val.libraryPath, SHIPPED_LIBRARY);
  assert.deepEqual(val.preload, ["aep:aep", "aep:aep-validation"]);
});

// Mode is stated, never inferred — and the default is the production one, so a
// new entrypoint that forgets to state it gets the safe failure: a local run
// told to use `gh` dies on the first call, where a production run told there is
// no remote would quietly finish without opening its PR.
test("resolveBaseAgentConfig: mode defaults to github", () => {
  assert.equal(resolveBaseAgentConfig(undefined, "implementation", TASK_ID).mode, "github");
  assert.equal(resolveBaseAgentConfig(undefined, "validation", TASK_ID).mode, "github");
});

// The composed plugin must never land inside the workspace: in production that
// is a git clone the agent commits from, and in the playground it is the
// developer's own project directory.
test("resolveBaseAgentConfig: the default compose dir is a per-task dir under the OS temp dir", () => {
  const resolved = resolveBaseAgentConfig(undefined, "implementation", TASK_ID);
  assert.equal(resolved.composeDir, path.join(os.tmpdir(), "aep-base-plugin", TASK_ID));
});

test("resolveBaseAgentConfig: the playground's overrides ride through", () => {
  const local = resolveBaseAgentConfig(
    { libraryPath: "/x/skills", mode: "local", composeDir: "/x/run/base-plugin" },
    "implementation",
    TASK_ID,
  );
  assert.equal(local.libraryPath, "/x/skills");
  assert.equal(local.mode, "local");
  assert.equal(local.composeDir, "/x/run/base-plugin");
  // Local mode preloads the SAME skill identity as production — one plugin, one
  // skill name, only the composed body differs.
  assert.deepEqual(local.preload, ["aep:aep"]);
});

test("resolveBaseAgentConfig: an explicit basePreload owns the FULL list (no validation append)", () => {
  const pinned = resolveBaseAgentConfig({ basePreload: ["aep:aep"] }, "validation", TASK_ID);
  assert.deepEqual(pinned.preload, ["aep:aep"]);
});

// --- buildSessionSkills: one plugin, and the whole mirror in the allowlist ---

// There is exactly ONE plugin: the base plugin the runner assembled. The
// per-task `aep-task-skills` plugin is gone — project skills arrive as the BFF's
// `.claude/skills/` mirror inside the workspace, which the SDK discovers itself.
// A second plugin entry appearing here again would mean someone reintroduced a
// fetch the mirror exists to replace.
test("buildSessionSkills: one plugin, and every mirrored name joins the allowlist", () => {
  const built = buildSessionSkills("/run/base-plugin", ["go", "openapi-conventions"], ["aep:aep"]);
  assert.deepEqual(built.plugins, [{ type: "local", path: "/run/base-plugin" }]);
  // The WHOLE mirror, not just the pins: `skills:` is an allowlist, so a
  // mirrored skill left out of it is rejected by the Skill tool outright.
  assert.deepEqual(built.skills, ["aep:aep", "go", "openapi-conventions"]);
});

// An empty mirror is the normal shape for a validation run (no design skills
// apply) — it must leave the base preload exactly as it was, not degrade it.
test("buildSessionSkills: an empty mirror leaves the base preload alone", () => {
  const built = buildSessionSkills("/run/base-plugin", [], ["aep:aep", "aep:aep-validation"]);
  assert.deepEqual(built.plugins, [{ type: "local", path: "/run/base-plugin" }]);
  assert.deepEqual(built.skills, ["aep:aep", "aep:aep-validation"]);
});

// The base preload is the caller's array, and a validation run's second workflow
// body is the one thing that still MUST be in context at startup — so mutating
// the result must not reach back and corrupt it.
test("buildSessionSkills: the base preload rides through unchanged, and is copied", () => {
  const basePreload = ["aep:aep", "aep:aep-validation"];
  const built = buildSessionSkills("/run/base-plugin", ["go"], basePreload);
  assert.deepEqual(built.skills, ["aep:aep", "aep:aep-validation", "go"]);

  built.skills.push("aep:playwright-cli");
  assert.deepEqual(basePreload, ["aep:aep", "aep:aep-validation"], "must not alias the caller's array");
});

// --- DISALLOWED_TOOLS: the boundary that survives bypassPermissions ---------

// allowedTools restricts nothing in this run (bypassPermissions +
// allowDangerouslySkipPermissions allow every harness tool), so this list is the
// only real boundary. Pinned because the failure it prevents is quiet: a run
// reached for ScheduleWakeup to wait on its own detached subagents, spent a turn
// on a schema error, and exited anyway.
test("DISALLOWED_TOOLS: blocks the session-management tools a one-shot pod cannot use", () => {
  for (const name of ["ScheduleWakeup", "Monitor", "AskUserQuestion", "Workflow", "CronCreate", "SendMessage"]) {
    assert.ok(DISALLOWED_TOOLS.includes(name), `${name} must stay disallowed`);
  }
});

// The run is the agent doing the work; blocking its working tools would end it.
test("DISALLOWED_TOOLS: never blocks a tool the run needs", () => {
  for (const name of buildMcpOptions(undefined, undefined).allowedTools) {
    assert.ok(!DISALLOWED_TOOLS.includes(name), `${name} is both allowed and disallowed`);
  }
});

// --- promptWithProjectRoot -------------------------------------------------

test("promptWithProjectRoot: names the absolute root and keeps the caller's prompt intact", () => {
  const out = promptWithProjectRoot("Work the issues in this project. Follow the `aep` skill", "/workspace/project");
  assert.match(out, /\/workspace\/project/);
  // The caller's prompt is the subject of the run; prefixing must not reword it.
  assert.ok(out.endsWith("Work the issues in this project. Follow the `aep` skill"));
});

test("promptWithProjectRoot: the platform's own workspace shape survives it", () => {
  // WORKSPACE_BASE_PATH/<org>/<project>/<taskId> — the value only exists after
  // provisionWorkspace, which is why neither prompt builder can state it.
  const root = "/aep-workspace/acme/todo/11111111-2222-3333-4444-555555555555";
  assert.match(promptWithProjectRoot("Work the issues for milestone 4", root), new RegExp(root));
});

// A fan-out subagent has no skill of its own, so the lead hands it the contract
// as an absolute path. A lead that has to TRANSCRIBE one gets it wrong: the first
// playground run of the reference split pasted `/run/base-plugin/…` to one of two
// subagents, dropping the workspace prefix — the read failed and the subagent fell
// to scanning `/` for the file. The prompt now carries the exact string to copy.
test("promptWithProjectRoot: states the contract path for the lead to hand on", () => {
  const contract = contractReferencePath("/workspace/run/base-plugin");
  const out = promptWithProjectRoot("Work the issues", "/workspace/project", contract);
  assert.match(out, /\/workspace\/run\/base-plugin\/skills\/aep\/references\/component-contract\.md/);
  assert.match(out, /hand that exact path to every subagent/);
  assert.ok(out.endsWith("Work the issues"));
});

test("promptWithProjectRoot: omitting the contract path leaves the prompt as it was", () => {
  // The platform's Go prompt builder and the playground's both go through
  // runClaudeQuery, which always passes it — but the seam stays optional so a
  // caller that has no plugin dir cannot be broken by this.
  const out = promptWithProjectRoot("Work the issues", "/workspace/project");
  assert.ok(!out.includes("component-contract.md"));
  assert.ok(out.endsWith("Work the issues"));
});

test("AGENT_SETTING_SOURCES admits the project source, and only that one", () => {
  // Verified against the real SDK: with [] a skill in the clone's
  // .claude/skills/ is absent from the init message's resolved list; with
  // ["project"] it is present. Dropping 'project' silently un-ships the whole
  // mirror, so this is the guard, not a restatement.
  assert.deepEqual([...AGENT_SETTING_SOURCES], ["project"]);
  // 'user' is a developer's ~/.claude and 'local' their personal overrides —
  // neither belongs in a dispatched container run.
  assert.ok(!AGENT_SETTING_SOURCES.includes("user" as never));
  assert.ok(!AGENT_SETTING_SOURCES.includes("local" as never));
});
