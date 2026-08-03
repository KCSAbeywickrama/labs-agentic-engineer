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
import { createRunWatchdog } from "./watchdog.js";
import type { ProgressEventInput } from "./schema.js";

const IDLE = 120_000;

function harness() {
  let clock = 0;
  const emitted: ProgressEventInput[] = [];
  const watchdog = createRunWatchdog({
    idleMs: IDLE,
    now: () => clock,
    emit: (e) => emitted.push(e),
  });
  return {
    watchdog,
    emitted,
    summaries: () => emitted.map((e) => ("summary" in e ? String(e.summary) : "")),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

test("watchdog: silence with a tool in flight names the tool — the run is not dead, that call is slow", () => {
  const h = harness();
  h.watchdog.observe([{ kind: "tool_use", tool: "Bash", summary: "bal tool pull openapi", toolUseId: "t1" }]);

  h.advance(IDLE - 1);
  h.watchdog.check();
  assert.equal(h.emitted.length, 0, "a build under the threshold is not reported");

  h.advance(2);
  h.watchdog.check();
  assert.equal(h.emitted.length, 1);
  assert.equal(h.emitted[0]?.kind, "log");
  assert.equal((h.emitted[0] as { level?: string }).level, "warn", "never error — a long pull is legitimate");
  assert.match(h.summaries()[0] ?? "", /waiting on Bash \(bal tool pull openapi\) for 2m0s/);
});

test("watchdog: silence with NOTHING in flight blames the model, not a tool", () => {
  // The other half of the diagnosis: same symptom, different fault.
  const h = harness();
  h.watchdog.observe([{ kind: "tool_use", tool: "Bash", summary: "ls", toolUseId: "t1" }]);
  h.watchdog.observe([{ kind: "tool_result", ok: true, toolUseId: "t1" }]);

  h.advance(IDLE + 1);
  h.watchdog.check();
  assert.match(h.summaries()[0] ?? "", /no tool in flight — waiting on the model/);
});

test("watchdog: continued silence repeats every idle window, so a dead zone becomes a trail", () => {
  const h = harness();
  h.watchdog.observe([{ kind: "tool_use", tool: "Bash", summary: "bal build", toolUseId: "t1" }]);

  // The real run that motivated this went 8m49s without a line.
  for (let i = 0; i < 4; i++) {
    h.advance(IDLE);
    h.watchdog.check();
  }
  assert.equal(h.emitted.length, 4);
  // Each one reports a LONGER wait — that progression is what says "still
  // stuck" rather than "just started".
  assert.match(h.summaries()[0] ?? "", /for 2m0s/);
  assert.match(h.summaries()[3] ?? "", /for 8m0s/);
});

test("watchdog: activity resets the clock — a working run is never reported", () => {
  const h = harness();
  h.watchdog.observe([{ kind: "tool_use", tool: "Read", summary: "a.go", toolUseId: "t1" }]);
  for (let i = 0; i < 5; i++) {
    h.advance(IDLE - 1_000);
    h.watchdog.check();
    h.watchdog.observe([{ kind: "tool_use", tool: "Read", summary: `f${i}.go`, toolUseId: `t${i + 2}` }]);
  }
  assert.deepEqual(h.emitted, []);
});

test("watchdog: with several calls open it reports the OLDEST — the one actually stuck", () => {
  const h = harness();
  h.watchdog.observe([{ kind: "tool_use", tool: "Bash", summary: "bal build", toolUseId: "old" }]);
  h.advance(60_000);
  h.watchdog.observe([{ kind: "tool_use", tool: "Read", summary: "a.bal", toolUseId: "new" }]);

  h.advance(IDLE);
  h.watchdog.check();
  assert.match(h.summaries()[0] ?? "", /waiting on Bash \(bal build\) for 3m0s/);

  // Once the slow one lands, the remaining call is what is waited on.
  h.watchdog.observe([{ kind: "tool_result", ok: true, toolUseId: "old" }]);
  h.advance(IDLE);
  h.watchdog.check();
  assert.match(h.summaries()[1] ?? "", /waiting on Read \(a\.bal\)/);
});

test("watchdog: a Bash call rewritten to git_commit is still tracked as in flight", () => {
  // bashEvents changes the KIND; forgetting these would leave a git push that
  // hangs on auth looking like an idle model.
  const h = harness();
  h.watchdog.observe([{ kind: "git_push", branch: "main", summary: "git push origin main", toolUseId: "g1" }]);
  h.advance(IDLE + 1);
  h.watchdog.check();
  assert.match(h.summaries()[0] ?? "", /waiting on git_push \(git push origin main\)/);
});

test("watchdog: describe() is usable before anything has happened", () => {
  // The SIGTERM path calls it at arbitrary times, including during startup.
  assert.match(createRunWatchdog().describe(), /no tool in flight/);
});
