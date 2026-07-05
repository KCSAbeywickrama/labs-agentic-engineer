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
 * Wire-parity + validator tests (no tokens). Pins the tech-lead schema against
 * aep-api's Go client (`internal/clients/agents/client.go`) and the response
 * frame parser (`internal/feature/task/task_stream.go`), so a drift that would
 * break the URL-swap cutover fails here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PlanRequestBody,
  PlanItemSchema,
  TechLeadDetailInput,
} from "./schema.js";
import { validatePlan, type PlanItemWithTempId } from "./validator.js";

// The EXACT JSON aep-api's client.go marshals for TechLeadPlanRequest — the
// current wire (buildPlanRequest → TechLeadSlimComponent sends only
// name/componentType/language/dependsOn). Parity means this parses unchanged.
const AEP_API_PLAN_REQUEST = {
  projectName: "orders",
  spec: "# Orders platform",
  slimDesign: [
    { name: "orders-api", componentType: "service", language: "Go", dependsOn: [] },
    { name: "orders-web", componentType: "webapp", language: "TypeScript", dependsOn: ["orders-api"] },
  ],
  mode: "fresh",
  existingTasks: [],
  attachedSkills: [{ name: "go", description: "Go stack conventions" }],
  diff: { added: ["orders-api"], contractAffectedModified: [], removed: [] },
};

test("PlanRequestBody accepts the exact aep-api client.go plan payload", () => {
  const parsed = PlanRequestBody.parse(AEP_API_PLAN_REQUEST);
  assert.equal(parsed.slimDesign.length, 2);
  assert.deepEqual(parsed.slimDesign[1]?.dependsOn, ["orders-api"]);
  // Additive dependency-awareness fields are absent on the current wire.
  assert.equal(parsed.slimDesign[0]?.externalResources, undefined);
  assert.equal(parsed.slimDesign[0]?.platformResources, undefined);
});

test("SlimDesignComponent accepts additive dependency-awareness fields (forward-compat)", () => {
  const parsed = PlanRequestBody.parse({
    ...AEP_API_PLAN_REQUEST,
    slimDesign: [
      {
        name: "orders-api",
        componentType: "service",
        language: "Go",
        dependsOn: [],
        externalResources: [{ name: "stripe", description: "payments" }],
        platformResources: [{ name: "orders-db", resourceType: "postgres-cnpg" }],
        orgServiceDependencies: [{ name: "identity" }],
      },
    ],
  });
  assert.equal(parsed.slimDesign[0]?.externalResources?.[0]?.name, "stripe");
  assert.equal(parsed.slimDesign[0]?.platformResources?.[0]?.resourceType, "postgres-cnpg");
  assert.equal(parsed.slimDesign[0]?.orgServiceDependencies?.[0]?.name, "identity");
});

test("PlanItem carries exactly the fields task_stream's planItemFrame reads", () => {
  // task_stream.go planItemFrame = {tempId, componentName, title, rationale, dependsOn}.
  // tempId is route-assigned; the model emits the other four.
  const item = PlanItemSchema.parse({
    componentName: "orders-web",
    title: "Build the orders web app",
    rationale: "The UI the spec calls for",
    dependsOn: ["Build the orders API"],
  });
  assert.deepEqual(Object.keys(item).sort(), ["componentName", "dependsOn", "rationale", "title"]);
});

test("TechLeadDetailInput accepts the exact aep-api detail payload", () => {
  const parsed = TechLeadDetailInput.parse({
    projectName: "orders",
    spec: "# Orders",
    items: [
      {
        taskId: "uuid-1",
        componentName: "orders-api",
        title: "Build the orders API",
        rationale: "core service",
        designSlice: '{"name":"orders-api"}',
        depSummaries: [],
        existingTitlesForComponent: [],
        skillsResolved: [{ name: "go", description: "Go", body: "# Go" }],
      },
    ],
  });
  assert.equal(parsed.items[0]?.taskId, "uuid-1");
});

const design = [
  { name: "svc-a", componentType: "service", language: "Go", dependsOn: [] },
  { name: "svc-b", componentType: "service", language: "Go", dependsOn: ["svc-a"] },
];

test("validatePlan: clean plan yields no issues", () => {
  const items: PlanItemWithTempId[] = [
    { tempId: "p-0", componentName: "svc-a", title: "A", rationale: "r", dependsOn: [] },
    { tempId: "p-1", componentName: "svc-b", title: "B", rationale: "r", dependsOn: ["A"] },
  ];
  assert.deepEqual(validatePlan({ items, design, existingTasks: [], mode: "fresh" }), []);
});

test("validatePlan: flags unknown-component, dangling-dep, title-collision, cycle, empty-fresh", () => {
  const unknown = validatePlan({
    items: [{ tempId: "p-0", componentName: "ghost", title: "G", rationale: "r", dependsOn: [] }],
    design,
    existingTasks: [],
    mode: "fresh",
  });
  assert.ok(unknown.some((i) => i.code === "unknown-component"));

  const dangling = validatePlan({
    items: [{ tempId: "p-0", componentName: "svc-a", title: "A", rationale: "r", dependsOn: ["nope"] }],
    design,
    existingTasks: [],
    mode: "fresh",
  });
  assert.ok(dangling.some((i) => i.code === "dangling-dep"));

  const collide = validatePlan({
    items: [
      { tempId: "p-0", componentName: "svc-a", title: "SAME", rationale: "r", dependsOn: [] },
      { tempId: "p-1", componentName: "svc-b", title: "SAME", rationale: "r", dependsOn: [] },
    ],
    design,
    existingTasks: [],
    mode: "fresh",
  });
  assert.ok(collide.some((i) => i.code === "title-collision"));

  const cycle = validatePlan({
    items: [
      { tempId: "p-0", componentName: "svc-a", title: "A", rationale: "r", dependsOn: ["B"] },
      { tempId: "p-1", componentName: "svc-b", title: "B", rationale: "r", dependsOn: ["A"] },
    ],
    design,
    existingTasks: [],
    mode: "fresh",
  });
  assert.ok(cycle.some((i) => i.code === "depends-on-cycle"));

  const empty = validatePlan({ items: [], design, existingTasks: [], mode: "fresh" });
  assert.ok(empty.some((i) => i.code === "empty-plan-fresh"));
});
