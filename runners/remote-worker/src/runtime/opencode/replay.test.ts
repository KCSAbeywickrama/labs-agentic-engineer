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

// The four OpenCode recordings (spikes S1c, S2b, S2c, S4i — test/fixtures/
// README.md) replayed through EVERYTHING a live run reads them through: the
// session stream and its close rule (settle.ts), the classifier, the
// translator, and the real run loop. Two kinds of assertion:
//
//   - a GOLDEN per recording (`test/fixtures/opencode-*.loop.ndjson`): the
//     loop's whole transcript — every run event, every watchdog call, every
//     raw-log write, every observer call, and where the stream closed. A diff is
//     a behaviour change; regenerate with `AEP_UPDATE_GOLDEN=1 pnpm test` and
//     say why, never by hand.
//   - the FACTS the design measured, asserted by name, so a regenerated golden
//     cannot quietly lose one: S2b settles once with 3 + 1 children attributed
//     to the right parents and their reports read; usage is per model; S2c's
//     background shape closes early, which is why it is refused.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { consumeRun, type RunResult } from "../../lib/run_loop.js";
import type { RunWatchdog } from "../../lib/progress/watchdog.js";
import type { RunEventInput } from "../../lib/progress/emitter.js";
import { createOpencodeClassifier } from "./classify.js";
import { createStreamCloser, sessionStream } from "./settle.js";
import { createOpencodeAdapter } from "./translate.js";

const FIXTURES = new URL("../../../test/fixtures/", import.meta.url);

/** A recording: one bus event per line, each stamped by the probe with `t` (ms since start). */
function recording(name: string): Record<string, unknown>[] {
  return fs
    .readFileSync(new URL(name, FIXTURES), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

interface Replay {
  lines: string[];
  events: RunEventInput[];
  result: RunResult;
  /** How many recorded events the stream yielded before it closed. */
  consumed: number;
  total: number;
}

/**
 * Replay one recording and return the loop's transcript.
 *
 * Deterministic: the translator's clock is the probe's own `t` for the event
 * being read, so durations are the recorded ones; the classifier's clock is
 * pinned (no recording carries a retry).
 */
async function replay(name: string): Promise<Replay> {
  const messages = recording(name);
  const lines: string[] = [];
  const events: RunEventInput[] = [];
  const log = (o: unknown): void => {
    lines.push(JSON.stringify(o));
  };
  let cursor = 0;
  let clock = 1_000_000;
  async function* source(): AsyncGenerator<unknown> {
    for (let i = 0; i < messages.length; i++) {
      cursor = i + 1;
      clock = 1_000_000 + Number(messages[i].t ?? 0);
      yield messages[i];
    }
  }
  const emit = (event: RunEventInput): void => {
    events.push(event);
    log({ at: cursor, event });
  };
  const watchdog: RunWatchdog = {
    observe: (evs) => log({ at: cursor, wd: "observe", n: evs.length }),
    observeRetry: (info) => log({ at: cursor, wd: "observeRetry", info }),
    observeStream: () => log({ at: cursor, wd: "observeStream" }),
    check: () => {},
    describe: () => "WD",
    start: () => () => {},
  };
  const adapter = createOpencodeAdapter({
    model: "claude-haiku-4-5",
    taskKind: "implementation",
    now: () => clock,
    onToolUse: (call, id) => log({ at: cursor, toolUse: call, id }),
    onToolOutcome: (id, ok) => log({ at: cursor, toolOutcome: ok, id }),
    // The runner's own onDenied wording (lib/runner.ts), so the golden shows
    // the line a live run would put on the feed.
    onWorkspaceDenied: (reason) =>
      emit({ kind: "notice", level: "warn", code: "workspace_guard", detail: `[workspace] ${reason}` }),
  });
  const result = await consumeRun(
    {
      messages: sessionStream(source(), createStreamCloser(), {
        skills: [],
        onPermissionAsked: (p) => log({ at: cursor, rejectPermission: p.id }),
      }),
      stopTask: async (id) => log({ at: cursor, stopTask: id }),
    },
    {
      translate: adapter.translate,
      classify: createOpencodeClassifier({ now: () => 0 }),
      watchdog,
      emit,
      record: (m) => log({ at: cursor, record: m && typeof m === "object" ? ((m as { type?: string }).type ?? "?") : String(m) }),
      inputGraceMs: 20,
    },
  );
  log({ result, consumed: cursor, of: messages.length });
  return { lines, events, result, consumed: cursor, total: messages.length };
}

async function assertGolden(actual: Replay, golden: string): Promise<void> {
  const text = actual.lines.join("\n") + "\n";
  const file = new URL(golden, FIXTURES);
  if (process.env.AEP_UPDATE_GOLDEN === "1") {
    fs.writeFileSync(file, text);
    return;
  }
  assert.equal(text, fs.readFileSync(file, "utf8"), `the OpenCode replay moved — see ${golden}`);
}

function ofKind<K extends RunEventInput["kind"]>(events: RunEventInput[], kind: K): (RunEventInput & { kind: K })[] {
  return events.filter((e): e is RunEventInput & { kind: K } => e.kind === kind);
}

for (const [fixture, golden] of [
  ["opencode-s2b-foreground-fanout.jsonl", "opencode-s2b-foreground-fanout.loop.ndjson"],
  ["opencode-s1c-guards-allowlists.jsonl", "opencode-s1c-guards-allowlists.loop.ndjson"],
  ["opencode-s2c-background-experimental.jsonl", "opencode-s2c-background-experimental.loop.ndjson"],
  ["opencode-s4i-instructions.jsonl", "opencode-s4i-instructions.loop.ndjson"],
] as const) {
  test(`replay golden: ${fixture}`, async () => {
    await assertGolden(await replay(fixture), golden);
  });
}

// --- S2b: the reference shape -------------------------------------------------

test("S2b: three foreground builders and a depth-2 child, attributed, settled once", async () => {
  const r = await replay("opencode-s2b-foreground-fanout.jsonl");
  const ev = r.events;

  assert.equal(ofKind(ev, "run_started").length, 1);
  assert.equal(ofKind(ev, "run_started")[0].runtime, "opencode");
  const settles = ofKind(ev, "run_settled");
  assert.equal(settles.length, 1, "exactly one settle");
  assert.equal(settles[0].outcome, "success");
  assert.equal(r.result.exitCode, 0);
  assert.equal(ev.at(-1)?.kind, "run_settled", "the settle is the last line");

  const started = ofKind(ev, "agent_started");
  assert.equal(started.length, 4);
  assert.ok(started.every((a) => a.background === false), "every OpenCode agent is stated foreground");
  const byLabel = new Map(started.map((a) => [a.label, a]));
  for (const label of ["Create alpha file", "Create beta file", "Create gamma file"]) {
    const a = byLabel.get(label);
    assert.ok(a, `no agent_started for ${label}`);
    assert.equal(a.depth, 1);
    assert.equal(a.parentAgentId, undefined, `${label} is the lead's child`);
    // The subagent type the recording's prompt named, passed through as spoken.
    assert.equal(a.role, "general-fast");
    assert.equal(a.model, "claude-haiku-4-5");
  }
  const gamma = byLabel.get("Create gamma file")!;
  const grandchild = started.find((a) => a.depth === 2);
  assert.ok(grandchild);
  assert.equal(grandchild.parentAgentId, gamma.agentId, "the depth-2 child is gamma's, declared not inferred");

  const settled = ofKind(ev, "agent_settled");
  assert.equal(settled.length, 4);
  const reports = new Map(settled.map((s) => [s.agentId, s]));
  assert.equal(reports.get(byLabel.get("Create alpha file")!.agentId)?.report, "REPORT: alpha done.");
  assert.equal(reports.get(byLabel.get("Create beta file")!.agentId)?.report, "REPORT: beta done.");
  assert.equal(reports.get(gamma.agentId)?.report, "REPORT: gamma done.");
  assert.equal(reports.get(grandchild.agentId)?.report, "CHILD DONE.");
  for (const s of settled) {
    assert.equal(s.status, "completed");
    // One file of one word each: counted from the write's own input, because
    // the session summary is always zero on the wire.
    assert.equal(s.linesAdded, 1, `${s.agentId} wrote one line`);
    assert.ok((s.durationMs ?? 0) > 0);
  }

  // Each child's steps are its own, between its start and its settle.
  for (const a of started) {
    const from = ev.indexOf(a);
    const to = ev.findIndex((e) => e.kind === "agent_settled" && e.agentId === a.agentId);
    const steps = ev.filter((e, i) => e.agentId === a.agentId && e.kind === "tool_use" && (i < from || i > to));
    assert.deepEqual(steps, [], `${a.label} has steps outside its life`);
    assert.ok(
      ev.slice(from, to).some((e) => e.agentId === a.agentId && e.kind === "tool_use" && e.tool === "write"),
      `${a.label} wrote nothing`,
    );
  }

  // The fan-out call is the agent's row, never a tool row.
  assert.ok(!ev.some((e) => e.kind === "tool_use" && e.tool === "task"));
  // The plan: three pending, then (on the second list) the changes only.
  const plan = ofKind(ev, "work_item");
  assert.deepEqual(
    plan.slice(0, 3).map((w) => [w.itemId, w.itemStatus]),
    [["alpha", "pending"], ["beta", "pending"], ["gamma", "pending"]],
  );
  assert.ok(plan.every((w) => w.source === "plan" && w.agentId === "lead"));

  // The stream closed AT the root's idle — the recording's trailing events (the
  // probe waited four quiet seconds) are never read.
  const rootIdle = recording("opencode-s2b-foreground-fanout.jsonl").findIndex(
    (e) => e.type === "session.idle" && (e.properties as { sessionID?: string }).sessionID === "ses_f360b6b7effeLFQo4gq9ZIlRuC",
  );
  assert.equal(r.consumed, rootIdle + 1);
  assert.ok(r.consumed < r.total);
});

test("S2b: usage is cumulative across every session, per model, platform-spelled", async () => {
  const r = await replay("opencode-s2b-foreground-fanout.jsonl");
  const usage = ofKind(r.events, "run_settled")[0].usage;
  assert.ok(usage);
  // The probe's own read-back (probes/opencode/s2b.summary.json): 12 messages,
  // five sessions, one model.
  assert.equal(usage.model, "claude-haiku-4-5");
  assert.deepEqual(usage.models, [
    {
      model: "claude-haiku-4-5",
      inputTokens: 52,
      outputTokens: 1396,
      cacheReadTokens: 84689,
      cacheCreationTokens: 11100,
      costUsd: null,
    },
  ]);
});

// --- S1c: guards, allowlists, two models ---------------------------------------

test("S1c: two models priced apart, and the guards' refusals read as failed calls", async () => {
  const r = await replay("opencode-s1c-guards-allowlists.jsonl");
  const usage = ofKind(r.events, "run_settled")[0].usage;
  assert.ok(usage);
  assert.equal(usage.model, "", "a two-model run names no single model");
  assert.deepEqual(usage.models?.map((m) => m.model).sort(), ["claude-haiku-4-5", "claude-sonnet-5"]);
  // Reasoning is billed as output: S1c's first Sonnet step reported 146 output
  // and 34 reasoning tokens, and its cost only adds up with both.
  const sonnet = usage.models?.find((m) => m.model === "claude-sonnet-5");
  assert.equal(sonnet?.outputTokens, 1536 + 34);

  const failed = ofKind(r.events, "tool_result").filter((t) => !t.ok);
  assert.deepEqual(failed.map((t) => t.tool).sort(), ["webfetch", "write"]);
  // The spike's plugin predates the marker, so its refusal is a plain failure
  // with the sentence as the diagnosis — the marked form is plugin.test.ts's.
  assert.match(failed.find((t) => t.tool === "write")?.summary ?? "", /outside the project/);
  assert.equal(ofKind(r.events, "notice").filter((n) => n.code === "workspace_guard").length, 0);
});

// --- S2c: the background mode the platform refuses ------------------------------

test("S2c: under the experimental background mode the close rule fires before the lead's wrap-up", async () => {
  const messages = recording("opencode-s2c-background-experimental.jsonl");
  const r = await replay("opencode-s2c-background-experimental.jsonl");
  const background = ofKind(r.events, "agent_started");
  assert.equal(background.length, 4, "the tree is still reconstructible from the stream");
  // The stream closes while the recording still has the lead's own turn to
  // come: its final text ("ALL DONE") arrives after the point the rule holds.
  const allDone = messages.findIndex((e) =>
    JSON.stringify(e).includes('"text":"ALL DONE'),
  );
  assert.ok(allDone > 0, "the recording ends with the lead's ALL DONE");
  assert.ok(r.consumed <= allDone, `closed at ${r.consumed}, ALL DONE at ${allDone + 1}`);
});

// --- S4i: one session, no fan-out ------------------------------------------------

test("S4i: a lead with no children settles on its own idle", async () => {
  const r = await replay("opencode-s4i-instructions.jsonl");
  assert.equal(ofKind(r.events, "agent_started").length, 0);
  assert.equal(ofKind(r.events, "turn_ended").length, 1);
  assert.equal(ofKind(r.events, "run_settled")[0].outcome, "success");
});
