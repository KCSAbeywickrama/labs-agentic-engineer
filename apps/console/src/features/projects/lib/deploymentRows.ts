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

import type { components } from "../../../generated/aep-api";

type Component = components["schemas"]["Component"];
type Deployment = components["schemas"]["Deployment"];

// Deployments board (#216): two columns — Development and Production — fed
// by the components list joined client-side with each component's release
// bindings. Absence is information ("what's running AND what isn't"), so
// every component gets a Development card even with no binding.

// "Undeployed" is the distinguished status for an intentional
// spec.state == Undeploy binding (rendered if the backend ever emits it);
// any other reason is OpenChoreo's latest Ready-condition reason, where
// only "Ready" is a settled success and failure is recognizable by its
// wording.
export type StatusKind =
  | "success"
  | "error"
  | "transitional"
  | "undeployed"
  | "unknown";

export function statusKind(status: string | undefined): StatusKind {
  if (!status) return "unknown";
  if (status === "Ready") return "success";
  if (status === "Undeployed") return "undeployed";
  if (/fail|error|degraded/i.test(status)) return "error";
  return "transitional";
}

export type DeploymentCard = {
  componentName: string;
  displayName: string;
  // "notDeployed" marks a component with no binding at all; otherwise the
  // binding's status kind.
  kind: StatusKind | "notDeployed";
  deployment?: Deployment;
};

export type DeploymentBoard = {
  development: DeploymentCard[];
  production: DeploymentCard[];
};

// Production gets exactly its bindings; everything else (development,
// staging, …) lands on the Development board, and a component with no
// non-production binding still gets a greyed "Not deployed" card there —
// the Development column always accounts for every component.
export function groupDeploymentCards(
  componentItems: Component[] | null | undefined,
  deploymentItems: Deployment[] | null | undefined,
): DeploymentBoard {
  const displayNames = new Map<string, string>();
  for (const c of componentItems ?? []) {
    displayNames.set(c.name, c.displayName || c.name);
  }
  const cardOf = (d: Deployment): DeploymentCard => {
    const componentName = d.componentName ?? "";
    return {
      componentName,
      displayName: displayNames.get(componentName) ?? componentName,
      kind: statusKind(d.status),
      deployment: d,
    };
  };

  const development: DeploymentCard[] = [];
  const production: DeploymentCard[] = [];
  const inDevelopment = new Set<string>();
  for (const d of deploymentItems ?? []) {
    if (d.environment === "production") {
      production.push(cardOf(d));
    } else {
      development.push(cardOf(d));
      inDevelopment.add(d.componentName ?? "");
    }
  }
  for (const c of componentItems ?? []) {
    if (!inDevelopment.has(c.name)) {
      development.push({
        componentName: c.name,
        displayName: displayNames.get(c.name) ?? c.name,
        kind: "notDeployed",
      });
    }
  }

  const byName = (a: DeploymentCard, b: DeploymentCard) =>
    a.componentName.localeCompare(b.componentName) ||
    (a.deployment?.environment ?? "").localeCompare(
      b.deployment?.environment ?? "",
    );
  development.sort(byName);
  production.sort(byName);
  return { development, production };
}

// Adaptive-poll signal (the STATUS_ACTIVE/IDLE convention, #183): a binding
// still converging — or not yet reporting a condition — keeps the fast poll.
export function deploymentsAreMoving(
  deploymentItems: Deployment[] | null | undefined,
): boolean {
  return (deploymentItems ?? []).some((d) => {
    const kind = statusKind(d.status);
    return kind === "transitional" || kind === "unknown";
  });
}
