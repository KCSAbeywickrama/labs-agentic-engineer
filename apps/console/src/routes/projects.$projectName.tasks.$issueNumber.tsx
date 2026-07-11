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

// The Tasks section became the Builds page (#185); old task links keep
// working. The issue number passes through untouched (string is fine — the
// builds detail route re-parses it).
export const Route = createFileRoute(
  "/projects/$projectName/tasks/$issueNumber",
)({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/projects/$projectName/builds/$issueNumber",
      params: {
        projectName: params.projectName,
        issueNumber: Number(params.issueNumber),
      },
      replace: true,
    });
  },
});
