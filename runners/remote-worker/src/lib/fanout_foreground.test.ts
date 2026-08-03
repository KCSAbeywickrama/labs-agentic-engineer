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
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { createForegroundFanOutHook, foregroundFanOutInput } from "./fanout_foreground.js";

const preToolUse = (toolName: string, toolInput: unknown): HookInput => ({
  hook_event_name: "PreToolUse",
  tool_name: toolName,
  tool_input: toolInput,
  tool_use_id: "toolu_01",
  session_id: "s1",
  transcript_path: "/tmp/t",
  cwd: "/workspace/project",
}) as HookInput;

test("fanout: a backgrounded fan-out is rewritten to the foreground", () => {
  const rewrite = foregroundFanOutInput("Agent", {
    description: "Implement todo-api Ballerina service (issue #3)",
    prompt: "…",
    run_in_background: true,
  });
  assert.ok(rewrite);
  assert.equal(rewrite.updated.run_in_background, false);
  // Everything else survives: this is a flag change, not a re-authored call.
  assert.equal(rewrite.updated.prompt, "…");
  assert.equal(rewrite.label, "Implement todo-api Ballerina service (issue #3)");
});

test("fanout: Task is rewritten too", () => {
  assert.ok(foregroundFanOutInput("Task", { run_in_background: true }));
});

test("fanout: an OMITTED flag is rewritten — background is the SDK default", () => {
  // The case that matters most, and the one the model actually emits: it names no
  // flag at all. Under SDK 0.3.220 that means background, so leaving it alone
  // detaches the subagent. This assertion is the regression pin — a `!== true`
  // guard passes every other test in this file and fails only this one.
  const rewrite = foregroundFanOutInput("Agent", { description: "Implement todo-webapp React SPA", prompt: "…" });
  assert.ok(rewrite);
  assert.equal(rewrite.updated.run_in_background, false);
  assert.equal(rewrite.updated.prompt, "…");
});

test("fanout: an explicitly foreground fan-out is left alone", () => {
  // The one input already in the desired state. Rewriting it would announce a
  // rewrite that changed nothing, on every fan-out that spelled the flag out.
  assert.equal(foregroundFanOutInput("Agent", { description: "x", run_in_background: false }), undefined);
});

test("fanout: other tools are left alone", () => {
  assert.equal(foregroundFanOutInput("Bash", { command: "ls", run_in_background: true }), undefined);
});

test("fanout: the hook allows the call with the flag cleared, and says so", () => {
  const seen: string[] = [];
  const hook = createForegroundFanOutHook((label) => seen.push(label));

  return hook(preToolUse("Agent", { description: "Implement todo-webapp", run_in_background: true }), undefined, {
    signal: new AbortController().signal,
  }).then((out) => {
    const specific = (out as { hookSpecificOutput?: Record<string, unknown> }).hookSpecificOutput;
    assert.equal(specific?.hookEventName, "PreToolUse");
    // Rewritten, not denied: denying would cost the fan-out, which is the thing
    // worth keeping. Only the detachment is the problem.
    assert.equal(specific?.permissionDecision, "allow");
    assert.deepEqual(specific?.updatedInput, { description: "Implement todo-webapp", run_in_background: false });
    assert.deepEqual(seen, ["Implement todo-webapp"]);
  });
});

test("fanout: the hook is inert for everything else", async () => {
  const hook = createForegroundFanOutHook();
  const ctx = { signal: new AbortController().signal };
  const otherEvent = { ...preToolUse("Agent", { run_in_background: true }), hook_event_name: "PostToolUse" } as HookInput;
  assert.deepEqual(await hook(preToolUse("Agent", { description: "x", run_in_background: false }), undefined, ctx), {});
  assert.deepEqual(await hook(preToolUse("Read", { file_path: "/a" }), undefined, ctx), {});
  assert.deepEqual(await hook(otherEvent, undefined, ctx), {});
});

test("fanout: one call is announced once, however many times the hook fires", () => {
  // The runner registers this callback under two matchers and both reach the
  // same tool, so the SDK invokes it twice for one fan-out. Measured on a live
  // run against the real image.
  const seen: string[] = [];
  const hook = createForegroundFanOutHook((label) => seen.push(label));
  const call = preToolUse("Agent", { description: "proof subagent", run_in_background: true });
  const ctx = { signal: new AbortController().signal };

  return Promise.all([hook(call, undefined, ctx), hook(call, undefined, ctx)]).then((outs) => {
    // Both still rewrite — the flag must be cleared on whichever invocation the
    // SDK actually applies, not only the first one we happened to see.
    for (const out of outs) {
      const specific = (out as { hookSpecificOutput?: Record<string, unknown> }).hookSpecificOutput;
      assert.equal((specific?.updatedInput as Record<string, unknown>).run_in_background, false);
    }
    assert.deepEqual(seen, ["proof subagent"]);
  });
});
