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
 * Keep fanned-out subagents in the FOREGROUND.
 *
 * Backgrounding a fan-out does not mean "run concurrently". Concurrency comes
 * from the model emitting several fan-out blocks in ONE assistant turn, which
 * the SDK dispatches together and waits on — measured on a two-component run,
 * both subagents launched 3s apart inside one API response and their work
 * interleaved throughout. Backgrounding changes something else entirely: the
 * call returns in ~2ms with `status: async_launched`, and the subagent becomes a
 * DETACHED task.
 *
 * BACKGROUND IS THE SDK's DEFAULT, so this hook must act on the ABSENCE of the
 * flag, not only on `true`. Under SDK 0.2.x an omitted flag meant foreground and
 * checking for `=== true` was sufficient; 0.3.220 documents the opposite —
 * `AgentInput.run_in_background`: "Agents run in the background by default; you
 * will be notified when one completes. Set to false to run this agent
 * synchronously when you need its result before continuing." The model omits the
 * flag, so a `!== true` guard declines to act in precisely the case it exists
 * for. That regression shipped: the first milestone run on 0.3.220 detached both
 * subagents, reported `result: success` after 159s with one component left as a
 * `bal openapi` stub and the other never created at all, because the session
 * ended while its children were still working. Probed against 0.3.220: strip the
 * flag and the call returns `async_launched`; force it to `false` and the
 * subagent's result comes back inline.
 *
 * So the predicate is "not explicitly false" — anything else is made false. An
 * SDK that flips the default back costs one redundant rewrite, which is free;
 * getting it wrong the other way costs the run.
 *
 * Detached costs the whole progress feed. The SDK stops forwarding that
 * subagent's messages, so `parent_tool_use_id` is null on every message of the
 * run and there is nothing to attribute: measured on one such run, two subagents
 * made 33 and 47 tool calls and not one reached the feed with a tool name, a
 * path or a command. The only surviving signal is the task channel's narration
 * and a closing notification, and the section a reader opens is empty.
 *
 * It is not even faster. Each background launch is its own turn, so the
 * orchestrator had to finish generating the second subagent's prompt before it
 * could start the second component — serialising the LAUNCHES by two minutes,
 * where the foreground run had issued both in a single response.
 *
 * So this rewrites the flag rather than denying the call. Denying would cost the
 * fan-out; rewriting keeps every component building at once and gets the steps
 * back. The `aep` skill says the same thing in prose, but prose is advice and
 * this is the guarantee — one run already chose to background, and a feed that
 * goes dark whenever the model makes that choice is not a feed.
 */

import type { HookCallback, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

/** The tool names that fan work out to a subagent. Mirrors from-sdk.ts. */
const FANOUT_TOOLS = new Set(["Task", "Agent"]);

const BACKGROUND_FLAG = "run_in_background";

function isPreToolUseInput(input: unknown): input is PreToolUseHookInput {
  return (
    typeof input === "object" &&
    input !== null &&
    (input as { hook_event_name?: unknown }).hook_event_name === "PreToolUse"
  );
}

/**
 * The rewrite decision, separated from the hook plumbing so it can be tested
 * against a plain object. Returns the replacement input, or undefined to leave
 * the call alone.
 */
export function foregroundFanOutInput(
  toolName: string,
  toolInput: unknown,
): { updated: Record<string, unknown>; label: string } | undefined {
  if (!FANOUT_TOOLS.has(toolName)) return undefined;
  if (!toolInput || typeof toolInput !== "object") return undefined;
  const input = toolInput as Record<string, unknown>;
  // Not `=== true`: an omitted flag means BACKGROUND in this SDK (see above), and
  // omitted is what the model actually emits. Only an explicit `false` is already
  // what we want, and only that is left alone — so a rewrite always corresponds
  // to a real behaviour change and the announcement never lies.
  if (input[BACKGROUND_FLAG] === false) return undefined;
  const description = input.description;
  return {
    updated: { ...input, [BACKGROUND_FLAG]: false },
    label: typeof description === "string" && description ? description : "subagent",
  };
}

/**
 * PreToolUse hook that forces every fan-out call to run in the foreground.
 *
 * `onRewrite` is called with the subagent's description when a call is changed,
 * so the run says on its own feed that it did this. Silently altering what the
 * model asked for is the kind of thing that costs an hour when the behaviour is
 * eventually questioned.
 *
 * It is called at most ONCE per call, because the hook itself is not. Measured:
 * registering the same callback under a "Agent" matcher and a "Task" matcher
 * invoked it twice for a single `Agent` call — the two names reach the same
 * tool. The rewrite is idempotent so the outcome was right either way, but the
 * feed said it twice. Deduplicating here rather than by dropping a matcher keeps
 * the hook correct whatever a future build calls the tool.
 */
export function createForegroundFanOutHook(onRewrite?: (label: string) => void): HookCallback {
  const announced = new Set<string>();
  return async (input) => {
    if (!isPreToolUseInput(input)) return {};
    const rewrite = foregroundFanOutInput(input.tool_name, input.tool_input);
    if (!rewrite) return {};
    if (!announced.has(input.tool_use_id)) {
      announced.add(input.tool_use_id);
      onRewrite?.(rewrite.label);
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: "fan-out runs in the foreground so its steps stay on the progress feed",
        updatedInput: rewrite.updated,
      },
    };
  };
}
