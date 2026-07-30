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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "../../../api/client";
import { apiErrorMessage } from "../../../api/errors";
import { projectKeys } from "../../projects/api/keys";
import { fetchSpecFileContent } from "../../spec/api/queries";
import { validationKeys } from "./keys";

// The acceptance oracle is authored under specs/ and read at HEAD via the Files
// API. The run report is NOT a repo file — the runner posts it to the tag's
// validation issue so successive runs stay individually addressable, and
// get-validation-report serves it from there.
export const CRITERIA_PATH = "specs/validation/validation-criteria.json";

// Fetch one validation artifact's content at HEAD. Reuses the spec Files reader
// (path-agnostic; `sha` only feeds its cache key, never the request — we key our
// own query instead). Keyed by (path, version) so a newly merged run refetches;
// retry is off since a 404 (no report yet) is deterministic, not transient.
function useValidationFile(
  projectName: string,
  path: string,
  version: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: validationKeys.file(projectName, path, version),
    enabled,
    retry: false,
    staleTime: 30_000,
    queryFn: () => fetchSpecFileContent(projectName, { path, sha: "" }),
  });
}

/** The acceptance oracle (specs/validation/validation-criteria.json). */
export function useValidationCriteria(
  projectName: string,
  version: string,
  enabled: boolean,
) {
  return useValidationFile(projectName, CRITERIA_PATH, version, enabled);
}

/**
 * The run report for a tag, read from that tag's validation issue.
 *
 * Retry is off: a 404 here means "no report was posted for this run", which is a
 * deterministic answer the page renders as such — not a transient failure worth
 * hammering.
 */
export function useValidationReport(
  projectName: string,
  tag: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: validationKeys.report(projectName, tag),
    enabled,
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/projects/{projectName}/validation/report",
        {
          params: {
            path: { projectName },
            ...(tag ? { query: { tag } } : {}),
          },
        },
      );
      if (error || data === undefined) {
        throw new Error(
          apiErrorMessage(error, "Failed to load the validation report"),
        );
      }
      return data;
    },
  });
}

/**
 * Record the human verdict on a run whose automatic verdict is awaiting_review.
 *
 * Only reachable from that state: an automatic pass or fail is final, and the
 * server answers 409 otherwise, so "passed" can never mean a human clicked past a
 * failing suite. Invalidates the project status, which is where the verdict is
 * read from.
 */
export function useSetValidationVerdict(projectName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { verdict: "pass" | "fail"; note?: string }) => {
      const { error } = await client.PATCH(
        "/projects/{projectName}/validation/verdict",
        { params: { path: { projectName } }, body },
      );
      if (error) {
        throw new Error(
          apiErrorMessage(error, "Failed to record the validation verdict"),
        );
      }
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectName) }),
  });
}
