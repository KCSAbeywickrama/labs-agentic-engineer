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
 * Prompt-assembly RED/GREEN for the skill-driven task-planner (no tokens).
 * The deterministic eval uses a hard-coded mock model, so it cannot show the
 * skill influencing model behaviour; instead we prove the mechanism — that the
 * pushed `task-breakdown` skill body lands in the prompt (GREEN) and that the
 * route still functions on the built-in fallback when nothing is pushed (RED
 * baseline). The full behavioural proof is the token eval (report-not-gate).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlanUserPrompt, buildDetailUserPrompt } from "./prompt.js";
import type { TaskPlannerPlanInput, TaskPlannerDetailItem } from "./schema.js";

const PLAN_INPUT: TaskPlannerPlanInput = {
  projectName: "orders",
  spec: "# Orders",
  mode: "fresh",
  slimDesign: [
    { name: "orders-api", componentType: "service", language: "Go", dependsOn: [] },
  ],
};

const DETAIL_ITEM: TaskPlannerDetailItem = {
  taskId: "t1",
  componentName: "orders-api",
  title: "Build the orders API",
  rationale: "core",
  designSlice: '{"name":"orders-api"}',
  depSummaries: [],
  existingTitlesForComponent: [],
};

const SENTINEL_PLAN = "SENTINEL_PLAN_BODY_9f3a";
const SENTINEL_DETAIL = "SENTINEL_DETAIL_BODY_7q1b";

test("GREEN: plan prompt embeds the pushed task-breakdown skill body", () => {
  const prompt = buildPlanUserPrompt({
    ...PLAN_INPUT,
    taskBreakdownSkill: {
      name: "task-breakdown",
      description: "d",
      body: `# Task breakdown\n${SENTINEL_PLAN}`,
    },
  });
  assert.match(prompt, /Task-breakdown guidance/);
  assert.ok(prompt.includes(SENTINEL_PLAN), "pushed skill body must land in the plan prompt");
});

test("RED baseline: plan prompt falls back to built-in guidance without a skill", () => {
  const prompt = buildPlanUserPrompt(PLAN_INPUT);
  // The guidance section still renders (route stays functional)…
  assert.match(prompt, /Task-breakdown guidance/);
  // …but from the built-in fallback, not the (absent) pushed body.
  assert.ok(!prompt.includes(SENTINEL_PLAN));
  assert.match(prompt, /exactly one task per component/);
});

test("GREEN: detail prompt embeds the pushed task-breakdown skill body", () => {
  const prompt = buildDetailUserPrompt("orders", "# Orders", DETAIL_ITEM, {
    name: "task-breakdown",
    description: "d",
    body: `# Task breakdown\n${SENTINEL_DETAIL}`,
  });
  assert.match(prompt, /Task-breakdown guidance/);
  assert.ok(prompt.includes(SENTINEL_DETAIL));
});

test("RED baseline: detail prompt omits the breakdown block without a skill", () => {
  const prompt = buildDetailUserPrompt("orders", "# Orders", DETAIL_ITEM);
  assert.ok(!prompt.includes("Task-breakdown guidance"));
  assert.ok(!prompt.includes(SENTINEL_DETAIL));
});
