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

// The observer seam on OpenCode: its `bash` / `write` / `edit` tool parts,
// through the translator's observer seam, reach `RuntimeObservers` in the port's
// `ObservedCall` vocabulary — and equal to the same session driven through Claude
// Code's hook seam. A watcher reads `ObservedCall` only, so the two runtimes must
// hand it the same calls and the same outcomes.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ObservedCall } from "../port.js";
import { observedCall as claudeCall } from "../claude/tools.js";
import { observedCall as opencodeCall } from "./tools.js";
import { createOpencodeAdapter } from "./translate.js";

/** One session, as the steps a lead takes — named once, spelled per runtime below. */
type Step =
  | { kind: "shell"; command: string; ok: boolean }
  | { kind: "write"; path: string; content: string }
  | { kind: "edit"; path: string; oldText: string; newText: string };

const SESSION: Step[] = [
  { kind: "shell", command: "npm ci", ok: true },
  { kind: "write", path: "/w/src/a.ts", content: "export const a = 1;\n" },
  { kind: "edit", path: "/w/src/b.ts", oldText: "a", newText: "b" },
  { kind: "shell", command: "npm test", ok: false },
];

type Observed = { use: ObservedCall; id: string } | { outcome: boolean; id: string };

/** A recording observer, wired as a runtime's `observe` policy would be. */
function recorder() {
  const seen: Observed[] = [];
  return {
    seen,
    toolUse: (call: ObservedCall, id: string) => void seen.push({ use: call, id }),
    toolOutcome: (id: string, ok: boolean) => void seen.push({ outcome: ok, id }),
  };
}

/** The session as OpenCode's bus reports it, through the OpenCode translator. */
function onOpencode(): Observed[] {
  const r = recorder();
  const adapter = createOpencodeAdapter({
    model: "claude-haiku-4-5",
    onToolUse: r.toolUse,
    onToolOutcome: r.toolOutcome,
  });
  adapter.translate({ type: "session.created", properties: { info: { id: "root", directory: "/w" } } });
  for (const [i, step] of SESSION.entries()) {
    const callID = `c${i}`;
    const [tool, input] =
      step.kind === "shell"
        ? ["bash", { command: step.command }]
        : step.kind === "write"
          ? ["write", { filePath: step.path, content: step.content }]
          : ["edit", { filePath: step.path, oldString: step.oldText, newString: step.newText }];
    const part = (state: Record<string, unknown>) => ({
      type: "message.part.updated",
      properties: { part: { type: "tool", tool, callID, sessionID: "root", state: { input, ...state } } },
    });
    adapter.translate(part({ status: "running", time: { start: 1 } }));
    adapter.translate(
      part({
        status: "completed",
        output: "",
        metadata: step.kind === "shell" ? { exit: step.ok ? 0 : 1 } : {},
        time: { start: 1, end: 2 },
      }),
    );
  }
  return r.seen;
}

/** The same session as Claude Code's hook sees it, through Claude Code's normaliser. */
function onClaude(): Observed[] {
  const r = recorder();
  for (const [i, step] of SESSION.entries()) {
    const id = `c${i}`;
    const call =
      step.kind === "shell"
        ? claudeCall("Bash", { command: step.command })
        : step.kind === "write"
          ? claudeCall("Write", { file_path: step.path, content: step.content })
          : claudeCall("Edit", { file_path: step.path, old_string: step.oldText, new_string: step.newText });
    r.toolUse(call, id);
    r.toolOutcome(id, step.kind !== "shell" || step.ok);
  }
  return r.seen;
}

test("observers on OpenCode: bash, write and edit parts reach the observer as ObservedCalls with their outcome", () => {
  assert.deepEqual(onOpencode(), [
    { use: { kind: "shell", command: "npm ci" }, id: "c0" },
    { outcome: true, id: "c0" },
    { use: { kind: "write", path: "/w/src/a.ts", content: "export const a = 1;\n" }, id: "c1" },
    { outcome: true, id: "c1" },
    { use: { kind: "edit", path: "/w/src/b.ts" }, id: "c2" },
    { outcome: true, id: "c2" },
    { use: { kind: "shell", command: "npm test" }, id: "c3" },
    { outcome: false, id: "c3" },
  ]);
});

test("observers: an OpenCode session and the same Claude Code session hand the observer the same calls", () => {
  assert.deepEqual(onOpencode(), onClaude());
});

test("observedCall (OpenCode): each authoring and shell tool in the port's vocabulary", () => {
  assert.deepEqual(opencodeCall("bash", { command: "ls" }), { kind: "shell", command: "ls" });
  assert.deepEqual(opencodeCall("write", { filePath: "/a", content: "x" }), { kind: "write", path: "/a", content: "x" });
  assert.deepEqual(opencodeCall("edit", { filePath: "/a", oldString: "x", newString: "y" }), { kind: "edit", path: "/a" });
  assert.deepEqual(opencodeCall("apply_patch", { patchText: "*** Begin Patch\n*** Update File: /a.ts\n@@\n*** End Patch" }), {
    kind: "edit",
    path: "/a.ts",
  });
  assert.deepEqual(opencodeCall("read", { filePath: "/a" }), { kind: "other", tool: "read" });
});

test("observedCall (Claude Code): the same vocabulary from Claude Code's tools", () => {
  assert.deepEqual(claudeCall("Bash", { command: "ls" }), { kind: "shell", command: "ls" });
  assert.deepEqual(claudeCall("Write", { file_path: "/a", content: "x" }), { kind: "write", path: "/a", content: "x" });
  assert.deepEqual(claudeCall("Edit", { file_path: "/a" }), { kind: "edit", path: "/a" });
  assert.deepEqual(claudeCall("NotebookEdit", { notebook_path: "/n.ipynb" }), { kind: "edit", path: "/n.ipynb" });
  assert.deepEqual(claudeCall("Read", { file_path: "/a" }), { kind: "other", tool: "Read" });
});
