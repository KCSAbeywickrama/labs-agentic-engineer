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

// Deployments page (#216): the table joins the components list with the
// project's release bindings client-side — absence is information ("what's
// running AND what isn't"), so every component gets at least one row.

// "Undeployed" is the contract's distinguished status for an intentional
// spec.state == Undeploy binding; any other reason is OpenChoreo's latest
// Ready-condition reason, where only "Ready" is a settled success and
// failure is recognizable by its wording.
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

export type DeploymentRow = {
  componentName: string;
  displayName: string;
  // "notDeployed" marks a component with no binding at all; otherwise the
  // binding's status kind.
  kind: StatusKind | "notDeployed";
  deployment?: Deployment;
};

export function joinDeploymentRows(
  componentItems: Component[] | null | undefined,
  deploymentItems: Deployment[] | null | undefined,
): DeploymentRow[] {
  const displayNames = new Map<string, string>();
  for (const c of componentItems ?? []) {
    displayNames.set(c.name, c.displayName || c.name);
  }

  const rows: DeploymentRow[] = [];
  const deployedComponents = new Set<string>();
  for (const d of deploymentItems ?? []) {
    const componentName = d.componentName ?? "";
    deployedComponents.add(componentName);
    rows.push({
      componentName,
      displayName: displayNames.get(componentName) ?? componentName,
      kind: statusKind(d.status),
      deployment: d,
    });
  }
  for (const c of componentItems ?? []) {
    if (!deployedComponents.has(c.name)) {
      rows.push({
        componentName: c.name,
        displayName: displayNames.get(c.name) ?? c.name,
        kind: "notDeployed",
      });
    }
  }

  return rows.sort(
    (a, b) =>
      a.componentName.localeCompare(b.componentName) ||
      (a.deployment?.environment ?? "").localeCompare(
        b.deployment?.environment ?? "",
      ),
  );
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
