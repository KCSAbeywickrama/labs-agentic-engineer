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
import { BuildsCardRoute } from "../../../../features/builds/components/BuildsCard";

// The Builds card on one version: a build's own address, which the chat's
// "Watch it here" and the ledger link to. An unknown version shows the newest.
export const Route = createFileRoute("/projects/$projectName/builds/$version")({
  component: OneBuild,
});

function OneBuild() {
  const { projectName, version } = Route.useParams();
  return <BuildsCardRoute projectName={projectName} version={version} />;
}
