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
 * The review screen (docs/design/playground.md §7): the files the last turn
 * changed — unified diff against the pre-turn snapshot, open in $EDITOR,
 * validate. Diffs shell out to `diff -u` (POSIX) against a temp copy of the
 * pre-turn content, so no diff engine is vendored.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { stdout as output } from "node:process";
import * as clack from "@clack/prompts";
import type { FileChange } from "@aep/agents/playground-kit";
import { resolveWithin } from "@aep/agents/playground-kit";
import { checkProject } from "../engine/check.js";

export function printCheckFindings(projectDir: string): boolean {
  let allOk = true;
  for (const f of checkProject(projectDir)) {
    output.write(f.ok ? `  ✓ ${f.path} — ${f.message}\n` : `  ✗ ${f.path} — ${f.message}\n`);
    if (!f.ok) allOk = false;
  }
  return allOk;
}

function showDiff(projectDir: string, path: string, before: Record<string, string>): void {
  const tmp = mkdtempSync(join(tmpdir(), "aep-play-diff-"));
  try {
    const beforeFile = join(tmp, basename(path) + ".before");
    writeFileSync(beforeFile, before[path] ?? "", "utf8");
    const current = resolveWithin(projectDir, path);
    const res = spawnSync("diff", ["-u", "--label", `before/${path}`, "--label", `after/${path}`, beforeFile, current], {
      encoding: "utf8",
    });
    output.write((res.stdout || res.stderr || "(no differences)\n") + "\n");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function openInEditor(projectDir: string, path: string): void {
  const editor = process.env.EDITOR ?? "vi";
  spawnSync(editor, [resolveWithin(projectDir, path)], { stdio: "inherit" });
}

/** Review the changes of the last turn. Returns when the user backs out. */
export async function reviewScreen(projectDir: string, changes: FileChange[], before: Record<string, string>): Promise<void> {
  if (changes.length === 0) {
    output.write("  (the last turn changed no files)\n");
    return;
  }
  for (;;) {
    const file = await clack.select({
      message: "Changed this turn",
      options: [
        ...changes.map((c) => ({ value: c.path, label: `${c.kind === "add" ? "＋" : c.kind === "remove" ? "－" : "±"} ${c.path}` })),
        { value: "\0validate", label: "validate design artifacts" },
        { value: "\0back", label: "back" },
      ],
    });
    if (clack.isCancel(file) || file === "\0back") return;
    if (file === "\0validate") {
      printCheckFindings(projectDir);
      continue;
    }
    const change = changes.find((c) => c.path === file)!;
    if (change.kind === "remove") {
      output.write(`  ${file} was removed this turn\n`);
      continue;
    }
    const action = await clack.select({
      message: file,
      options: [
        { value: "diff", label: "diff against the pre-turn snapshot" },
        { value: "open", label: `open in $EDITOR (${process.env.EDITOR ?? "vi"})` },
        { value: "back", label: "back" },
      ],
    });
    if (clack.isCancel(action) || action === "back") continue;
    if (action === "diff") showDiff(projectDir, file, before);
    if (action === "open") openInEditor(projectDir, file);
  }
}
