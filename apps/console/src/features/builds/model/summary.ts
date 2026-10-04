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

import type { DeployStage } from "../../deploy/api/deploy";

// The Build card's summary line about its version's rollout, copied from the
// old console's build page (deploymentNote). The deploy aggregate names the
// version that reached the write target; every state it can be in gets its
// own sentence, so the card never says "deploys as its tasks merge" while the
// version is already rolling out.

export function rolloutLine(
  version: string,
  deploy: Pick<DeployStage, "status" | "version"> | undefined,
  parked: boolean,
): string {
  if (parked) return `${version} is built and waits for its dependencies' values before it deploys.`;
  if (deploy?.version !== version) return `${version} deploys as its tasks merge.`;
  switch (deploy.status) {
    case "deployed":
      return `${version} is live.`;
    case "deploying":
      return `${version} is rolling out now.`;
    case "failed":
      return `${version} failed to deploy.`;
    default:
      return `${version} deploys as its tasks merge.`;
  }
}
