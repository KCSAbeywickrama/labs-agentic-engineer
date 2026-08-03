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
import { fileURLToPath } from "node:url";
import { query, type McpServerConfig, type Query } from "@anthropic-ai/claude-agent-sdk";
import { assembleBasePlugin, type AgentMode } from "./base_plugin.js";
import type { TaskLog } from "./logger.js";
import type { DispatchRequest } from "./types.js";
import type { WorkspaceLayout } from "./workspace.js";
import { emit } from "./progress/emitter.js";
import { createSdkTranslator } from "./progress/from-sdk.js";
import { createRunWatchdog } from "./progress/watchdog.js";
import { createWebSearchDlpHook, stagedSecretValues } from "./websearch_dlp.js";
import { createForegroundFanOutHook } from "./fanout_foreground.js";
import { createWorkspaceWriteGuard } from "./workspace_guard.js";
import { createWebFetchGuardHook } from "./webfetch_guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The authored skill library, as the image lays it out: repo-root `skills/`
// arrives at /app/skills (Dockerfile `COPY --from=skills`), and this module sits
// at /app/src/lib. The dev flow and the playground bind-mount the working-tree
// library over that path, so a skill edit needs no rebuild.
const LIBRARY_PATH = path.resolve(__dirname, "../../skills");

// Phase 0 allowed-tools: git, gh, build/test/lint via Bash; standard file
// tools. Endpoint Spec Discovery (B2) re-introduces MCP — but only as an
// in-process remote HTTP server (see buildMcpOptions below), never the
// file-based .mcp.json that settingSources: [] deliberately blocks.
// D9 secure search (Task 12) adds WebSearch, gated by the PreToolUse DLP
// hook wired in runClaudeQuery below (see websearch_dlp.ts for why
// PreToolUse, not canUseTool, and .superpowers/sdd/task-12-report.md for
// the spike evidence). WebFetch (external API/SDK doc + spec-URL fetches)
// is added alongside it, gated by its own PreToolUse SSRF + secret guard
// (see webfetch_guard.ts) — fail-closed, so pod egress to arbitrary
// fetched pages never reaches internal/private/link-local/metadata
// addresses or leaks a staged secret in the URL.
// Agent joins the set for the milestone run loop (docs/design §9.3): a cycle
// works several issues, and the main agent fans the big, prose-independent,
// disjoint-App-Path ones out to subagents. The main agent stays the SOLE git
// writer — subagents Edit/Write only. That split is a SKILL rule, not a tool
// restriction: the SDK hands a subagent the same allowedTools as its parent,
// so `aep`'s deny-list is what keeps a subagent off git, and its fan-out
// section is what keeps small issues inline.
//
// The fan-out tool is `Agent`. It was `Task` until the SDK 0.2 → 0.3 bump, and
// this list still said `Task` afterwards — a name with no tool behind it in
// 0.3.220 (`sdk-tools.d.ts` declares `AgentInput` and no `TaskInput`). Nothing
// broke loudly, which is the point of the note below.
const BASE_ALLOWED_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch", "Agent"];

// allowedTools does NOT restrict anything in this run: `bypassPermissions` plus
// `allowDangerouslySkipPermissions` (see the query() options below) allows every
// tool the harness has, whether or not it is named above. Measured on a live run
// — the agent called `Agent` and `ScheduleWakeup`, neither of which was in the
// list, and both dispatched. So BASE_ALLOWED_TOOLS documents the intended
// surface, and this is the list that actually holds a boundary.
//
// What it excludes is the harness's *session-management* surface: tools that
// assume an interactive user, a scheduler, or a durable session, none of which a
// one-shot pod has. They are not merely useless here — a run reached for
// `ScheduleWakeup` to wait on its own detached subagents (it failed the schema
// and the session exited anyway), so an unreachable tool is a real invitation to
// spend a turn on a dead end. File/shell/search tools are deliberately absent
// from this list: `aep`'s deny-list governs those by path and command, and
// blocking them wholesale would end the run.
export const DISALLOWED_TOOLS = [
  "ScheduleWakeup",
  "Monitor",
  "CronCreate",
  "CronDelete",
  "CronList",
  "TaskCreate",
  "TaskUpdate",
  "TaskGet",
  "TaskList",
  "TaskStop",
  "TaskOutput",
  "Workflow",
  "Artifact",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  "SendMessage",
  "PushNotification",
  "RemoteTrigger",
  "SendFeedback",
  "EnterWorktree",
  "ExitWorktree",
];

// 128 + SIGTERM(15), the shell's own convention for "killed by a signal". The
// run reports this only when it is torn down from outside, never on its own.
const TERMINATED_EXIT_CODE = 143;

// How long the terminal dump gets to reach the pipe before the hard exit. Well
// under any sane SIGTERM grace period (Kubernetes defaults to 30s), so this
// never turns into the SIGKILL it is trying to beat.
const TERMINATE_FLUSH_MS = 50;

// The server key the BFF MCP endpoint is registered under. The SDK
// namespaces MCP tools as `mcp__<serverKey>__<toolName>` (confirmed from
// node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts, SDKControlMcpCallRequest
// doc comment: "Fully-qualified MCP tool name, e.g. mcp__server__tool_name.").
const MCP_SERVER_KEY = "aep";

// The three read-only tools the BFF's aep-api-mcp server exposes (see
// services/aep-api/internal/feature/dependencies/mcp_tools.go). Namespaced
// per the SDK's mcp__<server>__<tool> convention above.
const MCP_TOOL_NAMES = [
  `mcp__${MCP_SERVER_KEY}__list_org_component_endpoints`,
  `mcp__${MCP_SERVER_KEY}__get_remote_git_file_contents`,
  `mcp__${MCP_SERVER_KEY}__search_remote_git_code`,
];

/**
 * Prepends the two absolute paths a run cannot derive to the caller's prompt.
 *
 * The `aep` skill says "the current working directory **is** the project" and
 * never names it, because static skill text cannot. Neither prompt builder can
 * either: the playground's is a TS literal and the platform's is a Go one
 * (`delivery/codingagent/coding_executor.go`), and the paths are decided here,
 * after `provisionWorkspace` and `assembleBasePlugin`. So this is the only place
 * that both knows the values and reaches every run — stating them in two prompt
 * builders would duplicate facts across a language boundary neither owns.
 *
 * **The project root** is worth stating because the alternative was measured:
 * with only relative framing, a run inferred the run directory was the project
 * root and built a whole component there.
 *
 * **The contract path** is stated for the same reason, one level down. A fan-out
 * subagent gets no skill of its own, so the lead has to hand it
 * `references/component-contract.md` as an absolute path — and a lead that has to
 * transcribe one gets it wrong: in the first playground run of the split, the
 * lead pasted `/run/base-plugin/…` to one of two subagents, dropping the
 * workspace prefix. That subagent's read failed and it fell to scanning `/` for
 * the file, which the deny-list forbids. Handing the lead the exact string to
 * copy removes the class.
 */
export function promptWithProjectRoot(prompt: string, workspaceRoot: string, contractPath?: string): string {
  const contract =
    contractPath === undefined
      ? ""
      : `The component contract every implementer follows is ${contractPath} — ` +
        `hand that exact path to every subagent you fan out to.\n`;
  return (
    `Your project root — the current working directory — is ${workspaceRoot}. ` +
    `Every file you author lives under it; nothing else on this filesystem is a project root.\n` +
    `${contract}\n${prompt}`
  );
}

/** Where the assembled plugin keeps the `aep` skill's references. */
export function contractReferencePath(basePluginDir: string): string {
  return path.join(basePluginDir, "skills", "aep", "references", "component-contract.md");
}

export interface SessionSkills {
  plugins: Array<{ type: "local"; path: string }>;
  /** The SDK `skills:` preload — base-plugin entries only, by construction. */
  skills: string[];
}

/**
 * The session's plugin list and its startup preload.
 *
 * A pure seam (the buildMcpOptions pattern) so the property that matters is
 * pinnable without constructing a query(): the per-task plugin is LOADED, and it
 * contributes NOTHING to the preload. Every project-attached skill is discovered
 * by its description and its body arrives only when the agent invokes it, so a
 * project that designed twelve components costs a run exactly as much startup
 * context as one that designed two.
 */
export function buildSessionSkills(
  basePluginDir: string,
  skillsPluginDir: string | undefined,
  basePreload: string[],
): SessionSkills {
  const plugins: Array<{ type: "local"; path: string }> = [{ type: "local", path: basePluginDir }];
  if (skillsPluginDir) {
    plugins.push({ type: "local", path: skillsPluginDir });
  }
  return { plugins, skills: [...basePreload] };
}

export interface McpQueryOptions {
  mcpServers?: Record<string, McpServerConfig>;
  allowedTools: string[];
}

// buildMcpOptions is a pure seam so the env-presence guard is unit-testable
// without constructing a full query(). Both mcpUrl and mcpToken must be
// present — the BFF's coding-agent Job template stamps AEP_MCP_URL
// unconditionally but only stamps AEP_MCP_TOKEN when minting succeeded
// (see job_template.go), so a URL-without-token dispatch must still omit
// the server rather than register it unauthenticated.
export function buildMcpOptions(mcpUrl: string | undefined, mcpToken: string | undefined): McpQueryOptions {
  if (!mcpUrl || !mcpToken) {
    return { allowedTools: BASE_ALLOWED_TOOLS };
  }
  return {
    mcpServers: {
      [MCP_SERVER_KEY]: {
        type: "http",
        url: mcpUrl,
        headers: { Authorization: `Bearer ${mcpToken}` },
      },
    },
    allowedTools: [...BASE_ALLOWED_TOOLS, ...MCP_TOOL_NAMES],
  };
}

export interface RunResult {
  exitCode: number;
  error?: string;
}

export interface StartedRun {
  query: Query;
  completion: Promise<RunResult>;
}

// BaseAgentConfig parameterizes which skill library the always-loaded workflow
// plugin is assembled from, and how. Every field defaults to production
// behavior, so `oneshot.ts` passes nothing at all (pinned in runner.test.ts).
//
// `mode` is stated by the caller, never inferred. The entrypoint unambiguously
// knows which flavour of run this is; deriving it from something incidental (an
// empty `repoUrl`, an absent MCP token) would tie the agent's whole procedure to
// a signal whose meaning could shift for an unrelated reason. It defaults to
// `github` because that is the safe direction: a local run mistakenly assembled
// for GitHub fails loudly the first time `gh` is invoked, whereas a production
// run mistakenly assembled for local would be told there is no remote and no PR
// to open — the exact opposite of its contract.
//
// A caller that overrides `basePreload` owns the FULL preload list — the
// validation-task append only applies to the default.
export interface BaseAgentConfig {
  /** The authored skill library; defaults to the image's `/app/skills`. */
  libraryPath?: string;
  /** The startup `skills:` preload; defaults to ["aep:aep"] (+ the validation body for validation tasks). */
  basePreload?: string[];
  /** Which mode to assemble the workflow skill for; defaults to "github". */
  mode?: AgentMode;
  /** Where the assembled plugin is written; defaults to a per-task dir under the OS temp dir. */
  composeDir?: string;
}

export interface ResolvedBaseAgentConfig {
  /** The authored library to assemble FROM (not what the SDK loads). */
  libraryPath: string;
  preload: string[];
  mode: AgentMode;
  composeDir: string;
}

// resolveBaseAgentConfig is a pure seam (the buildMcpOptions pattern) so the
// defaults are unit-pinnable without constructing a query() or touching disk.
export function resolveBaseAgentConfig(
  base: BaseAgentConfig | undefined,
  taskKind: DispatchRequest["taskKind"],
  taskId: string,
): ResolvedBaseAgentConfig {
  const libraryPath = base?.libraryPath ?? LIBRARY_PATH;
  const mode = base?.mode ?? "github";
  // Outside the workspace in both modes: in production the workspace is a git
  // clone the agent commits from, and in the playground it is the developer's
  // own project dir. Neither should grow a copy of the plugin tree.
  const composeDir = base?.composeDir ?? path.join(os.tmpdir(), "aep-base-plugin", taskId);
  const preload = base?.basePreload ? [...base.basePreload] : defaultPreload(taskKind);
  return { libraryPath, preload, mode, composeDir };
}

function defaultPreload(taskKind: DispatchRequest["taskKind"]): string[] {
  const preload = ["aep:aep"];
  if (taskKind === "validation") preload.push("aep:aep-validation");
  return preload;
}

export function runClaudeQuery(
  req: DispatchRequest,
  layout: WorkspaceLayout,
  log: TaskLog,
  /**
   * Absolute path to the materialised per-task plugin (.aep/skills-plugin/),
   * or undefined when the run applies no skills. Built by skills_resolver.ts +
   * skills_materializer.ts; loaded as a second `{type:"local"}` plugin.
   */
  skillsPluginDir?: string,
  base?: BaseAgentConfig,
): StartedRun {
  // Spawn env: bearer + git-service URL passed by file path / URL only.
  // No tokens cross via env, so transcripts cannot leak credentials.
  // ANTHROPIC_API_KEY flows through from process.env (container env).
  // F3c — surface AEP_TASK_ID and AEP_PLATFORM_URL to the agent's
  // child env so the aep skill's verification-failed shell snippet can
  // hit POST $AEP_PLATFORM_URL/api/v1/tasks/$AEP_TASK_ID/verification-failed.
  // The bearer rides through a file (AEP_BEARER_FILE) so the agent's
  // SDK transcripts can't leak it; the curl snippet reads the file at
  // call time.
  const childEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PATH: `${layout.aepDir}:${process.env.PATH ?? ""}`,
    GH_CONFIG_DIR: layout.ghConfigDir,
    AEP_BEARER_FILE: layout.bearerFile,
    AEP_TASK_ID: req.taskId,
    AEP_PLATFORM_URL: process.env.AEP_PLATFORM_URL ?? "",
    AEP_GIT_SERVICE_URL: req.gitServiceUrl,
    AEP_CORRELATION_ID: req.correlationId ?? "",
  };

  // Two-tier plugin list: the base `aep` plugin (workflow + base
  // conventions) is always loaded; the per-task `aep-task-skills`
  // plugin (project-attached skills) is loaded conditionally when the
  // entrypoint materialised it.
  //
  // ONLY the base plugin preloads. Every project-attached skill — whatever its
  // kind — reaches the session through the SDK's standard discovery: its
  // description in context, its body when the agent invokes it. So the startup
  // context cost of a run is fixed at the workflow skill, not proportional to
  // how many components the project designed (see skills_materializer.ts).
  // Related-issue discovery/cross-linking moved to the SRE agent's handoff
  // stage (a "## Related issues" section in the issue body; GitHub #N
  // mentions back-link automatically) — issues arrive pre-linked, so the
  // former aep:related-issues preload is gone. See AE-HANDOFF-DESIGN.md in
  // openchoreo/agents/sre-agent.
  // Validation tasks additionally preload the validation workflow body:
  // it replaces the implementation workflow and the run cannot afford
  // the agent skipping a description-triggered load of it.
  //
  // The base plugin is ASSEMBLED from the skill library, never pointed at it: the
  // library also holds the design-flow and stack skills, and this is the single
  // choke point that selects the runner's three and applies the mode's overlay
  // (see base_plugin.ts). Doing it here rather than in each entrypoint means no
  // caller can forget and hand the SDK a session that can see `design`'s
  // description, or the platform's PR procedure in a local run.
  const resolvedBase = resolveBaseAgentConfig(base, req.taskKind, req.taskId);
  const basePluginDir = assembleBasePlugin({
    libraryDir: resolvedBase.libraryPath,
    destDir: resolvedBase.composeDir,
    mode: resolvedBase.mode,
  });
  // Where the skill library actually is, for the one skill that has to name a
  // file inside it: `aep-validation` runs the platform's report generator rather
  // than a copy the repo committed. The runner is the only layer that knows the
  // path — it is a mount point in the cluster, a bind-mount in the playground and
  // a checkout on a developer's host — so a skill that hardcodes one is wrong in
  // two of the three (it was, and it named the retired /app/plugin).
  childEnv.AEP_SKILLS_DIR = resolvedBase.libraryPath;
  const { plugins, skills } = buildSessionSkills(basePluginDir, skillsPluginDir, resolvedBase.preload);

  // Endpoint Spec Discovery (B2) — register the BFF's MCP server in-process
  // when the dispatch carries both AEP_MCP_URL and AEP_MCP_TOKEN. Older
  // dispatches (or a failed token mint) omit one or both, in which case the
  // runner falls back to the base tool set unchanged.
  const { mcpServers, allowedTools } = buildMcpOptions(req.mcpUrl, req.mcpToken);

  // D9 secure search (Task 12) — DLP gate for the server-side WebSearch
  // tool. Secret candidates are read from childEnv, the SAME env record
  // injected into this run (see websearch_dlp.ts's stagedSecretValues doc
  // comment): staged dependency secrets (Tasks 9-11's per-run K8s Secrets,
  // mounted via envFrom) and the runner's own credentials both land there
  // before the query() call below, so this is the single source of truth
  // for "what's secret in this run" without a second, drift-prone channel.
  const stagedSecrets = stagedSecretValues(childEnv);
  const webSearchDlpHook = createWebSearchDlpHook(stagedSecrets);

  // WebFetch SSRF + secret-leak guard (see webfetch_guard.ts) — built from
  // the SAME staged-secret list as the WebSearch hook above, one source of
  // truth for "what's secret in this run".
  const webFetchGuardHook = createWebFetchGuardHook(stagedSecrets);

  // Fan-out stays in the foreground — see fanout_foreground.ts. Backgrounding a
  // subagent detaches it, and the SDK then forwards none of its messages, so the
  // run's whole implementation phase reaches the feed as an empty section.
  const foregroundFanOutHook = createForegroundFanOutHook((label) => {
    emit({
      kind: "log",
      level: "info",
      summary: `[fan-out] ${label} — running in the foreground so its steps stay on the feed`,
    });
  });

  // Authored files land in the project — see workspace_guard.ts. A run once built
  // a whole component into the run directory and finished green, so the skill's
  // "everything you produce goes inside it" needs an enforcer too.
  const workspaceWriteGuard = createWorkspaceWriteGuard(layout.workspace, (reason) => {
    emit({ kind: "log", level: "warn", summary: `[workspace] ${reason}` });
  });

  // The SDK auto-discovers the bundled native binary — no
  // pathToClaudeCodeExecutable needed. settingSources: [] ensures no
  // host filesystem settings leak into the container agent.
  const q = query({
    prompt: promptWithProjectRoot(req.prompt, layout.workspace, contractReferencePath(basePluginDir)),
    options: {
      cwd: layout.workspace,
      // Pinned rather than left to the SDK's own default, which drifts across
      // SDK releases (seen live: an unpinned run resolved to claude-sonnet-4-6).
      model: "claude-sonnet-5",
      plugins,
      // The base plugin's workflow bodies, forced into context at startup.
      // Do NOT replace with 'all': that would inject every attached skill's
      // body too, which is exactly what the on-demand listing is for.
      skills: skills as unknown as string[],
      allowedTools,
      // The boundary that actually holds under bypassPermissions — see
      // DISALLOWED_TOOLS.
      disallowedTools: DISALLOWED_TOOLS,
      ...(mcpServers ? { mcpServers } : {}),
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      persistSession: false,
      settingSources: [],
      env: childEnv,
      // NOT canUseTool — the Task 12 spike found canUseTool is never
      // invoked for the server-executed WebSearch tool (confirmed under
      // bypassPermissions above too). PreToolUse is the mechanism that
      // actually gates it pre-dispatch. See websearch_dlp.ts. WebFetch is
      // a genuine local dispatch (it actually dials out), but is gated the
      // same way for consistency and because PreToolUse is still the
      // earliest point to deny before any egress happens. See
      // webfetch_guard.ts.
      hooks: {
        PreToolUse: [
          { matcher: "WebSearch", hooks: [webSearchDlpHook] },
          { matcher: "WebFetch", hooks: [webFetchGuardHook] },
          // Not a guard: this one rewrites the call rather than gating it. Two
          // entries rather than one alternation, because the matcher's grammar
          // is unspecified in the SDK's types and a pattern that silently failed
          // to match would take the feed down with it. The hook re-checks the
          // tool name itself, so a matcher that over-matches is harmless.
          { matcher: "Agent", hooks: [foregroundFanOutHook] },
          { matcher: "Task", hooks: [foregroundFanOutHook] },
          // One matcher per authoring tool, same reasoning as the pair above: the
          // matcher grammar is unspecified, and the hook re-checks the tool name
          // itself, so over-matching is harmless and a silent non-match is not.
          { matcher: "Write", hooks: [workspaceWriteGuard] },
          { matcher: "Edit", hooks: [workspaceWriteGuard] },
          { matcher: "NotebookEdit", hooks: [workspaceWriteGuard] },
        ],
      },
    },
  });

  // One translator per run — it carries this run's subagent labels and
  // in-flight tool calls (see createSdkTranslator).
  const translate = createSdkTranslator();
  // …and one watchdog, so a silent stretch says what it is waiting on rather
  // than looking identical to a dead run.
  const watchdog = createRunWatchdog();
  const stopWatchdog = watchdog.start();

  // A killed run must still explain itself. Without this, SIGTERM (what the
  // playground's Ctrl-C and a Job eviction both send) tears the process down
  // mid-tool and leaves nothing behind — the state that would have named the
  // culprit dies with it. Handling the signal means we now own the exit, so
  // this MUST terminate: a handler that only logged would convert a kill into
  // the very hang it exists to diagnose.
  const onTerminate = (signal: NodeJS.Signals): void => {
    emit({ kind: "log", level: "error", summary: `[watchdog] terminated by ${signal} — ${watchdog.describe()}` });
    stopWatchdog();
    // stdout is a PIPE here (a pod's log stream; the playground's child stdio),
    // and pipe writes are asynchronous on POSIX — exiting on this tick can
    // truncate the dump just written, losing the one line the handler exists
    // to produce. Give the fd a bounded moment to drain and then exit hard: a
    // blocked reader must not turn a kill into a hang.
    setTimeout(() => process.exit(TERMINATED_EXIT_CODE), TERMINATE_FLUSH_MS);
  };
  process.once("SIGTERM", onTerminate);
  process.once("SIGINT", onTerminate);

  const completion = (async (): Promise<RunResult> => {
    try {
      for await (const message of q) {
        log.write(message);
        const events = translate(message);
        watchdog.observe(events);
        for (const event of events) {
          emit(event);
        }
        if (message.type === "result") {
          if (message.subtype === "success") {
            return { exitCode: 0 };
          }
          const errors =
            "errors" in message && Array.isArray(message.errors)
              ? (message.errors as string[])
              : [];
          return {
            exitCode: 1,
            error: `agent result ${message.subtype}${errors.length ? ": " + errors.join(", ") : ""}`,
          };
        }
      }
      emit({ kind: "log", level: "warn", summary: "agent stream ended without result" });
      return { exitCode: 1, error: "agent stream ended without result" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.write({ type: "worker_error", error: msg });
      emit({ kind: "result", status: "failure", error: msg });
      return { exitCode: 1, error: msg };
    } finally {
      stopWatchdog();
      process.removeListener("SIGTERM", onTerminate);
      process.removeListener("SIGINT", onTerminate);
      log.close();
    }
  })();

  return { query: q, completion };
}
