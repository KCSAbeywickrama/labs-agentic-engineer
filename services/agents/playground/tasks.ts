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
 * Playground `/tasks` command — runs the task-planner PLANNER over the current
 * thread's spec bundle and renders the task plan. It mirrors how `runTurn`
 * drives the main agent (read the thread folder → run in-process → render), but
 * against `runTaskPlannerPlan` directly (the task-planner is a structured-output
 * agent, not a file-mutation conversation, so there is no bundle to write back).
 *
 * The plan input is derived from the thread's `specs/design/components/<name>/
 * design.json` files — the same `dependencies[]` the task-planner reasons about:
 * component deps drive build order (dependsOn); external / platform-resource /
 * org-service deps become planning context so the plan can name the gates.
 */

import type { LanguageModel } from "ai";
import { stdout as output } from "node:process";
import {
  componentDesignSchema,
  COMPONENT_DESIGN_JSON_RE,
} from "../src/agents/main/component-design.js";
import type { TaskPlannerPlanInput, SlimDesignComponent } from "../src/agents/taskplanner/schema.js";
import { runTaskPlannerPlan } from "../src/agents/taskplanner/run.js";
import type { PlanItemWithTempId } from "../src/agents/taskplanner/validator.js";
import type { Skill } from "../src/contracts/sse-events.js";

/** Slim one parsed ComponentDesign, splitting its unified deps by kind. */
function slimOf(d: ReturnType<typeof componentDesignSchema.parse>): SlimDesignComponent {
  const dependsOn: string[] = [];
  const externalResources: { name: string; description?: string }[] = [];
  const platformResources: { name: string; resourceType?: string; description?: string }[] = [];
  const orgServiceDependencies: { name: string; description?: string }[] = [];
  for (const dep of d.dependencies) {
    switch (dep.kind) {
      case "component":
        dependsOn.push(dep.name);
        break;
      case "external":
        externalResources.push({ name: dep.name, ...(dep.description ? { description: dep.description } : {}) });
        break;
      case "platform-resource":
        platformResources.push({
          name: dep.name,
          ...(dep.resourceType ? { resourceType: dep.resourceType } : {}),
          ...(dep.description ? { description: dep.description } : {}),
        });
        break;
      case "org-service":
        orgServiceDependencies.push({ name: dep.name, ...(dep.description ? { description: dep.description } : {}) });
        break;
    }
  }
  return {
    name: d.name,
    componentType: d.type,
    language: d.language,
    dependsOn,
    ...(externalResources.length ? { externalResources } : {}),
    ...(platformResources.length ? { platformResources } : {}),
    ...(orgServiceDependencies.length ? { orgServiceDependencies } : {}),
  };
}

/** Build a fresh-mode plan input from a thread's file snapshot. */
export function buildPlanInput(
  projectName: string,
  files: Record<string, string>,
  skills: Skill[],
): { input: TaskPlannerPlanInput; problems: string[] } {
  const slimDesign: SlimDesignComponent[] = [];
  const problems: string[] = [];

  for (const [path, content] of Object.entries(files)) {
    if (!COMPONENT_DESIGN_JSON_RE.test(path)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      problems.push(`${path}: invalid JSON`);
      continue;
    }
    const res = componentDesignSchema.safeParse(parsed);
    if (!res.success) {
      problems.push(`${path}: ${res.error.issues.map((i) => i.message).join("; ")}`);
      continue;
    }
    slimDesign.push(slimOf(res.data));
  }

  const spec =
    files["specs/requirements/requirements.md"] ??
    files["specs/design/design.md"] ??
    "(no top-level spec found)";

  // Push the repo-root `task-breakdown` skill body like the platform does — it
  // carries the decomposition judgment the planner applies. Absent → the
  // prompt's built-in fallback stands.
  const breakdown = skills.find((s) => s.name === "task-breakdown");

  const input: TaskPlannerPlanInput = {
    projectName,
    spec,
    slimDesign,
    mode: "fresh",
    attachedSkills: skills.map((s) => ({ name: s.name, description: s.description })),
    ...(breakdown
      ? {
          taskBreakdownSkill: {
            name: breakdown.name,
            description: breakdown.description,
            body: breakdown.content,
          },
        }
      : {}),
  };
  return { input, problems };
}

function renderPlanItem(item: PlanItemWithTempId): void {
  const deps = item.dependsOn.length ? ` ⟵ ${item.dependsOn.join(", ")}` : "";
  output.write(`  • [${item.componentName}] ${item.title}${deps}\n`);
  output.write(`      ${item.rationale}\n`);
}

/**
 * Run the task-planner planner over the thread's current files and render the plan
 * as each item seals. Returns nothing — the plan is a read-only view (no files
 * are written), matching the service's write-nothing contract.
 */
export async function runTasksCommand(
  projectName: string,
  files: Record<string, string>,
  skills: Skill[],
  model: LanguageModel,
): Promise<void> {
  const { input, problems } = buildPlanInput(projectName, files, skills);
  for (const p of problems) output.write(`  ⚠ skipped ${p}\n`);

  if (input.slimDesign.length === 0) {
    output.write("  no component design.json files found under specs/design/components/ — nothing to plan.\n");
    return;
  }

  output.write(`\nPlanning ${input.slimDesign.length} component(s)…\n`);
  try {
    const { items, issues } = await runTaskPlannerPlan({
      model,
      input,
      onSealed: renderPlanItem,
    });
    if (issues.length > 0) {
      output.write(`\n  ✗ plan has ${issues.length} validator issue(s): ${issues.map((i) => i.code).join(", ")}\n`);
      return;
    }
    output.write(`\n  ✓ ${items.length} task(s) planned.\n`);
  } catch (e) {
    output.write(`\n  [tasks failed] ${e instanceof Error ? e.message : String(e)}\n`);
  }
}
