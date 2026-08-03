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

/** Coding-run flow units: undo round trip, gates, timeline rendering. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTimelineRenderer, renderMergedTimeline } from "../src/engine/coding-run.js";
import { formatLine } from "@aep/progress-view";

// The playground renders through the SAME formatter the console does, so these
// assertions pin the shared wording, not a playground-only copy of it.
const renderProgressLine = (e: Parameters<typeof formatLine>[0]): string => formatLine(e).text;
import { renderTaskContextFile } from "../src/ports/issue-store.js";
import { takeUndoSnapshot, restoreUndoSnapshot, listUndoSnapshots } from "../src/state/undo.js";
import { codeCommand } from "../src/commands.js";

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "aep-play-code-"));
  mkdirSync(join(dir, "issues"), { recursive: true });
  writeFileSync(
    join(dir, "issues", "3.md"),
    renderTaskContextFile({
      issueNumber: 3,
      component: "user-service",
      title: "Implement the user service",
      dependsOn: ["auth-service"],
      body: "scope",
    }),
  );
  return dir;
}

test("undo snapshot + restore round-trips edits and removes new files", () => {
  const dir = tempProject();
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "main.go"), "package main\n");
    const snap = takeUndoSnapshot(dir);
    assert.ok(existsSync(snap));
    assert.equal(listUndoSnapshots(dir)[0], snap);

    // Agent damage: edit a file, add a new one, delete another.
    writeFileSync(join(dir, "src", "main.go"), "package broken\n");
    writeFileSync(join(dir, "src", "junk.go"), "junk\n");
    rmSync(join(dir, "issues", "3.md"));

    const restored = restoreUndoSnapshot(dir);
    assert.equal(restored, snap);
    assert.equal(readFileSync(join(dir, "src", "main.go"), "utf8"), "package main\n");
    assert.ok(!existsSync(join(dir, "src", "junk.go")), "post-snapshot file removed");
    assert.ok(existsSync(join(dir, "issues", "3.md")), "deleted file restored");
    // The state dir itself is never part of the snapshot scope.
    assert.ok(existsSync(join(dir, ".aep-playground", "undo")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("codeCommand gates: no issues fails; unconfirmed headless run fails before any snapshot", async () => {
  const empty = mkdtempSync(join(tmpdir(), "aep-play-code-empty-"));
  try {
    const noIssues = await codeCommand(empty, { silent: true });
    assert.equal(noIssues.ok, false);
    assert.match(noIssues.detail ?? "", /nothing to run/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }

  const dir = tempProject();
  try {
    const unconfirmed = await codeCommand(dir, { silent: true });
    assert.equal(unconfirmed.ok, false);
    assert.match(unconfirmed.detail ?? "", /not confirmed/);
    assert.equal(listUndoSnapshots(dir).length, 0, "no snapshot before consent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderProgressLine maps the NDJSON vocabulary to timeline lines", () => {
  // Phase ids render through the shared friendly-label map, so the playground
  // says exactly what the console says.
  assert.equal(renderProgressLine({ kind: "phase", phase: "workspace_ready" }), "▸ Workspace ready");
  assert.equal(renderProgressLine({ kind: "tool_use", tool: "Bash", summary: "go test ./..." }), "$ go test ./...");
  assert.match(renderProgressLine({ kind: "result", status: "success" }), /■ success/);
  assert.match(renderProgressLine({ kind: "result", status: "failure", error: "boom" }), /failure — boom/);
  assert.match(renderProgressLine({ kind: "gh_action", command: "pr create" }), /⚙ pr create/);
});

test("the local harness flags the operations that cannot work without a remote", () => {
  // True here and meaningless in a cluster run, so it is the ONE thing this
  // renderer adds on top of the shared wording.
  const render = createTimelineRenderer();
  assert.match(render({ kind: "gh_action", command: "pr create" }).join(""), /no GitHub in local mode/);
  assert.match(render({ kind: "git_push", branch: "main" }).join(""), /no remote in local mode/);
  // …and it annotates nothing else.
  assert.doesNotMatch(render({ kind: "tool_use", tool: "Bash", summary: "ls" }).join(""), /local mode/);
});

test("renderProgressLine reports a failed tool call, and times only the slow successes", () => {
  // A shell failure names its exit code: that is what says THIS command broke.
  assert.equal(
    renderProgressLine({ kind: "tool_result", tool: "Bash", ok: false, durationMs: 900, exitCode: 1, summary: "error: compilation contains errors" }),
    "✗ Bash exit 1 · error: compilation contains errors",
  );
  // A non-shell tool reports no code — "failed" is exactly as much as is known.
  assert.equal(
    renderProgressLine({ kind: "tool_result", tool: "Read", ok: false, summary: "File does not exist" }),
    "✗ Read failed · File does not exist",
  );
  assert.equal(renderProgressLine({ kind: "tool_result", tool: "Bash", ok: true, durationMs: 42_000 }), "↳ Bash 42.0s");
  assert.equal(renderProgressLine({ kind: "tool_result", tool: "Bash", ok: true, durationMs: 185_000 }), "↳ Bash 3m5s");
  // A fast success is deliberately silent — a tick per read would bury the failures.
  assert.equal(renderProgressLine({ kind: "tool_result", tool: "Read", ok: true, durationMs: 40 }), "");
  // A subagent's narration is header material, never a row.
  assert.equal(renderProgressLine({ kind: "activity", summary: "Writing todo-api/service.bal" }), "");
});

test("timeline renderer numbers concurrent subagents and announces each one once", () => {
  const render = createTimelineRenderer();
  const api = { emitter: "subagent", emitterId: "toolu_api", emitterLabel: "Implement todo-api (issue #3)" };
  const web = { emitter: "subagent", emitterId: "toolu_web", emitterLabel: "Implement todo-webapp (issue #4)" };

  // First sighting: the label is announced, then the line itself.
  const first = render({ kind: "tool_use", tool: "Bash", summary: "bal build", ...api });
  assert.equal(first.length, 2);
  assert.match(first.join("\n"), /⑂ \[#1\] Implement todo-api \(issue #3\)/);
  assert.match(first.join("\n"), /\[#1\] +\$ bal build/);

  // A second subagent gets its own number — the point of the whole exercise.
  const second = render({ kind: "tool_use", tool: "Write", summary: "src/App.tsx", ...web }).join("\n");
  assert.match(second, /⑂ \[#2\] Implement todo-webapp/);
  assert.match(second, /\[#2\] +\$ Write src\/App.tsx/);

  // Already announced: one line, and the SAME number as before.
  const again = render({ kind: "tool_use", tool: "Bash", summary: "bal test", ...api });
  assert.equal(again.length, 1);
  assert.match(again.join(""), /\[#1\] +\$ bal test/);
});

test("timeline renderer: main lines are unstamped, and glyphs stay in one column", () => {
  const render = createTimelineRenderer();
  const only = (lines: string[]): string => {
    assert.equal(lines.length, 1);
    return lines[0] as string;
  };

  const main = only(render({ kind: "tool_use", tool: "Bash", summary: "bal build" }));
  const sub = only(render({ kind: "tool_use", tool: "Bash", summary: "bal build", emitter: "subagent", emitterId: "x" }));

  assert.doesNotMatch(main, /#|sub/);
  assert.equal(main.indexOf("$"), sub.indexOf("$"), "same column");

  // A subagent line with no id still says it is one, rather than passing as main.
  assert.match(only(render({ kind: "tool_use", tool: "Bash", summary: "ls", emitter: "subagent" })), /\[sub\]/);

  // A silent event produces no row at all.
  assert.deepEqual(render({ kind: "tool_result", tool: "Read", ok: true, durationMs: 5 }), []);
});

test("merged pass: an outcome lands on its own action's row, console-shaped", () => {
  const out = renderMergedTimeline([
    { kind: "tool_use", tool: "Bash", summary: "bal build", toolUseId: "t1" },
    { kind: "tool_use", tool: "Read", summary: "db.bal", toolUseId: "t2" },
    // Out of order and separated from its action, as a real interleaved run is.
    { kind: "tool_result", tool: "Read", ok: true, durationMs: 20, toolUseId: "t2" },
    { kind: "tool_result", tool: "Bash", ok: false, exitCode: 1, summary: "error: compilation contains errors", durationMs: 25_100, toolUseId: "t1" },
  ]);

  assert.equal(out.length, 2, "one row per step, not one per event");
  assert.match(out[0] as string, /\$ bal build +exit 1 · error: compilation contains errors · 25\.1s/);
  // The fast read keeps its action row and gains nothing — the rule holds here too.
  assert.equal((out[1] as string).trim(), "$ Read db.bal");
});

test("merged pass: each subagent's work sits under its own report", () => {
  const api = { emitter: "subagent", emitterId: "a1", emitterLabel: "todo-api" };
  const out = renderMergedTimeline([
    { kind: "tool_use", tool: "Bash", summary: "git status", toolUseId: "m1" },
    { kind: "activity", summary: "Writing todo-api/service.bal", toolCount: 4, ...api },
    { kind: "tool_use", tool: "Write", summary: "todo-api/service.bal", toolUseId: "s1", ...api },
    { kind: "tool_result", tool: "Agent", ok: true, status: "completed", summary: "todo-api", durationMs: 209_158, toolCount: 19, linesAdded: 553, linesRemoved: 4, toolUseId: "a1", ...api },
  ]).join("\n");

  assert.match(out, /⑂ todo-api — completed · 3m29s · 19 tools · \+553\/−4 lines/);
  assert.match(out, /│ \$ Write todo-api\/service\.bal/);
  // The narration and the closing report are the header; neither is a row.
  assert.doesNotMatch(out, /Writing todo-api\/service\.bal$/m);
  // The main agent's own line keeps its place ahead of the section.
  assert.ok(out.indexOf("git status") < out.indexOf("todo-api"));
});

test("merged pass: local mode still says a push went nowhere", () => {
  const out = renderMergedTimeline([{ kind: "git_push", branch: "aep/m3", toolUseId: "p1" }]).join("\n");
  assert.match(out, /↑ push aep\/m3 — no remote in local mode/);
});
