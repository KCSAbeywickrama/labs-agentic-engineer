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
 * The tasks screen (docs/design/playground.md §7): the `issues/*.md` table
 * with dependsOn edges + derivedStatus, plan/replan, edit, new-issue template,
 * and the coding-agent launch hook.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stdout as output } from "node:process";
import * as clack from "@clack/prompts";
import { FsIssueStore, renderTaskContextFile } from "../ports/issue-store.js";
import { projectSlug } from "../ports/spec-workspace.js";
import { loadProjectState, saveProjectState } from "../state/project.js";

export type TasksAction = { kind: "plan" } | { kind: "code"; issueFile: string } | { kind: "back" };

function statusIcon(s: string | undefined): string {
  if (s === "deployed") return "✓";
  if (s === "failed") return "✗";
  if (s === "running") return "▸";
  return "·"; // ready
}

/** Render + drive the tasks table. Returns the action the CLI should run. */
export async function tasksScreen(projectDir: string): Promise<TasksAction> {
  for (;;) {
    const store = new FsIssueStore(projectDir, projectSlug(projectDir));
    const issues = store.list();
    if (issues.length === 0) output.write("  (no issues yet — plan first)\n");

    const choice = await clack.select({
      message: "Tasks",
      options: [
        ...issues.map((i) => ({
          value: i.file,
          label: `${statusIcon(i.derivedStatus)} #${i.issueNumber} [${i.component}] ${i.title}${i.dependsOn.length ? ` ⇠ ${i.dependsOn.join(", ")}` : ""} (${i.derivedStatus ?? "ready"})`,
        })),
        { value: "\0plan", label: issues.length ? "＋ re-plan (adds tasks for uncovered components)" : "＋ plan tasks" },
        { value: "\0new", label: "＋ new issue (template)" },
        { value: "\0back", label: "back" },
      ],
    });
    if (clack.isCancel(choice) || choice === "\0back") return { kind: "back" };
    if (choice === "\0plan") return { kind: "plan" };
    if (choice === "\0new") {
      await newIssueTemplate(projectDir);
      continue;
    }

    const action = await clack.select({
      message: choice,
      options: [
        { value: "code", label: "run the coding agent on this issue" },
        { value: "edit", label: `edit in $EDITOR (${process.env.EDITOR ?? "vi"})` },
        { value: "back", label: "back" },
      ],
    });
    if (clack.isCancel(action) || action === "back") continue;
    if (action === "edit") {
      spawnSync(process.env.EDITOR ?? "vi", [join(projectDir, choice)], { stdio: "inherit" });
      continue;
    }
    return { kind: "code", issueFile: choice };
  }
}

async function newIssueTemplate(projectDir: string): Promise<void> {
  const title = await clack.text({ message: "Issue title", placeholder: "Implement the user service" });
  if (clack.isCancel(title) || !title.trim()) return;
  const component = await clack.text({ message: "Component", placeholder: "user-service" });
  if (clack.isCancel(component) || !component.trim()) return;

  const slug = projectSlug(projectDir);
  const state = loadProjectState(projectDir, slug);
  const issueNumber = state.nextIssueNumber;
  state.nextIssueNumber += 1;
  const file = join(projectDir, "issues", `${issueNumber}.md`);
  if (existsSync(file)) {
    output.write(`  ${file} already exists — counter repaired\n`);
    saveProjectState(projectDir, state);
    return;
  }
  mkdirSync(join(projectDir, "issues"), { recursive: true });
  writeFileSync(
    file,
    renderTaskContextFile({
      issueNumber,
      component: component.trim(),
      title: title.trim(),
      dependsOn: [],
      origin: "manual",
      derivedStatus: "ready",
      body: "Describe the scope, acceptance notes, and files to touch.",
    }),
    "utf8",
  );
  saveProjectState(projectDir, state);
  output.write(`  ＋ issues/${issueNumber}.md created\n`);
}
