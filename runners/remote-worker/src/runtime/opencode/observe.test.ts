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

// The validation watchers on OpenCode: its `bash` / `write` / `edit` tool parts,
// through the translator's observer seam, into the REAL per-criterion tracker
// and status line — and held equal to the same session driven through Claude
// Code's hook seam. The watchers read the port's `ObservedCall` only, so the two
// runtimes must produce the same rows and the same lines.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createValidationProgressTracker, type ProgressItemUpdate } from "../../lib/validation_progress.js";
import { createValidationStatusLine } from "../../lib/validation_status_line.js";
import type { ObservedCall } from "../port.js";
import { observedCall as claudeCall } from "../claude/tools.js";
import { observedCall as opencodeCall } from "./tools.js";
import { createOpencodeAdapter } from "./translate.js";

const PLAN = "## AC-001-a — shows the list\n## AC-001-b — adds an item\n";
const STUB = "// spec: tests/validation/test-plan.md § AC-001-a\n";
const FILLED = `${STUB}import { test } from "@playwright/test";\ntest('AC-001-a: list', async () => {});\n`;
const RUN = "npm test --prefix tests/e2e -- specs/AC-001-a.spec.ts";
const REPORT = 'node "$AEP_SKILLS_DIR/aep-validation/scripts/generate-report.mjs" --issue 7';

/** One validation session, as the steps a lead takes — named once, spelled per runtime below. */
type Step =
  | { kind: "shell"; command: string; ok: boolean }
  | { kind: "write"; path: string; content: string }
  | { kind: "edit"; path: string; oldText: string; newText: string };

const SESSION: Step[] = [
  { kind: "shell", command: "npm ci --prefix tests/e2e", ok: true },
  { kind: "write", path: "/w/tests/validation/test-plan.md", content: PLAN },
  { kind: "write", path: "/w/tests/e2e/specs/AC-001-a.spec.ts", content: STUB },
  { kind: "write", path: "/w/tests/e2e/specs/AC-001-a.spec.ts", content: FILLED },
  { kind: "shell", command: RUN, ok: true },
  { kind: "edit", path: "/w/tests/e2e/specs/AC-001-b.spec.ts", oldText: "a", newText: "b" },
  { kind: "shell", command: REPORT, ok: true },
];

interface Watched {
  rows: ProgressItemUpdate[];
  lines: string[];
}

/** The two watchers, wired exactly as `startCodingRun` fans them out. */
function watchers() {
  const rows: ProgressItemUpdate[] = [];
  const lines: string[] = [];
  const progress = createValidationProgressTracker((u) => rows.push(u));
  const statusLine = createValidationStatusLine(progress.state, async (body) => void lines.push(body), () => {});
  return {
    watched: { rows, lines } as Watched,
    toolUse: async (call: ObservedCall, id: string) => {
      progress.observe(call, id);
      await statusLine.observe(call, id);
    },
    toolOutcome: (id: string, ok: boolean) => {
      progress.settle(id, ok);
      statusLine.settle(id, ok);
    },
  };
}

/** The session as OpenCode's bus reports it, through the OpenCode translator. */
async function onOpencode(): Promise<Watched> {
  const w = watchers();
  const pending: Promise<void>[] = [];
  const adapter = createOpencodeAdapter({
    model: "claude-haiku-4-5",
    onToolUse: (call, id) => {
      const p = w.toolUse(call, id);
      pending.push(p);
      return p;
    },
    onToolOutcome: w.toolOutcome,
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
    // The lines are posted from the observer; let it land before the outcome,
    // as it does live (the call takes longer than the post).
    await Promise.all(pending);
    adapter.translate(
      part({
        status: "completed",
        output: "",
        metadata: step.kind === "shell" ? { exit: step.ok ? 0 : 1 } : {},
        time: { start: 1, end: 2 },
      }),
    );
  }
  return w.watched;
}

/** The same session as Claude Code's hook sees it, through Claude Code's normaliser. */
async function onClaude(): Promise<Watched> {
  const w = watchers();
  for (const [i, step] of SESSION.entries()) {
    const id = `c${i}`;
    const call =
      step.kind === "shell"
        ? claudeCall("Bash", { command: step.command })
        : step.kind === "write"
          ? claudeCall("Write", { file_path: step.path, content: step.content })
          : claudeCall("Edit", { file_path: step.path, old_string: step.oldText, new_string: step.newText });
    await w.toolUse(call, id);
    w.toolOutcome(id, step.kind !== "shell" || step.ok);
  }
  return w.watched;
}

test("watchers on OpenCode: bash and write parts reach the per-criterion rows and the status line", async () => {
  const { rows, lines } = await onOpencode();
  assert.deepEqual(
    rows.map((r) => `${r.itemId}:${r.status}`),
    ["AC-001-a:planned", "AC-001-b:planned", "AC-001-a:exploring", "AC-001-a:authoring", "AC-001-a:running", "AC-001-a:pass", "AC-001-b:authoring"],
  );
  assert.ok(lines.length >= 3, `the status line never moved: ${JSON.stringify(lines)}`);
});

test("watchers: an OpenCode session and the same Claude Code session produce the same rows and lines", async () => {
  assert.deepEqual(await onOpencode(), await onClaude());
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
