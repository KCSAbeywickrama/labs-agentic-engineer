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

import type { AgentGuardrailStatus } from "@aep/ui-agent-view";

/** The slice of a deployment row this reads. */
interface DeploymentRow {
  environment?: string | undefined;
  guardrails?: { policy: string; status: string; reason?: string }[] | undefined;
}

/** The slice of the deployments read this reads. */
export interface DeploymentsRead {
  isPending: boolean;
  deployments: DeploymentRow[];
}

/**
 * The Agent spec's per-guardrail status, from the agent's deployment rows
 * (`Deployment.guardrails`, what the last deploy did with each declared
 * guardrail, per environment), keyed by policy. `undefined` while the read is
 * in flight, so the panel never claims a guardrail has not been deployed when
 * it simply has not been read yet.
 */
export function agentGuardrailStatus(read: DeploymentsRead): Record<string, AgentGuardrailStatus[]> | undefined {
  if (read.isPending) return undefined;
  const out: Record<string, AgentGuardrailStatus[]> = {};
  for (const row of read.deployments) {
    const environment = row.environment ?? "";
    for (const g of row.guardrails ?? []) {
      (out[g.policy] ??= []).push(g.reason ? { environment, status: g.status, reason: g.reason } : { environment, status: g.status });
    }
  }
  return out;
}
