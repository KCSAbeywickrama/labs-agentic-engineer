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

import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/deployments/$environment` used to be the environment's page (ADR-0027).
 * The environment now has two: Try Out, and a page per deployed version
 * (#779). The bare URL keeps resolving — every link into it lands on Try Out.
 */
export const Route = createFileRoute("/projects/$projectName/deployments/$environment/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/projects/$projectName/deployments/$environment/try-out",
      params,
      replace: true,
    });
  },
});
