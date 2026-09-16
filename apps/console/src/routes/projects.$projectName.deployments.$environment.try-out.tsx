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
import { DeploymentTryOutPage } from "../features/projects/components/DeploymentTryOutPage";

/**
 * Try Out — the environment's live components as things a person can act on
 * (#779): visit the app, call the endpoints, sign in as a test user. Keyed by
 * ENVIRONMENT: a release binding is current state, so an environment has
 * exactly one deployment to try. The page rejects a segment naming no
 * environment.
 */
export const Route = createFileRoute("/projects/$projectName/deployments/$environment/try-out")({
  component: TryOutRoute,
});

function TryOutRoute() {
  const { projectName, environment } = Route.useParams();
  return <DeploymentTryOutPage projectName={projectName} environment={environment} />;
}
