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

// The ONE config object an OpenCode run is started with — the table in
// ADR-0015, built from `RuntimePolicy` and nothing else.
//
// It reaches the server as `OPENCODE_CONFIG_CONTENT`, which loads AFTER any
// file config and overrides it; the checkout's own `opencode.json` and
// `.opencode/` are switched off entirely by `OPENCODE_DISABLE_PROJECT_CONFIG=1`
// (runtime.ts), measured to cover both (S1c). So this object is the whole of
// what the platform asks for, and a project cannot add to it.
//
// Pure, so every clause is a test rather than a guess: the three silent failure
// modes ADR-0015 records (a mis-packaged plugin, an allowlist in the wrong
// order, a background flag) are each one line here.

import type { DeniedCapability } from "../port.js";
import {
  deniedTools,
  MCP_SERVER_KEY,
  opencodeModel,
  PRIMARY_AGENT,
  PROVIDER_ID,
  SUBAGENT,
} from "./tools.js";

/** A permission rule: one action, or a pattern → action map evaluated in order. */
export type PermissionRule = "allow" | "deny" | Record<string, "allow" | "deny">;

/** What the builder needs; every field comes off `RuntimePolicy` or the runtime's own files. */
export interface OpencodeConfigInput {
  /** The org's model, platform spelling (`claude-sonnet-5`). */
  model: string;
  /** Absolute path of the system-prompt appendix (workflow → pins → glossary). */
  instructionsPath: string;
  /** Absolute path of the guard plugin's package DIRECTORY. */
  pluginDir: string;
  /** The skills this session may load (`RuntimePolicy.skills.allow`). */
  skillAllow: readonly string[];
  deniedCapabilities: readonly DeniedCapability[];
  /** The loopback auth proxy's URL, when the run has the platform's MCP server. */
  mcpUrl?: string;
  debug: boolean;
}

/**
 * An allowlist as OpenCode must read it: `"*": "deny"` FIRST, then each allowed
 * name.
 *
 * Rules are evaluated LAST MATCH WINS, and a tool is removed from the model's
 * tool list outright when the last rule matching its permission is a `*` deny
 * (`Permission.disabled`). Written the other way round — allows first, `*` deny
 * last — the map hides the whole tool: spike S1 lost both `task` and `skill`
 * that way, with no error anywhere. Object key order is insertion order in
 * JavaScript and OpenCode converts the map to rules in that order, so the order
 * of the two statements below IS the policy.
 */
export function allowlist(names: readonly string[]): Record<string, "allow" | "deny"> {
  const rules: Record<string, "allow" | "deny"> = { "*": "deny" };
  for (const name of names) rules[name] = "allow";
  return rules;
}

/** The loopback placeholder the proxy expects; never sent upstream (`lib/mcp_auth_proxy.ts`). */
const LOOPBACK_TOKEN = "loopback";

/**
 * The run's config.
 *
 * Clause by clause (ADR-0015 has the argument for each):
 *
 *   model / small_model   the org's one model, `anthropic/`-spelled, for both;
 *                         the helper calls (titles, summaries) bill to it too,
 *                         never to OpenCode's own pick, which the org's key may
 *                         not reach and the platform may not price
 *   default_agent `aep`   one platform-defined primary: the built-in `build`
 *                         prompt must not compete with the workflow
 *   general               the one subagent the glossary offers, on the model
 *   build/plan/explore/scout disabled — a task naming one fails as "not valid"
 *   subagent_depth 3      the platform's ceiling; OpenCode's default of 1 would
 *                         forbid the builder → walker nesting the skill allows
 *   plugin                the guard's DIRECTORY (a bare file is skipped silently)
 *   snapshot false        no git snapshot store of the workspace per step
 *   share / autoupdate    off: nothing is published, nothing is fetched
 *   permission            explicit allow/deny, never `ask` (server mode has no
 *                         one to ask); allowlists `"*": "deny"` first
 *   external_directory    allow — OpenCode's one gate on ANY path outside the
 *                         project, reads and bash included; the platform gates
 *                         only authored writes, and the guard plugin is that gate
 *   tools.lsp / lsp       off: nothing serves it in a pod
 *   mcp                   the platform's server behind the same loopback proxy
 *                         Claude Code uses, because OpenCode's headers are static
 *                         too; `oauth: false` because the proxy owns auth and a
 *                         401 must not start OpenCode's own OAuth discovery
 *
 * NOT here, by decision: `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` (it is an
 * env flag, never set, and its absence is asserted at start), and the provider
 * key itself — `{env:ANTHROPIC_API_KEY}` is a reference the server resolves from
 * its own environment, so no credential is ever in this object.
 */
export function buildOpencodeConfig(input: OpencodeConfigInput): Record<string, unknown> {
  const model = opencodeModel(input.model);
  const denied = Object.fromEntries(deniedTools(input.deniedCapabilities).map((tool) => [tool, "deny" as const]));
  const subagentPermission = { todowrite: "deny", task: "allow" } as const;

  const permission: Record<string, PermissionRule> = {
    read: "allow",
    glob: "allow",
    grep: "allow",
    list: "allow",
    edit: "allow",
    bash: "allow",
    task: allowlist([SUBAGENT]),
    todowrite: "allow",
    webfetch: "allow",
    websearch: "allow",
    skill: allowlist(input.skillAllow),
    // The capability classes (`question` today), from tools.ts — never `ask`.
    ...denied,
    // `allow`, not `deny`: this permission is asked by read/glob/grep, by
    // bash for any path argument or workdir outside the project, AND by
    // edit/write/apply_patch — one switch with no read/write split. `deny`
    // refused the run's own `/tmp/validation-context.json` and every skill
    // reference, where Claude Code reads freely (`lib/workspace_guard.ts`), and
    // refused the temp/dot-directory writes that rule allows. So the platform's
    // write rule has exactly one enforcer, the guard plugin, bundled from that
    // same module; a pattern map here would be a second copy of it, and one
    // that could not tell a read from a write.
    external_directory: "allow",
    doom_loop: "allow",
    lsp: "deny",
  };

  return {
    $schema: "https://opencode.ai/config.json",
    model,
    small_model: model,
    default_agent: PRIMARY_AGENT,
    subagent_depth: 3,
    autoupdate: false,
    share: "disabled",
    instructions: [input.instructionsPath],
    plugin: [input.pluginDir],
    snapshot: false,
    ...(input.debug ? { logLevel: "DEBUG" } : {}),
    provider: { [PROVIDER_ID]: { options: { apiKey: "{env:ANTHROPIC_API_KEY}" } } },
    agent: {
      [PRIMARY_AGENT]: { mode: "primary", description: "AEP coding run lead" },
      [SUBAGENT]: { mode: "subagent", model, permission: { ...subagentPermission } },
      build: { disable: true },
      plan: { disable: true },
      explore: { disable: true },
      scout: { disable: true },
    },
    permission,
    tools: { lsp: false },
    ...(input.mcpUrl
      ? {
          mcp: {
            [MCP_SERVER_KEY]: {
              type: "remote",
              url: input.mcpUrl,
              headers: { Authorization: `Bearer ${LOOPBACK_TOKEN}` },
              oauth: false,
            },
          },
        }
      : {}),
  };
}
