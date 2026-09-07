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

// The tool glossary: the one place a runtime's tool NAMES are written down for
// the agent reading them.
//
// The `aep` skill is authored in roles — "the fan-out tool", "the wait tool",
// "the task list" — because it is one library shared by every org, and a skill
// naming `Agent` and `TaskOutput` would be a Claude Code document that a second
// runtime silently mis-steers. The binding from role to tool name belongs to
// whoever started the session, which is this package. So the skill says what to
// do and the glossary says what to call, and the two move independently.
//
// It is appended LAST, after the workflow body and any pinned skill bodies, so
// the skill's "the tool glossary at the end of your instructions" is literally
// true and the model has one place to look rather than a definition buried
// mid-prompt.
//
// A second runtime is a second entry in GLOSSARIES and nothing else. The runtime
// PORT — one interface over spawning, translating and settling a session — is a
// larger change and is not this; `progress/claude_adapter.ts` is the other half
// of the same eventual seam.

/** The agent runtimes a coding run can be driven by. One, today. */
export type AgentRuntime = "claude_code";

export const DEFAULT_RUNTIME: AgentRuntime = "claude_code";

/**
 * One glossary per runtime, keyed by the runtime's own id.
 *
 * Every role the `aep` skill names in prose has an entry here, and nothing else
 * does: this is a lookup table the agent reads under load, not a second copy of
 * the workflow. The model aliases are listed because the skill tells the lead to
 * pick one ("the fast model", "the default one") and a lead that guesses an
 * alias spends a turn on a schema error.
 */
const GLOSSARIES: Record<AgentRuntime, string> = {
  claude_code: [
    "## Tool glossary (Claude Code)",
    "",
    "The roles your workflow names, and the tools that play them in this session:",
    "",
    "- **fan-out tool**: `Agent` — `run_in_background: true` for a builder;" +
      " `model:` `haiku` (the fast model), `sonnet` (the default), `opus`",
    "- **wait tool**: `TaskOutput` with `block: true` — one call per agent you dispatched",
    "- **stop tool**: `TaskStop`, for an agent that has run away",
    "- **task list**: `TaskCreate` and `TaskUpdate`",
    "- **edit**: `Edit`, `Write` · **shell**: `Bash`",
  ].join("\n"),
};

/**
 * The glossary block for a runtime, ready to append to a system prompt.
 *
 * Total, so a caller cannot start a session whose prose names roles nothing
 * binds — an unknown runtime is a programming error here, not a degraded run.
 */
export function toolGlossary(runtime: AgentRuntime = DEFAULT_RUNTIME): string {
  const glossary = GLOSSARIES[runtime];
  if (glossary === undefined) throw new Error(`no tool glossary for runtime ${JSON.stringify(runtime)}`);
  return glossary;
}
