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
 * The tasks screen: the `issues/*.md` table (dependsOn edges + derivedStatus)
 * plus plan/replan and run-the-whole-plan. Deliberately NO file affordances —
 * viewing, editing, and hand-authoring issue files happen in the user's
 * editor (the playground is used with VS Code open); execution is one go in
 * dependency order, never per-issue picking.
 */

import { stdout as output } from "node:process";
import * as clack from "@clack/prompts";
import { FsIssueStore } from "../ports/issue-store.js";
import { projectSlug } from "../ports/spec-workspace.js";

export type TasksAction = { kind: "plan" } | { kind: "code-all" } | { kind: "back" };

function statusIcon(s: string | undefined): string {
  if (s === "deployed") return "✓";
  if (s === "failed") return "✗";
  if (s === "running") return "▸";
  return "·"; // ready
}

/** Render the tasks table; returns the action the CLI should run. */
export async function tasksScreen(projectDir: string): Promise<TasksAction> {
  const store = new FsIssueStore(projectDir, projectSlug(projectDir));
  const issues = store.list();
  if (issues.length === 0) output.write("  (no issues yet — plan first; hand-authored issues/<n>.md files are picked up too)\n");
  for (const i of issues) {
    output.write(
      `  ${statusIcon(i.derivedStatus)} #${i.issueNumber} [${i.component}] ${i.title}${i.dependsOn.length ? ` ⇠ ${i.dependsOn.join(", ")}` : ""} (${i.derivedStatus ?? "ready"})\n`,
    );
  }

  const pending = issues.filter((i) => i.derivedStatus !== "deployed").length;
  const choice = await clack.select<TasksAction["kind"]>({
    message: "Tasks",
    options: [
      { value: "plan", label: issues.length ? "re-plan (adds tasks for uncovered components)" : "plan tasks" },
      ...(pending > 0 ? [{ value: "code-all" as const, label: `run the plan — ${pending} pending task(s), dependency order` }] : []),
      { value: "back", label: "back" },
    ],
  });
  if (clack.isCancel(choice)) return { kind: "back" };
  return { kind: choice };
}
