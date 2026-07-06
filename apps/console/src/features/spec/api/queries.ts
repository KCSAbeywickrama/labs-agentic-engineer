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

import { useQuery } from "@tanstack/react-query";
import { client } from "../../../api/client";
import { specKeys } from "./keys";

// The file list fills in while agents derive the spec, so the bundle polls
// at the same cadence as the overview's reads (#77 decision: 10s).
const SPEC_POLL_MS = 10_000;

export function useProjectSpec(projectName: string) {
  return useQuery({
    queryKey: specKeys.bundle(projectName),
    queryFn: async () => {
      const { data, error } = await client.GET("/projects/{projectName}/spec", {
        params: { path: { projectName } },
      });
      if (error || data === undefined) {
        const e = error as { detail?: string; title?: string } | undefined;
        throw new Error(e?.detail ?? e?.title ?? "Failed to load the spec");
      }
      return data;
    },
    refetchInterval: SPEC_POLL_MS,
  });
}
