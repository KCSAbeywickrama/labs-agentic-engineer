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

import { queryOptions } from "@tanstack/react-query";
import { client } from "../../../api/client";
import { ApiRequestError } from "../../../api/errors";
import type { components } from "../../../generated/aep-api";

// The build preflight (get-build-preflight): what the design's dependencies
// still need before a version can ship, read from the design at HEAD. The
// design review reads the dependencies that wait on a person from it, and a
// build start reads it afresh for the approvals the build carries
// (buildSelection.ts), so both read one query.

type BuildPreflight = components["schemas"]["BuildPreflight"];

/** The project's build preflight, as one query. */
export function buildPreflightQuery(projectName: string) {
  return queryOptions({
    queryKey: ["projects", projectName, "build-preflight"] as const,
    queryFn: async (): Promise<BuildPreflight> => {
      const { data, error } = await client.GET("/projects/{projectName}/build/preflight", {
        params: { path: { projectName } },
      });
      if (error || data === undefined) throw new ApiRequestError(error, "Couldn't read the design's dependencies");
      return data;
    },
  });
}
