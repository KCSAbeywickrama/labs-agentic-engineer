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

// The run feed: frames in, one model out. Facts append and dedup; state
// replaces; startup state never becomes a row; the clock comes from the
// platform's frames.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildCrew,
  connectionQuietMs,
  cycleCrew,
  eventKey,
  feedNow,
  RunFeed,
  stepRows,
  type BootView,
  type FeedFrame,
  type RunEventView,
} from "../src/index.js";

interface Cycle {
  id: string;
  attempts?: number;
  endedAt?: string | null;
  boot?: BootView;
}

type Frame = FeedFrame<Cycle, RunEventView>;

const T0 = Date.parse("2026-10-12T10:00:00Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

const cycle = (over: Partial<Cycle> = {}): Frame => ({ type: "cycle", cycle: { id: "c1", attempts: 1, ...over } });
const event = (seq: number, body: Partial<RunEventView> = {}, attempt = 1): Frame => ({
  type: "event",
  cycleId: "c1",
  attempt,
  event: { kind: "tool_use", agentId: "lead", seq, ts: at(seq), tool: "Read", summary: `f${String(seq)}.ts`, ...body },
});

function feedOf(frames: Frame[]): RunFeed<Cycle, RunEventView> {
  const feed = new RunFeed<Cycle, RunEventView>();
  frames.forEach((f) => feed.apply(f, T0));
  return feed;
}

test("an event's key is its cycle, attempt and seq — seq 0 is an attempt's first event, not unsequenced", () => {
  assert.equal(eventKey({ cycleId: "c1", attempt: 1, seq: 7 }), "c1:1:7");
  assert.notEqual(eventKey({ cycleId: "c1", attempt: 1, seq: 0 }), eventKey({ cycleId: "c1", attempt: 2, seq: 0 }));
});

test("a replayed frame is a no-op: same events, same snapshot object", () => {
  const frames = [cycle(), event(0), event(1)];
  const feed = feedOf(frames);
  const before = feed.snapshot();
  const changed = frames.slice(1).map((f) => feed.apply(f, T0));
  assert.deepEqual(changed, [false, false]);
  assert.equal(feed.snapshot(), before);
  assert.equal(before.cycles[0]?.events.length, 2);
});

test("an event that outruns its cycle record is held, then placed", () => {
  const feed = feedOf([event(0), event(1)]);
  assert.equal(feed.snapshot().cycles.length, 0);
  feed.apply(cycle(), T0);
  assert.deepEqual(feed.snapshot().cycles[0]?.events.map((e) => e.seq), [0, 1]);
});

test("a re-sent cycle record replaces the record and keeps the events", () => {
  const feed = feedOf([cycle(), event(0), cycle({ endedAt: at(60) })]);
  const [c] = feed.snapshot().cycles;
  assert.equal(c?.cycle.endedAt, at(60));
  assert.equal(c?.events.length, 1);
});

test("an unchanged cycle keeps its view object when another cycle moves", () => {
  const feed = feedOf([cycle(), event(0), { type: "cycle", cycle: { id: "c2", attempts: 1 } }]);
  const first = feed.snapshot().cycles[0];
  feed.apply({ type: "event", cycleId: "c2", attempt: 1, event: { kind: "tool_use", agentId: "lead", seq: 0 } }, T0);
  assert.equal(feed.snapshot().cycles[0], first, "c1 did not change, so its view is the same object");
  assert.notEqual(feed.snapshot().cycles[1]?.events.length, 0);
});

test("boot is the record's, until the attempt's first event — whatever a late record says", () => {
  const boot: BootView = { attempt: 1, code: "runner_pulling_image", since: at(0) };
  const feed = feedOf([cycle({ boot })]);
  assert.deepEqual(feed.snapshot().cycles[0]?.boot, boot);
  feed.apply(event(0), T0);
  assert.equal(feed.snapshot().cycles[0]?.boot, undefined);
  // The record re-sent a moment late, still carrying the boot it had.
  feed.apply(cycle({ boot }), T0);
  assert.equal(feed.snapshot().cycles[0]?.boot, undefined);
});

test("an older server's runner_* notices are boot state, never rows", () => {
  const notice = (seq: number, code: string, s: number): Frame =>
    event(seq, { kind: "notice", code, level: "info", ts: at(s) });
  const feed = feedOf([cycle(), notice(-10, "runner_scheduling", 0), notice(-11, "runner_pulling_image", 3)]);
  const c = feed.snapshot().cycles[0];
  assert.equal(c?.events.length, 0, "no startup notice is kept as an event");
  assert.equal(c?.boot?.code, "runner_pulling_image", "the newest state wins");
  feed.apply(event(0), T0);
  assert.equal(feed.snapshot().cycles[0]?.boot, undefined, "the first real event ends startup");
  assert.deepEqual(feed.snapshot().cycles[0]?.events.map((e) => e.seq), [0]);
});

test("a gap notice is a fact and stays a row", () => {
  const feed = feedOf([cycle(), event(-1_000_005, { kind: "notice", code: "gap", level: "warn" }), event(6)]);
  assert.equal(feed.snapshot().cycles[0]?.events.length, 2);
});

test("an ended cycle shows no boot", () => {
  const boot: BootView = { attempt: 1, code: "runner_scheduling", since: at(0) };
  const feed = feedOf([cycle({ boot, endedAt: at(5) })]);
  assert.equal(feed.snapshot().cycles[0]?.boot, undefined);
});

test("a re-dispatch reads as its own attempt: its boot, its crew", () => {
  const feed = feedOf([
    cycle(),
    event(0, { kind: "agent_progress", phrase: "first try" }),
    cycle({ attempts: 2, boot: { attempt: 2, code: "runner_starting", since: at(30) } }),
  ]);
  const c = feed.snapshot().cycles[0];
  assert.ok(c);
  assert.equal(c.attempt, 2);
  assert.equal(c.boot?.code, "runner_starting");
  const crew = cycleCrew(c, T0 + 40_000);
  assert.equal(crew.lead.caption, "Starting the agent… · 10.0s");
  assert.equal(cycleCrew(c, T0, { attempt: 1 }).lead.caption, "first try", "attempt 1 is still readable");
});

test("the clock offset is the least-delayed sample, and a tick marks the stream as ticking", () => {
  const feed = new RunFeed<Cycle, RunEventView>();
  // Platform is 5s ahead; frames arrive 300ms and 2s after they were written.
  feed.apply({ type: "cycle", cycle: { id: "c1" }, serverTime: new Date(T0 + 5_000).toISOString() }, T0 + 300);
  feed.apply({ type: "tick", serverTime: new Date(T0 + 10_000).toISOString() }, T0 + 7_000);
  const snap = feed.snapshot();
  assert.equal(snap.clockOffsetMs, 4_700);
  assert.equal(feedNow(snap, T0), T0 + 4_700);
  assert.equal(snap.ticking, true);
  assert.equal(connectionQuietMs(snap, T0 + 7_000 + 10_000), undefined, "quiet for less than three ticks");
  assert.equal(connectionQuietMs(snap, T0 + 7_000 + 50_000), 50_000);
});

test("a quiet stream that never ticked says nothing about the connection", () => {
  const feed = feedOf([cycle()]);
  assert.equal(connectionQuietMs(feed.snapshot(), T0 + 600_000), undefined);
});

test("step rows: one row per call, outcome merged, oldest first, same array while nothing moved", () => {
  const feed = feedOf([
    cycle(),
    event(0, { tool: "Bash", summary: "pnpm test", toolUseId: "t1" }),
    event(1, { kind: "task_started", toolUseId: "t1", taskId: "k1", summary: "pnpm test" }),
    event(2, { kind: "task_settled", toolUseId: "t1", taskId: "k1", summary: "pnpm test", status: "completed" }),
    event(3, { tool: "Bash", summary: "pnpm build", toolUseId: "t2" }),
    event(4, { kind: "tool_result", tool: "Bash", toolUseId: "t2", ok: false, exitCode: 1, summary: undefined }),
  ]);
  const events = feed.snapshot().cycles[0]?.events ?? [];
  const rows = stepRows(events);
  assert.deepEqual(
    rows.map((r) => [r.text, r.outcome.text]),
    [
      ["$ pnpm test", "background · completed"],
      ["$ pnpm build", "exit 1"],
    ],
  );
  assert.equal(stepRows(events), rows);
});

test("the feed's crew is buildCrew's crew, on a real 55-minute recording", () => {
  const recording = fs
    .readFileSync(new URL("./fixtures/run-2026-09-04.v2.ndjson", import.meta.url), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as RunEventView);
  const feed = feedOf([cycle(), ...recording.map((e) => ({ type: "event", cycleId: "c1", attempt: 1, event: e }) as Frame)]);
  const c = feed.snapshot().cycles[0];
  assert.ok(c);
  const now = Date.parse(recording.at(-1)?.ts ?? "") + 5_000;
  const fromFeed = cycleCrew(c, now);
  const direct = buildCrew(c.events, now);
  assert.deepEqual(
    fromFeed.members.map((m) => [m.id, m.state, m.caption, m.silentForMs, m.plan.length]),
    direct.members.map((m) => [m.id, m.state, m.caption, m.silentForMs, m.plan.length]),
  );
  // Read again a minute later: the fold is reused, only the clock moved.
  const later = cycleCrew(c, now + 60_000);
  assert.equal(later.lead.steps, fromFeed.lead.steps, "steps are the fold's array, stable across ticks");
  assert.equal((later.silentForMs ?? 0) - (fromFeed.silentForMs ?? 0), 60_000);
});
