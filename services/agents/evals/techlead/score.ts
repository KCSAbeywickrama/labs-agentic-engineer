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
 * Tech-lead plan scoring — shared by the deterministic plumbing test (mock
 * model) and the live model eval, so both grade a plan the same way. The two
 * dependency-awareness properties the migration cares about:
 *   1. build order — a consumer's task lists its provider's task in dependsOn
 *      (component-kind deps ⇒ consumer ordered after provider);
 *   2. resource gates — a component with an external / platform-resource
 *      dependency mentions the named gate in that task's rationale (never a
 *      separate config-collection / resource-provisioning task).
 */

import type { PlanItemWithTempId } from "../../src/agents/techlead/validator.js";

export interface PlanExpectations {
  /** Each [consumerComponent, providerComponent] pair the plan must order. */
  providerBeforeConsumer?: [string, string][];
  /** Component → substrings its task rationale must mention (gate names). */
  gatesInRationale?: Record<string, string[]>;
  /** Every design component gets at least one task. */
  coverAllComponents?: boolean;
}

export interface TechLeadPlanFixture {
  name: string;
  difficulty?: string;
  input: unknown; // validated to PlanRequestBody by the caller
  expect: PlanExpectations;
}

export interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

/** Score a sealed plan against a fixture's expectations. Pure, no tokens. */
export function scorePlan(
  items: PlanItemWithTempId[],
  expect: PlanExpectations,
  componentNames: string[],
): Check[] {
  const checks: Check[] = [];
  const titleByComponent = new Map<string, string>();
  const itemByComponent = new Map<string, PlanItemWithTempId>();
  for (const it of items) {
    if (!itemByComponent.has(it.componentName)) {
      itemByComponent.set(it.componentName, it);
      titleByComponent.set(it.componentName, it.title);
    }
  }

  checks.push({ name: "non-empty", pass: items.length > 0, detail: `${items.length} item(s)` });

  if (expect.coverAllComponents) {
    const missing = componentNames.filter((n) => !itemByComponent.has(n));
    checks.push({
      name: "covers-all-components",
      pass: missing.length === 0,
      ...(missing.length ? { detail: `missing: ${missing.join(",")}` } : {}),
    });
  }

  for (const [consumer, provider] of expect.providerBeforeConsumer ?? []) {
    const consumerItem = itemByComponent.get(consumer);
    const providerTitle = titleByComponent.get(provider);
    const ok =
      !!consumerItem && !!providerTitle && consumerItem.dependsOn.includes(providerTitle);
    checks.push({
      name: `order:${consumer}-after-${provider}`,
      pass: ok,
      ...(ok
        ? {}
        : { detail: `expected ${consumer}.dependsOn to include ${provider}'s task title "${providerTitle ?? "?"}"` }),
    });
  }

  for (const [component, mentions] of Object.entries(expect.gatesInRationale ?? {})) {
    const item = itemByComponent.get(component);
    const rationale = (item?.rationale ?? "").toLowerCase();
    const missing = mentions.filter((m) => !rationale.includes(m.toLowerCase()));
    checks.push({
      name: `gate-rationale:${component}`,
      pass: !!item && missing.length === 0,
      ...(item && missing.length === 0
        ? {}
        : { detail: item ? `rationale missing: ${missing.join(", ")}` : `no task for ${component}` }),
    });
  }

  return checks;
}

export const allPass = (checks: Check[]): boolean => checks.every((c) => c.pass);
