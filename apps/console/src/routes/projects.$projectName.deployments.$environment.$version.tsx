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

import { createFileRoute } from "@tanstack/react-router";
import { DeploymentVersionPage } from "../features/projects/components/DeploymentVersionPage";

/**
 * One deployed VERSION in an environment (#779): what the build story knows
 * about it — milestone, commit, when it was built, how it validated — and
 * what it runs there now when it is the environment's live version. There is
 * no deployment record behind this (ADR-0027 decision 4), so the segment is
 * the version tag, and a past version's rollout dates are not claimed.
 */
export const Route = createFileRoute("/projects/$projectName/deployments/$environment/$version")({
  component: VersionRoute,
});

function VersionRoute() {
  const { projectName, environment, version } = Route.useParams();
  return (
    <DeploymentVersionPage projectName={projectName} environment={environment} version={version} />
  );
}
