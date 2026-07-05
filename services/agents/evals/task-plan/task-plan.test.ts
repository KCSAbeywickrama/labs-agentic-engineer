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
 * Deterministic plan-turn eval tests (no tokens): the pure scorer/trace over
 * synthetic frames, the fixture shapes, and the WHOLE harness pipeline driven by
 * a MOCK model over the real SSE route with `toolset: "task-plan"`. Proves the
 * accumulator + tool wiring + scoring contract before any real-model run.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { StreamPart } from "@aep/agent-stream";
import { mockModel, type MockStep } from "../../src/shared/mock-model.js";
import { loadRepoSkills } from "../skills.js";
import { runFixture } from "./harness.js";
import { scoreTaskPlan, traceOfTurn } from "./scoring.js";
import { taskPlanSuite, taskPlanFixtures, INCREMENTAL_SEED } from "./task-plan.eval.js";

const skills = taskPlanSuite.skillsDir ? loadRepoSkills(taskPlanSuite.skillsDir) : [];
const fresh = taskPlanFixtures.find((f) => f.name === "fresh")!;
const incremental = taskPlanFixtures.find((f) => f.name === "incremental")!;

// --- fixture shapes ---------------------------------------------------------

test("the repo skill library includes task-planning (pushed to the plan turn)", () => {
  assert.ok(skills.some((s) => s.name === "task-planning"), skills.map((s) => s.name).join(", "));
});

test("fresh fixture: three-component design, empty tasks/", () => {
  const seed = fresh.seed ?? taskPlanSuite.defaultSeed;
  assert.equal(Object.keys(seed).some((p) => p.startsWith("tasks/")), false);
  for (const c of ["user-service", "order-service", "order-webapp"]) {
    assert.ok(seed[`specs/design/components/${c}/design.json`], `missing ${c}`);
  }
});

test("incremental fixture: existing Tasks + a new component", () => {
  assert.ok(INCREMENTAL_SEED["tasks/1.md"] && INCREMENTAL_SEED["tasks/2.md"] && INCREMENTAL_SEED["tasks/3.md"]);
  assert.ok(INCREMENTAL_SEED["specs/design/components/notification-service/design.json"]);
  assert.deepEqual(incremental.turns[0]!.expect.noPlanForComponents, ["user-service", "order-service", "order-webapp"]);
});

// --- pure scorer / trace ----------------------------------------------------

test("traceOfTurn distills plan frames, pairs results by id, and credits bodies by title", () => {
  const parts: StreamPart[] = [
    { type: "tool-call", toolName: "loadSkill", toolCallId: "s", input: { names: ["task-planning"] } },
    { type: "tool-result", toolName: "loadSkill", toolCallId: "s", output: { ok: true } },
    { type: "tool-call", toolName: "planTask", toolCallId: "p1", input: { component: "order-service", title: "Order", dependsOn: ["user-service"] } },
    { type: "tool-result", toolName: "planTask", toolCallId: "p1", output: { ok: true } },
    { type: "tool-call", toolName: "planTask", toolCallId: "p2", input: { component: "billing", title: "Bill", dependsOn: [] } },
    { type: "tool-result", toolName: "planTask", toolCallId: "p2", output: { ok: false, code: "UNKNOWN_COMPONENT" } },
    // Rename the planned Order task, then body it by its NEW title — must still credit the plan.
    { type: "tool-call", toolName: "updateTask", toolCallId: "u1", input: { ref: { title: "Order" }, set: { title: "Order v2" } } },
    { type: "tool-result", toolName: "updateTask", toolCallId: "u1", output: { ok: true } },
    { type: "tool-call", toolName: "updateTask", toolCallId: "u2", input: { ref: { title: "Order v2" }, set: { body: "scope" } } },
    { type: "tool-result", toolName: "updateTask", toolCallId: "u2", output: { ok: true } },
    // A body written to an EXISTING task by issueNumber must NOT satisfy a plan's body quota.
    { type: "tool-call", toolName: "updateTask", toolCallId: "u3", input: { ref: { issueNumber: 9 }, set: { body: "existing" } } },
    { type: "tool-result", toolName: "updateTask", toolCallId: "u3", output: { ok: true } },
  ];
  const trace = traceOfTurn(parts);
  assert.deepEqual(trace.loadedSkills, ["task-planning"]);
  assert.deepEqual(trace.plannedComponents, ["order-service"]); // the failed plan is excluded
  assert.equal(trace.planCount, 1);
  assert.equal(trace.plansMissingBody, 0); // credited via the renamed title
  assert.equal(trace.anyDependsOn, true);
  assert.equal(trace.toolErrors, 1);

  const checks = scoreTaskPlan(
    { loadedSkills: ["task-planning"], plannedComponents: ["order-service"], singlePlanFor: ["order-service"], noPlanForComponents: ["billing"], someDependsOn: true, bodyForEveryPlan: true, noToolErrors: true },
    trace,
  );
  assert.equal(checks.find((c) => c.clause === "noToolErrors")!.pass, false); // p2 failed
  assert.equal(checks.find((c) => c.clause === "noPlanFor billing")!.pass, true); // failed plan doesn't count
  assert.equal(checks.find((c) => c.clause === "singlePlanFor order-service")!.pass, true);
  assert.equal(checks.find((c) => c.clause === "bodyForEveryPlan")!.pass, true);
});

test("bodyForEveryPlan fails when only an EXISTING task is bodied, not the planned one", () => {
  const parts: StreamPart[] = [
    { type: "tool-call", toolName: "planTask", toolCallId: "p1", input: { component: "order-service", title: "Order", dependsOn: [] } },
    { type: "tool-result", toolName: "planTask", toolCallId: "p1", output: { ok: true } },
    { type: "tool-call", toolName: "updateTask", toolCallId: "u1", input: { ref: { issueNumber: 9 }, set: { body: "existing body" } } },
    { type: "tool-result", toolName: "updateTask", toolCallId: "u1", output: { ok: true } },
  ];
  const trace = traceOfTurn(parts);
  assert.equal(trace.plansMissingBody, 1);
  const checks = scoreTaskPlan({ bodyForEveryPlan: true }, trace);
  assert.equal(checks.find((c) => c.clause === "bodyForEveryPlan")!.pass, false);
});

// --- whole harness over the real route (mock model) -------------------------

/** A passing plan: load the skill, plan each component (deps in DAG order), write bodies. */
function planSteps(plans: { component: string; title: string; dependsOn: string[] }[]): MockStep[] {
  const steps: MockStep[] = [
    { kind: "toolCall", toolCallId: "skill", toolName: "loadSkill", input: { names: ["task-planning"] } },
  ];
  plans.forEach((p, i) =>
    steps.push({ kind: "toolCall", toolCallId: `p${i}`, toolName: "planTask", input: { component: p.component, title: p.title, dependsOn: p.dependsOn, rationale: `Build ${p.component}.` } }),
  );
  plans.forEach((p, i) =>
    steps.push({ kind: "toolCall", toolCallId: `b${i}`, toolName: "updateTask", input: { ref: { title: p.title }, set: { body: `## Scope\nImplement ${p.component}.` } } }),
  );
  steps.push({ kind: "text", text: "planned." });
  return steps;
}

test("fresh: mock plan turn scores green over the real route (accumulator + scorer)", async () => {
  const model = mockModel(
    planSteps([
      { component: "user-service", title: "Implement user-service", dependsOn: [] },
      { component: "order-service", title: "Implement order-service", dependsOn: ["user-service"] },
      { component: "order-webapp", title: "Implement order-webapp", dependsOn: ["order-service"] },
    ]),
  );
  const result = await runFixture(taskPlanSuite, fresh, { model, samples: 1, skills });
  assert.equal(result.passed, 1, JSON.stringify(result.sampleResults[0]?.turns, null, 2));
});

test("incremental: mock plans only the new component, never re-planning covered ones", async () => {
  const model = mockModel(
    planSteps([{ component: "notification-service", title: "Implement notification-service", dependsOn: ["user-service"] }]),
  );
  const result = await runFixture(taskPlanSuite, incremental, { model, samples: 1, skills });
  assert.equal(result.passed, 1, JSON.stringify(result.sampleResults[0]?.turns, null, 2));
});
