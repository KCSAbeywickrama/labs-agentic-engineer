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

// Unit coverage for the claude adapter, one behaviour at a time.
//
// The two REAL recordings are replayed end to end through the run loop instead
// (run_loop.test.ts): what they pin is the shape of a whole session, which is a
// claim about the SDK rather than about one branch. What is here is the
// branches a fixture cannot reach on purpose — a failed agent, a severed
// command, a plan item, a heartbeat storm — plus every wording decision that
// has cost a run once.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createClaudeAdapter, type ClaudeAdapterOptions } from "./claude_adapter.js";
import type { RunEventInput, RunEventModelUsage, RunEventUsage } from "./emitter.js";

/** A fresh adapter per test: it is per-run state by design. */
function adapter(opts?: ClaudeAdapterOptions) {
  return createClaudeAdapter(opts);
}

/** One message through a throwaway adapter, for the branches that need no history. */
const once = (m: unknown): RunEventInput[] => adapter().translate(m);

// --- message builders --------------------------------------------------------

function assistant(parent: string | null, ...blocks: Record<string, unknown>[]): unknown {
  return { type: "assistant", message: { role: "assistant", content: blocks }, parent_tool_use_id: parent };
}

function toolUse(id: string, name: string, input: Record<string, unknown>): Record<string, unknown> {
  return { type: "tool_use", id, name, input };
}

function toolResult(
  parent: string | null,
  toolUseId: string,
  opts: { content?: unknown; isError?: boolean; structured?: unknown } = {},
): unknown {
  return {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: opts.content ?? "",
          ...(opts.isError ? { is_error: true } : {}),
        },
      ],
    },
    parent_tool_use_id: parent,
    ...(opts.structured !== undefined ? { tool_use_result: opts.structured } : {}),
  };
}

function agentStarted(
  taskId: string,
  toolUseId: string,
  extra: Record<string, unknown> = {},
): unknown {
  return {
    type: "system",
    subtype: "task_started",
    task_id: taskId,
    tool_use_id: toolUseId,
    description: "implement checkout",
    subagent_type: "general-purpose",
    is_backgrounded: true,
    spawn_depth: 1,
    task_type: "local_agent",
    ...extra,
  };
}

function notification(taskId: string, extra: Record<string, unknown> = {}): unknown {
  return {
    type: "system",
    subtype: "task_notification",
    task_id: taskId,
    status: "completed",
    summary: "REPORT: done",
    ...extra,
  };
}

/** Spawn one agent and hand back the adapter with it already registered. */
function withAgent(opts?: ClaudeAdapterOptions) {
  const a = adapter(opts);
  a.translate(assistant(null, toolUse("toolu_spawn", "Agent", { description: "implement checkout" })));
  a.translate(agentStarted("agent-1", "toolu_spawn"));
  return a;
}

// --- run_started -------------------------------------------------------------

test("adapter: the session's init opens the run and states the runtime it ran on", () => {
  const events = adapter({ taskKind: "validation" }).translate({
    type: "system",
    subtype: "init",
    model: "claude-sonnet-5",
  });
  assert.deepEqual(events, [
    { kind: "run_started", agentId: "lead", runtime: "claude-code", model: "claude-sonnet-5", taskKind: "validation" },
  ]);
});

// probe 2 has a second `init` when the notification wakes the lead for a new
// turn, and every spawned agent boots a session of its own. A second
// `run_started` would restart the run for every consumer that keys off it.
test("adapter: only the FIRST init opens the run", () => {
  const a = adapter();
  assert.equal(a.translate({ type: "system", subtype: "init", model: "m" }).length, 1);
  assert.deepEqual(a.translate({ type: "system", subtype: "init", model: "m" }), []);
});

// --- turn_ended and usage ----------------------------------------------------

test("adapter: an SDK result ends a TURN, never the run", () => {
  assert.deepEqual(once({ type: "result", subtype: "success" }), [
    { kind: "turn_ended", agentId: "lead", outcome: "success" },
  ]);
});

test("adapter: a failed turn carries the SDK's own errors, joined", () => {
  const events = once({ type: "result", subtype: "error_during_execution", errors: ["boom", "again"] });
  assert.deepEqual(events, [
    { kind: "turn_ended", agentId: "lead", outcome: "failure", error: "boom, again" },
  ]);
});

test("adapter: usage is the run's cumulative total, priced by the platform and not by us", () => {
  const events = once({
    type: "result",
    subtype: "success",
    total_cost_usd: 0.0157,
    usage: { input_tokens: 20, output_tokens: 354, cache_read_input_tokens: 55_935, cache_creation_input_tokens: 4_187 },
    modelUsage: {
      "claude-sonnet-5-20260101": {
        inputTokens: 20,
        outputTokens: 354,
        cacheReadInputTokens: 55_935,
        cacheCreationInputTokens: 4_187,
        canonicalModel: "claude-sonnet-5",
      },
    },
  });
  assert.deepEqual(events[0], {
    kind: "turn_ended",
    agentId: "lead",
    outcome: "success",
    usage: {
      inputTokens: 20,
      outputTokens: 354,
      cacheReadTokens: 55_935,
      cacheCreationTokens: 4_187,
      // A versioned release id collapses onto the alias the rate table is keyed by.
      model: "claude-sonnet-5",
      // The runtime reported $0.0157 and we do not repeat it: the platform
      // stamps a run's cost from its own rates, and two prices for one run is
      // two answers to one question.
      costUsd: null,
      // One model still gets a split: the aggregate agrees with it, and a
      // consumer that prices `models` never has to special-case the easy case.
      models: [
        {
          inputTokens: 20,
          outputTokens: 354,
          cacheReadTokens: 55_935,
          cacheCreationTokens: 4_187,
          model: "claude-sonnet-5",
          costUsd: null,
        },
      ],
    },
  });
});

test("adapter: a genuinely mixed-model turn reports no single model", () => {
  const events = once({
    type: "result",
    subtype: "success",
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    modelUsage: {
      "claude-sonnet-5": { inputTokens: 10, outputTokens: 4 },
      "claude-haiku-4-5": { inputTokens: 0, outputTokens: 1 },
    },
  });
  const usage = (events[0] as { usage: { model: string; outputTokens: number } }).usage;
  assert.equal(usage.model, "");
  assert.equal(usage.outputTokens, 5, "the aggregate still sums every model's slice");
});

test("adapter: a mixed-model turn carries the per-model split that makes it priceable", () => {
  // The regression this pins: an aggregate whose `model` is "" cannot be priced
  // at all, because cost is stamped per model against that model's own rate row.
  // Mixed-model turns are the normal case — the runtime reaches for small-model
  // helpers and a lead picks the model for the job — so folding the breakdown
  // away made real runs unbillable.
  const events = once({
    type: "result",
    subtype: "success",
    total_cost_usd: 0.42,
    usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    modelUsage: {
      "claude-opus-5-20260210": {
        inputTokens: 1_000,
        outputTokens: 200,
        cacheReadInputTokens: 30,
        cacheCreationInputTokens: 4,
        canonicalModel: "claude-opus-5",
      },
      // A second dated release of the SAME model: one rate row, so one slice.
      "claude-opus-5-20260301": {
        inputTokens: 500,
        outputTokens: 100,
        cacheReadInputTokens: 20,
        cacheCreationInputTokens: 6,
        canonicalModel: "claude-opus-5",
      },
      "claude-haiku-4-5": {
        inputTokens: 300,
        outputTokens: 40,
        cacheReadInputTokens: 5,
        cacheCreationInputTokens: 0,
      },
    },
  });
  const usage = (events[0] as { usage: RunEventUsage }).usage;

  assert.deepEqual(usage.models, [
    {
      inputTokens: 1_500,
      outputTokens: 300,
      cacheReadTokens: 50,
      cacheCreationTokens: 10,
      model: "claude-opus-5",
      costUsd: null,
    },
    {
      inputTokens: 300,
      outputTokens: 40,
      cacheReadTokens: 5,
      cacheCreationTokens: 0,
      model: "claude-haiku-4-5",
      costUsd: null,
    },
  ]);

  // The aggregate is unchanged by the split: it is a breakdown of the same
  // spend, not extra spend, so every existing reader still sees the same total.
  assert.equal(usage.model, "", "two models fold to the mixed-model aggregate");
  assert.equal(usage.inputTokens, 1_800);
  assert.equal(usage.outputTokens, 340);
  assert.equal(usage.cacheReadTokens, 55);
  assert.equal(usage.cacheCreationTokens, 10);
  const sum = (pick: (m: RunEventModelUsage) => number) =>
    (usage.models ?? []).reduce((n, m) => n + pick(m), 0);
  assert.equal(sum((m) => m.inputTokens), usage.inputTokens, "the aggregate is the sum of the slices");
  assert.equal(sum((m) => m.outputTokens), usage.outputTokens);
  assert.equal(sum((m) => m.cacheReadTokens), usage.cacheReadTokens);
  assert.equal(sum((m) => m.cacheCreationTokens), usage.cacheCreationTokens);
  // The runtime's own $0.42 never rides along: the platform stamps cost.
  assert.equal(usage.costUsd, null);
  for (const m of usage.models ?? []) assert.equal(m.costUsd, null);
});

test("adapter: a result with no modelUsage falls back to the turn's own counters", () => {
  const events = once({
    type: "result",
    subtype: "success",
    usage: { input_tokens: 7, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  });
  const usage = (events[0] as { usage: RunEventUsage }).usage;
  assert.equal(usage.inputTokens, 7);
  assert.equal(usage.model, "", "naming a model nothing reported would be a guess");
  // No split rather than an empty one: the contract reads an absent `models` as
  // "this producer reported none" and prices the aggregate instead, which is the
  // only thing that can be done with a result that named no model at all.
  assert.equal(usage.models, undefined);
});

test("adapter: a result with no usage at all carries none", () => {
  assert.equal((once({ type: "result", subtype: "success" })[0] as { usage?: unknown }).usage, undefined);
});

// --- the tool row ------------------------------------------------------------

test("adapter: a git commit reads as a commit, not as shell", () => {
  const events = once(assistant(null, toolUse("t1", "Bash", { command: 'git commit -m "feat: add checkout"' })));
  assert.deepEqual(events, [
    { kind: "git_commit", summary: "feat: add checkout", agentId: "lead", toolUseId: "t1" },
  ]);
});

test("adapter: a git push names the branch it pushed to", () => {
  const events = once(assistant(null, toolUse("t1", "Bash", { command: "git push -u origin milestone/v3" })));
  assert.deepEqual(events, [
    {
      kind: "git_push",
      branch: "milestone/v3",
      summary: "git push -u origin milestone/v3",
      agentId: "lead",
      toolUseId: "t1",
    },
  ]);
});

test("adapter: a gh call is an action against the host, not a shell line", () => {
  const events = once(assistant(null, toolUse("t1", "Bash", { command: "gh pr create --fill" })));
  assert.deepEqual(events, [
    { kind: "gh_action", command: "gh pr create --fill", agentId: "lead", toolUseId: "t1" },
  ]);
});

test("adapter: every other command is a tool row carrying the command", () => {
  const events = once(assistant(null, toolUse("t1", "Bash", { command: "bal build" })));
  assert.deepEqual(events, [{ kind: "tool_use", tool: "Bash", summary: "bal build", agentId: "lead", toolUseId: "t1" }]);
});

test("adapter: a file tool's row names the file, not its arguments", () => {
  const events = once(assistant(null, toolUse("t1", "Edit", { file_path: "/w/p/api/service.bal", old_string: "a" })));
  assert.equal((events[0] as { summary: string }).summary, "/w/p/api/service.bal");
});

// `$ Skill {"skill":"aep:aep"}` reached a live feed before this existed.
test("adapter: a tool with no path still gets a readable row", () => {
  assert.equal((once(assistant(null, toolUse("t1", "Skill", { skill: "aep" })))[0] as { summary: string }).summary, "aep");
});

test("adapter: several tool_use blocks in one message stay in order", () => {
  const events = once(
    assistant(
      null,
      toolUse("t1", "Read", { file_path: "a.md" }),
      toolUse("t2", "Read", { file_path: "b.md" }),
    ),
  );
  assert.deepEqual(events.map((e) => (e as { toolUseId: string }).toolUseId), ["t1", "t2"]);
});

test("adapter: a long command is bounded", () => {
  const events = once(assistant(null, toolUse("t1", "Bash", { command: "echo " + "x".repeat(500) })));
  const summary = (events[0] as { summary: string }).summary;
  assert.equal(summary.length, 200);
  assert.match(summary, /…$/);
});

// --- attribution -------------------------------------------------------------

test("adapter: the lead's own work is the lead's", () => {
  const events = once(assistant(null, toolUse("t1", "Read", { file_path: "a.md" })));
  assert.equal((events[0] as { agentId: string }).agentId, "lead");
});

test("adapter: a forwarded message is attributed to the AGENT, by its runtime id", () => {
  const a = withAgent();
  const events = a.translate(assistant("toolu_spawn", toolUse("t9", "Bash", { command: "npm ci" })));
  assert.equal((events[0] as { agentId: string }).agentId, "agent-1", "not the spawning call id, the agent's own");
});

// The failure this prevents is the whole reason the surface exists: filing an
// agent's work under the lead makes a run look like one agent doing everything.
test("adapter: an agent we never saw start is still not the lead", () => {
  const events = once(assistant("toolu_unknown", toolUse("t9", "Bash", { command: "ls" })));
  assert.equal((events[0] as { agentId: string }).agentId, "toolu_unknown");
});

test("adapter: two agents at once are told apart", () => {
  const a = adapter();
  a.translate(assistant(null, toolUse("s1", "Agent", { description: "build api" })));
  a.translate(assistant(null, toolUse("s2", "Agent", { description: "build webapp" })));
  a.translate(agentStarted("agent-api", "s1", { description: "build api" }));
  a.translate(agentStarted("agent-web", "s2", { description: "build webapp" }));

  const one = a.translate(assistant("s1", toolUse("t1", "Bash", { command: "bal build" })));
  const two = a.translate(assistant("s2", toolUse("t2", "Bash", { command: "npm ci" })));
  assert.equal((one[0] as { agentId: string }).agentId, "agent-api");
  assert.equal((two[0] as { agentId: string }).agentId, "agent-web");
});

// The SDK's fan-out tool was `Task` before 0.3 and the skill prose still says
// it. Recognising both is what stops a rename dropping every label.
test("adapter: `Task` names the same fan-out tool as `Agent`", () => {
  const a = adapter();
  assert.deepEqual(a.translate(assistant(null, toolUse("s1", "Task", { description: "build api" }))), []);
  const started = a.translate(agentStarted("agent-1", "s1", { description: "build api" }));
  assert.equal((started[0] as { label: string }).label, "build api");
});

// --- the declared tree -------------------------------------------------------

test("adapter: task_started IS the agent, with everything the runtime declared", () => {
  const a = adapter();
  a.translate(assistant(null, toolUse("toolu_spawn", "Agent", { description: "implement checkout", model: "haiku" })));
  const events = a.translate(agentStarted("agent-1", "toolu_spawn"));
  assert.deepEqual(events, [
    {
      kind: "agent_started",
      agentId: "agent-1",
      label: "implement checkout",
      role: "general-purpose",
      depth: 1,
      background: true,
      model: "haiku",
    },
  ]);
});

// The contract: absence means the lead, so repeating it would make absence
// ambiguous.
test("adapter: a depth-1 agent names no parent, because its parent is the lead", () => {
  const started = withAgent();
  const events = started.translate(agentStarted("agent-2", "toolu_other"));
  assert.equal((events[0] as { parentAgentId?: string }).parentAgentId, undefined);
});

// The join that makes a tree out of a flat stream — see the module header.
test("adapter: a depth-2 agent names the agent that spawned it", () => {
  const a = withAgent();
  // The child's spawning call is issued from INSIDE agent-1, so its own message
  // carries agent-1's spawning call id.
  a.translate(assistant("toolu_spawn", toolUse("toolu_child", "Agent", { description: "walk the app" })));
  const events = a.translate(
    agentStarted("agent-2", "toolu_child", { description: "walk the app", spawn_depth: 2, is_backgrounded: false }),
  );
  assert.deepEqual(events, [
    {
      kind: "agent_started",
      agentId: "agent-2",
      parentAgentId: "agent-1",
      label: "walk the app",
      role: "general-purpose",
      depth: 2,
      background: false,
    },
  ]);
});

// Absence is not `false`: it means the runtime did not say, and an explicit
// `false` is a positive confirmation that a spawn ran inside its parent's turn.
test("adapter: a runtime that says nothing about backgrounding says nothing", () => {
  const a = adapter();
  const events = a.translate(agentStarted("agent-1", "", { is_backgrounded: undefined }));
  assert.equal((events[0] as { background?: boolean }).background, undefined);
});

// The row is the agent, not the call that made it: printing both says the same
// sentence twice, once as a dump of the prompt.
test("adapter: a fan-out CALL puts nothing on the feed", () => {
  assert.deepEqual(
    once(assistant(null, toolUse("s1", "Agent", { description: "build api", prompt: "a very long prompt" }))),
    [],
  );
});

test("adapter: a fan-out's launch ack and its final result BOTH put nothing on the feed", () => {
  const a = withAgent();
  assert.deepEqual(
    a.translate(toolResult(null, "toolu_spawn", { structured: { isAsync: true, status: "async_launched" } })),
    [],
    "the launch is the agent starting, not finishing",
  );
  assert.deepEqual(
    a.translate(toolResult(null, "toolu_spawn", { content: "REPORT: done", structured: { status: "completed" } })),
    [],
    "the settle is the notification, which is the one signal both shapes produce",
  );
});

// --- an agent's progress and its settle --------------------------------------

test("adapter: an agent's narration repaints its row and is never a row of its own", () => {
  const a = withAgent();
  const events = a.translate({
    type: "system",
    subtype: "task_progress",
    task_id: "agent-1",
    description: "Writing todo-api/service.bal",
    usage: { total_tokens: 21_306, tool_uses: 4, duration_ms: 4_861 },
  });
  assert.deepEqual(events, [
    { kind: "agent_progress", agentId: "agent-1", phrase: "Writing todo-api/service.bal", toolCount: 4, tokens: 21_306 },
  ]);
});

test("adapter: the notification settles the agent, carrying the report it ended on", () => {
  const a = withAgent();
  const events = a.translate(
    notification("agent-1", { summary: "REPORT: alpha done, 1 file", usage: { total_tokens: 22_970, tool_uses: 3, duration_ms: 9_660 } }),
  );
  assert.deepEqual(events, [
    {
      kind: "agent_settled",
      agentId: "agent-1",
      status: "completed",
      report: "REPORT: alpha done, 1 file",
      durationMs: 9_660,
      toolCount: 3,
      tokens: 22_970,
    },
  ]);
});

// A report is the runtime's own LAST line: an agent that narrates before
// concluding puts its conclusion at the end, and the whole summary is not a row.
test("adapter: a multi-line summary reports its last line", () => {
  const a = withAgent();
  const events = a.translate(notification("agent-1", { summary: "Waiting for the build…\n\nREPORT: 3 files" }));
  assert.equal((events[0] as { report: string }).report, "REPORT: 3 files");
});

test("adapter: a report is bounded — it is a line, not a transcript", () => {
  const a = withAgent();
  const events = a.translate(notification("agent-1", { summary: "x".repeat(5_000) }));
  const report = (events[0] as { report: string }).report;
  assert.equal(report.length, 500);
  assert.match(report, /…$/);
});

test("adapter: an agent settles once — a second notification changes nothing", () => {
  const a = withAgent();
  assert.equal(a.translate(notification("agent-1")).length, 1);
  assert.deepEqual(a.translate(notification("agent-1")), []);
});

test("adapter: an agent that failed says so, in the runtime's own word", () => {
  const a = withAgent();
  const events = a.translate(notification("agent-1", { status: "failed", summary: "could not build" }));
  assert.equal((events[0] as { status: string }).status, "failed");
});

// A word we do not have a meaning for is not reported as one we do: `status` is
// a closed set, and inventing "completed" for an unknown verdict would paint a
// failure green.
test("adapter: a verdict word outside the contract's set is omitted, not coerced", () => {
  const a = withAgent();
  const events = a.translate(notification("agent-1", { status: "exploded" }));
  assert.equal((events[0] as { status?: string }).status, undefined);
});

test("adapter: the runtime's own duration beats ours, and ours is the fallback", () => {
  let clock = 1_000;
  const a = withAgent({ now: () => clock });
  clock = 9_000;
  const measured = a.translate(notification("agent-1"));
  assert.equal((measured[0] as { durationMs: number }).durationMs, 8_000);
});

test("adapter: a task message about something this run never started is ignored", () => {
  const a = adapter();
  assert.deepEqual(a.translate(notification("nobody")), []);
  assert.deepEqual(a.translate({ type: "system", subtype: "task_progress", task_id: "nobody", description: "x" }), []);
});

// --- line deltas -------------------------------------------------------------

// On SDK 0.3.220 this was impossible — ADR-0002 recorded "+N/−N lines cannot be
// derived from this feed" — because a spawned agent's steps were not forwarded.
// They are on 0.3.247, so the inputs are on the wire and can be counted.
test("adapter: an agent's line deltas are counted from the edits it actually landed", () => {
  const a = withAgent();
  a.translate(assistant("toolu_spawn", toolUse("w1", "Write", { file_path: "a.bal", content: "one\ntwo\nthree" })));
  a.translate(toolResult("toolu_spawn", "w1", { content: "File created" }));
  a.translate(assistant("toolu_spawn", toolUse("e1", "Edit", { file_path: "a.bal", old_string: "one", new_string: "1\n2" })));
  a.translate(toolResult("toolu_spawn", "e1", { content: "edited" }));

  const events = a.translate(notification("agent-1"));
  assert.equal((events[0] as { linesAdded: number }).linesAdded, 5);
  assert.equal((events[0] as { linesRemoved: number }).linesRemoved, 1);
});

test("adapter: a write that FAILED wrote nothing, and is not counted", () => {
  const a = withAgent();
  a.translate(assistant("toolu_spawn", toolUse("w1", "Write", { file_path: "a.bal", content: "one\ntwo" })));
  a.translate(toolResult("toolu_spawn", "w1", { content: "<tool_use_error>denied</tool_use_error>", isError: true }));
  const events = a.translate(notification("agent-1"));
  assert.equal((events[0] as { linesAdded?: number }).linesAdded, undefined);
});

// The runtime's own figures are better where they exist — they see an edit made
// through a shell heredoc, which counting cannot — so they win when they arrive
// in time. Measured, they usually do not: the fan-out result lands one message
// AFTER the notification.
test("adapter: the runtime's own toolStats beat the counted figures when they arrive first", () => {
  const a = withAgent();
  a.translate(assistant("toolu_spawn", toolUse("w1", "Write", { file_path: "a.bal", content: "one" })));
  a.translate(toolResult("toolu_spawn", "w1", { content: "File created" }));
  a.translate(toolResult(null, "toolu_spawn", { structured: { status: "completed", toolStats: { linesAdded: 553, linesRemoved: 4 } } }));

  const events = a.translate(notification("agent-1"));
  assert.equal((events[0] as { linesAdded: number }).linesAdded, 553);
  assert.equal((events[0] as { linesRemoved: number }).linesRemoved, 4);
});

// --- a failed agent ----------------------------------------------------------

// ADR-0002 decision 5: this text is the LAST copy of the reason. The agent's
// transcript is not on this feed and claude.log dies with the pod, so a live run
// once left a 22-minute agent arriving as a bare failure with the cause recorded
// nowhere at all.
test("adapter: a failed agent's error text reaches the feed, attributed to it", () => {
  const a = withAgent();
  const events = a.translate(
    toolResult(null, "toolu_spawn", { content: "Error: bal build failed\nsecond line", isError: true }),
  );
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    kind: "notice",
    agentId: "agent-1",
    level: "error",
    detail: "[fan-out] implement checkout failed: Error: bal build failed | second line",
  });
});

test("adapter: an agent that failed with no text says so, rather than saying nothing", () => {
  const a = withAgent();
  const events = a.translate(toolResult(null, "toolu_spawn", { structured: { status: "failed" } }));
  assert.match((events[0] as { detail: string }).detail, /no error text on the tool result \(status failed\)/);
});

test("adapter: a successful agent adds no failure line", () => {
  const a = withAgent();
  assert.deepEqual(a.translate(toolResult(null, "toolu_spawn", { structured: { status: "completed" } })), []);
});

// --- tool outcomes -----------------------------------------------------------

test("adapter: a tool_result pairs with its call, carrying the tool and a measured duration", () => {
  let clock = 1_000;
  const a = adapter({ now: () => clock });
  a.translate(assistant(null, toolUse("t1", "Bash", { command: "bal build" })));
  clock = 13_600;
  const events = a.translate(toolResult(null, "t1", { content: "ok" }));
  assert.deepEqual(events, [
    { kind: "tool_result", agentId: "lead", toolUseId: "t1", ok: true, tool: "Bash", durationMs: 12_600 },
  ]);
});

test("adapter: a failed call carries its diagnosis and its exit code", () => {
  const a = adapter();
  a.translate(assistant(null, toolUse("t1", "Bash", { command: "bal build" })));
  const events = a.translate(
    toolResult(null, "t1", { content: "Exit code 1\nCompiling source\nERROR [service.bal:(3:1,3:9)] undefined symbol", isError: true }),
  );
  assert.equal((events[0] as { ok: boolean }).ok, false);
  assert.equal((events[0] as { exitCode: number }).exitCode, 1);
  // NOT "Compiling source": nine lines of dependency chatter precede a real
  // build's first ERROR, so "the line after the code" diagnoses nothing.
  assert.equal((events[0] as { summary: string }).summary, "ERROR [service.bal:(3:1,3:9)] undefined symbol");
});

test("adapter: a diagnosis that ends in a colon takes the line it was introducing", () => {
  const events = adapter().translate(
    toolResult(null, "t1", {
      content: "<tool_use_error>InputValidationError: Read failed due to the following issue:\nFile does not exist.</tool_use_error>",
      isError: true,
    }),
  );
  assert.equal(
    (events[0] as { summary: string }).summary,
    "InputValidationError: Read failed due to the following issue: File does not exist.",
  );
});

test("adapter: a result for a call this adapter never saw still reports its outcome", () => {
  const events = adapter().translate(toolResult(null, "toolu_unknown", { content: "boom", isError: true }));
  assert.equal((events[0] as { ok: boolean }).ok, false);
  assert.equal((events[0] as { tool?: string }).tool, undefined, "no call, no tool name — nothing is invented");
});

test("adapter: a call is paired once — a duplicate result does not re-measure it", () => {
  let clock = 0;
  const a = adapter({ now: () => clock });
  a.translate(assistant(null, toolUse("t1", "Bash", { command: "ls" })));
  clock = 5_000;
  a.translate(toolResult(null, "t1", { content: "ok" }));
  clock = 60_000;
  const again = a.translate(toolResult(null, "t1", { content: "ok" }));
  assert.equal((again[0] as { durationMs?: number }).durationMs, undefined);
});

test("adapter: a rewritten Bash call keeps its id, so its outcome finds its row", () => {
  const a = adapter();
  const call = a.translate(assistant(null, toolUse("g1", "Bash", { command: "git push origin main" })));
  const outcome = a.translate(toolResult(null, "g1", { content: "ok" }));
  assert.equal((call[0] as { toolUseId: string }).toolUseId, "g1");
  assert.equal((outcome[0] as { toolUseId: string }).toolUseId, "g1");
});

// #701: a command severed at the Bash ceiling comes back with code 0 and empty
// output, and the feed reported it as a success while the tests it was running
// had never finished.
test("adapter: a severed command is reported as a failure that proved nothing", () => {
  const a = adapter();
  a.translate(assistant(null, toolUse("t1", "Bash", { command: "npm test" })));
  const events = a.translate(toolResult(null, "t1", { structured: { timedOutAfterMs: 120_000 } }));
  assert.equal((events[0] as { ok: boolean }).ok, false);
  assert.match((events[0] as { summary: string }).summary, /hit its 120\.0s timeout and was detached/);
  assert.match((events[0] as { summary: string }).summary, /this call proved nothing/);
});

test("adapter: only a call that actually finished settles an outcome", () => {
  const settled: [string, boolean][] = [];
  const a = adapter({ onToolOutcome: (id, ok) => settled.push([id, ok]) });
  a.translate(assistant(null, toolUse("t1", "Bash", { command: "npm test" })));
  a.translate(toolResult(null, "t1", { structured: { timedOutAfterMs: 1_000 } }));
  a.translate(assistant(null, toolUse("t2", "Bash", { command: "npm run dev" })));
  a.translate(toolResult(null, "t2", { structured: { backgroundTaskId: "bo1" } }));
  a.translate(assistant(null, toolUse("t3", "Bash", { command: "npm test" })));
  a.translate(toolResult(null, "t3", { content: "ok" }));
  assert.deepEqual(settled, [["t3", true]]);
});

// --- backgrounded shell commands ---------------------------------------------

test("adapter: a backgrounded command is a task of its own, owned by the agent that ran it", () => {
  const a = withAgent();
  a.translate(assistant("toolu_spawn", toolUse("b1", "Bash", { command: "sleep 25 && echo done", run_in_background: true })));
  const started = a.translate({
    type: "system",
    subtype: "task_started",
    task_id: "bo1",
    tool_use_id: "b1",
    description: "Sleep for 25 seconds",
    task_type: "local_bash",
    is_backgrounded: true,
  });
  assert.deepEqual(started, [
    { kind: "task_started", agentId: "agent-1", taskId: "bo1", command: "sleep 25 && echo done" },
  ]);

  // `stopped` at session end is what names an orphan: the command never
  // finished, and the run ended anyway.
  const settled = a.translate({ type: "system", subtype: "task_notification", task_id: "bo1", status: "stopped" });
  assert.deepEqual(settled, [{ kind: "task_settled", agentId: "agent-1", taskId: "bo1", status: "stopped" }]);
});

// ADR-0002's known limit, carried over: a runtime that does not name the call
// leaves the description as the only thing the two messages share. Anything
// less certain than a match is the lead's, because a guess between two agents
// is worse than none.
test("adapter: without a tool_use_id the owner is matched on the command, else the lead", () => {
  const a = withAgent();
  a.translate(assistant("toolu_spawn", toolUse("b1", "Bash", { command: "sleep 25" })));
  const matched = a.translate({
    type: "system",
    subtype: "task_started",
    task_id: "bo1",
    description: "sleep 25",
    task_type: "local_bash",
  });
  assert.equal((matched[0] as { agentId: string }).agentId, "agent-1");

  const unmatched = a.translate({
    type: "system",
    subtype: "task_started",
    task_id: "bo2",
    description: "something nobody ran",
    task_type: "local_bash",
  });
  assert.equal((unmatched[0] as { agentId: string }).agentId, "lead");
});

// --- the lead's plan ---------------------------------------------------------

// The id is minted by the runtime and arrives on the RESULT, so the two halves
// have to be paired: an item with no id is a row a consumer cannot fold on.
test("adapter: a created plan entry waits for its id and then becomes a work item", () => {
  const a = adapter();
  assert.deepEqual(
    a.translate(assistant(null, toolUse("p1", "TaskCreate", { subject: "Implement issue #3", description: "…" }))),
    [],
    "nothing can be emitted until the id exists",
  );
  const events = a.translate(toolResult(null, "p1", { structured: { task: { id: "task_7", subject: "Implement issue #3" } } }));
  assert.deepEqual(events, [
    { kind: "work_item", agentId: "lead", source: "plan", itemId: "task_7", title: "Implement issue #3", itemStatus: "pending" },
  ]);
});

test("adapter: a plan entry's status change is the row repainting", () => {
  const events = once(assistant(null, toolUse("p2", "TaskUpdate", { taskId: "task_7", status: "in_progress" })));
  assert.deepEqual(events, [
    { kind: "work_item", agentId: "lead", source: "plan", itemId: "task_7", itemStatus: "in_progress" },
  ]);
});

test("adapter: a plan entry an AGENT owns names that agent", () => {
  const a = withAgent();
  const events = a.translate(assistant("toolu_spawn", toolUse("p2", "TaskUpdate", { taskId: "task_7", status: "completed" })));
  assert.equal((events[0] as { ownerAgentId: string }).ownerAgentId, "agent-1");
});

// The runtime's `owner` is a free-form string, so passing it through would put a
// value in an agentId-shaped field that resolves to no agent.
test("adapter: an owner that names no agent of this run is not treated as one", () => {
  const events = once(assistant(null, toolUse("p2", "TaskUpdate", { taskId: "task_7", owner: "somebody" })));
  assert.equal((events[0] as { ownerAgentId?: string }).ownerAgentId, undefined);
});

test("adapter: reading the plan changes nothing a reader needs to see", () => {
  assert.deepEqual(once(assistant(null, toolUse("p3", "TaskList", {}))), []);
  assert.deepEqual(once(assistant(null, toolUse("p4", "TaskGet", { taskId: "task_7" }))), []);
});

// --- heartbeats --------------------------------------------------------------

// NEITHER recording contains a `tool_progress` message — both probes finish
// their calls far inside the interval that produces one — so this branch is
// exercised against a synthetic message shaped from the SDK's own type
// (SDKToolProgressMessage: top-level `type`, `tool_use_id`,
// `parent_tool_use_id`, `elapsed_time_seconds`). If a re-recording ever
// captures one, replace this with the fixture.
test("adapter: a tool that is still running says which call, and for how long", () => {
  const a = withAgent();
  const events = a.translate({
    type: "tool_progress",
    tool_use_id: "t9",
    tool_name: "Bash",
    parent_tool_use_id: "toolu_spawn",
    elapsed_time_seconds: 42.5,
  });
  assert.deepEqual(events, [
    { kind: "heartbeat", agentId: "agent-1", waitingOn: "tool", ref: "t9", elapsedMs: 42_500 },
  ]);
});

test("adapter: a thinking-token delta says the MODEL is what is being waited on", () => {
  const events = once({ type: "system", subtype: "thinking_tokens", estimated_tokens: 400 });
  // No `ref`: the wait is the emitting agent's own turn, which `agentId` names.
  assert.deepEqual(events, [{ kind: "heartbeat", agentId: "lead", waitingOn: "model" }]);
});

test("adapter: at most one heartbeat per agent per interval", () => {
  let clock = 0;
  const a = adapter({ now: () => clock, heartbeatIntervalMs: 10_000 });
  const frame = { type: "system", subtype: "thinking_tokens" };
  assert.equal(a.translate(frame).length, 1, "the first one goes out at once");
  for (let i = 0; i < 50; i++) {
    clock += 100;
    assert.deepEqual(a.translate(frame), [], "everything inside the window is dropped");
  }
  clock += 5_000;
  assert.equal(a.translate(frame).length, 1, "the window reopens");
});

// The budget is per AGENT, so a run with four agents waiting still says so about
// all four rather than about whichever one spoke first.
test("adapter: the heartbeat budget is per agent, not per run", () => {
  const clock = 0;
  const a = withAgent({ now: () => clock, heartbeatIntervalMs: 10_000 });
  assert.equal(a.translate({ type: "system", subtype: "thinking_tokens" }).length, 1);
  assert.equal(
    a.translate({ type: "tool_progress", tool_use_id: "t9", parent_tool_use_id: "toolu_spawn", elapsed_time_seconds: 1 }).length,
    1,
    "a different agent has its own budget",
  );
});

// --- transcripts -------------------------------------------------------------

// Recorded, never emitted: narration is deliberately off the wire, and the
// design's storage decision is that a pod's transcripts stay local. This is the
// seam the runtime port's artifacts() reads.
test("adapter: a spawned agent's transcript is recorded and put on no feed", () => {
  const a = withAgent();
  a.noteTranscript("agent-1", "/tmp/session/subagents/agent-1.jsonl");
  a.noteTranscript("", "/tmp/nothing.jsonl");
  a.noteTranscript("agent-2", "");
  assert.deepEqual(a.artifacts(), [
    { agentId: "agent-1", path: "/tmp/session/subagents/agent-1.jsonl", kind: "transcript" },
  ]);
});

// --- everything else ---------------------------------------------------------

test("adapter: the messages that explain a silence are the run loop's, not a row", () => {
  // They become notices there, and routing them through here would make each one
  // count as the agent making progress — the opposite of what they say.
  assert.deepEqual(once({ type: "system", subtype: "api_retry", attempt: 1 }), []);
  assert.deepEqual(once({ type: "system", subtype: "compact_boundary" }), []);
  assert.deepEqual(once({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } }), []);
});

test("adapter: task_updated feeds the registry and puts nothing on the feed", () => {
  assert.deepEqual(
    once({ type: "system", subtype: "task_updated", task_id: "bo1", patch: { status: "killed" } }),
    [],
  );
});

test("adapter: an unknown message, and a malformed one, produce nothing", () => {
  assert.deepEqual(once({ type: "post_turn_summary" }), []);
  assert.deepEqual(once({ type: "assistant", message: {} }), []);
  assert.deepEqual(once(null), []);
  assert.deepEqual(once("not a message"), []);
});
