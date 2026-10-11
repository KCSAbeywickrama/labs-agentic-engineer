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
 * The task-generation driver (#356): the one-shot Plan turn on the Turn
 * socket, mirroring the playground's `tasksCommand` — the last ok
 * `planBuild` of a completed turn becomes ONE build issue rendered by the
 * plan service's own code (`cmd/build-plan issue`) — but with the scenario's
 * scope instead of a selection, and through the eval's tracing capture.
 * No sim user: the section is one-shot by construction.
 */

import { openSession } from "@aep/playground/src/engine/session.js";
import { lastBuildPlan, runPlanTurn } from "@aep/playground/src/engine/plan-turn.js";
import { renderBuildIssue } from "@aep/playground/src/engine/build-plan.js";
import { tasksGate } from "@aep/playground/src/engine/gates.js";
import { FsIssueStore, type Issue } from "@aep/playground/src/ports/issue-store.js";
import { saveProjectState } from "@aep/playground/src/state/project.js";
import type { BuildPlanOk, PlanScope } from "@aep/agent-stream";
import { collectPart, newTurnRecord, reportTurnTrace, type TurnRecord } from "../tracing.js";

export interface TaskPlanRunResult {
  section: "tasks";
  records: TurnRecord[];
  /** The checklist the turn settled on, when it completed with one. */
  plan?: BuildPlanOk;
  issues: Issue[];
  error?: string;
}

/** `scope` is what the platform would say the version carries (aep-api `planScopeFor`). */
export async function runTaskPlanSection(projectDir: string, scope?: PlanScope): Promise<TaskPlanRunResult> {
  const gate = tasksGate(projectDir);
  if (!gate.ok) {
    return { section: "tasks", records: [], issues: [], error: `gate: ${gate.reason ?? "blocked"}` };
  }

  const session = await openSession(projectDir, {});
  try {
    const store = new FsIssueStore(projectDir);
    const rec = newTurnRecord("tasks", 1, "task-plan (one-shot)");
    const start = Date.now();
    // A Plan turn on the Turn socket, as aep-api starts one in production.
    const result = await runPlanTurn(session, {
      onPart: (part) => collectPart(rec, part),
      ...(scope ? { scope } : {}),
    });
    rec.ms = Date.now() - start;
    reportTurnTrace(rec, start);

    const plan = lastBuildPlan(result);
    let error = result.error ?? (plan ? undefined : "the plan turn completed without a build plan");
    if (plan) {
      const version = scope?.tag ?? "v1";
      const features = (scope?.features ?? []).map((f) => f.id);
      const rendered = await renderBuildIssue(projectDir, { version, ...(features.length ? { features } : {}) }, plan.items);
      if (rendered.ok) {
        store.writeBuildIssue(
          { title: rendered.title, version, body: rendered.body },
          store.safeAllocator(
            () => session.state.nextIssueNumber,
            (advancedTo) => {
              session.state.nextIssueNumber = advancedTo;
            },
          ),
        );
        saveProjectState(projectDir, session.state);
      } else {
        error = rendered.detail;
      }
    }

    return { section: "tasks", records: [rec], ...(plan ? { plan } : {}), issues: store.list(), ...(error ? { error } : {}) };
  } finally {
    await session.close();
  }
}
