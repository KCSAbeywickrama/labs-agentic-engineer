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

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { client } from "../../../api/client";
import { apiErrorMessage } from "../../../api/errors";
import { env } from "../../../config/env";
import { buildBody, fixBody, type BuildSelection } from "../buildSelection";
import { runKeys } from "./runs";

// PROVISIONAL — the builds list is MOCK-ONLY until B1 lands the builds model.
//
// The build picker needs each version built so far: which features went in,
// the spec each was built from (to say what changed since), and the
// product-wide items it carried. Nothing in aep-api serves that yet (backend
// item B1). Until it does, the shape lives here, behind this one module, and
// only MSW answers it (mocks/handlers/builds.ts, on a path that is not in the
// contract). When B1 ships, this becomes a call on the generated client with
// contract types, and the handler and these hand-written types go.
//
// Starting a build is NOT provisional: it is today's POST
// /projects/{projectName}/build, called and refused as the console calls it
// (useBuildProject). Only the selection it carries is (buildSelection.ts).

/** A line of a feature's spec as it was built: its own ID when it has one, and its words. */
export interface BuiltLine {
  id: string | null;
  words: string;
}

export interface BuiltFeature {
  id: string;
  name: string;
  /** The feature's spec as built (model/changes.ts). */
  lines: BuiltLine[];
}

export type BuildStatus = "building" | "built" | "failed";

export interface ProjectBuild {
  /** "v1": the version's name, the tag the build cut. */
  version: string;
  status: BuildStatus;
  features: BuiltFeature[];
  /** Product-wide items it carried ("P1"). */
  productWide: string[];
  /** A repair build names the version it fixes ("v1.1" fixes "v1"); it builds the same features. */
  fixes?: string;
}

/** The provisional path MSW serves; `:projectName` is the project's slug. */
export const PROVISIONAL_BUILDS_PATH = "/api/v1/projects/:projectName/provisional/builds";

export function buildsKey(projectName: string) {
  return ["projects", projectName, "provisional-builds"] as const;
}

/** While a build runs, as often as the console polls its run rows. */
const BUILDING_POLL_MS = 5_000;

/** The project's builds, oldest first. Polls while one is building, so its end reaches the track and the chat. */
export function useBuilds(projectName: string) {
  return useQuery({
    queryKey: buildsKey(projectName),
    queryFn: async (): Promise<ProjectBuild[]> => {
      const path = PROVISIONAL_BUILDS_PATH.replace(":projectName", encodeURIComponent(projectName));
      const response = await fetch(`${env.apiBaseUrl}${path}`);
      if (!response.ok) throw new Error("Couldn't load the builds");
      return (await response.json()) as ProjectBuild[];
    },
    refetchInterval: (query) => (query.state.data?.some((b) => b.status === "building") ? BUILDING_POLL_MS : false),
  });
}

/** One unmet condition of the build gate's 422 refusal (the console's #372). */
export interface GateProblem {
  field?: string;
  message: string;
}

/** Why a build did not start: the message, and the gate's checklist when it refused one. */
export class BuildRefusedError extends Error {
  readonly problems: GateProblem[];

  constructor(message: string, problems: GateProblem[]) {
    super(message);
    this.name = "BuildRefusedError";
    this.problems = problems;
  }
}

/**
 * A failed build start, as the console reads it (useBuildProject): the
 * envelope's message, and the gate's 422 detail rows ({field, message}) so
 * the refusal renders as a checklist instead of one flattened string.
 */
export function buildRefusal(error: unknown): BuildRefusedError {
  const details = (error as { details?: unknown } | undefined)?.details;
  const problems = Array.isArray(details)
    ? details.flatMap((d: unknown): GateProblem[] => {
        const row = d as { field?: unknown; message?: unknown } | null;
        if (typeof row?.message !== "string") return [];
        return [typeof row.field === "string" ? { field: row.field, message: row.message } : { message: row.message }];
      })
    : [];
  return new BuildRefusedError(apiErrorMessage(error, "Failed to start the build"), problems);
}

/** Everything the Builds card and the track read about builds: invalidated when a build starts or ends. */
export function refreshBuilds(queryClient: QueryClient, projectName: string): void {
  void queryClient.invalidateQueries({ queryKey: buildsKey(projectName) });
  void queryClient.invalidateQueries({ queryKey: runKeys.all(projectName) });
}

/** Start a build of the selection; resolves with the version it cut ("v1"). */
export function useStartBuild(projectName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (selection: BuildSelection): Promise<string> => {
      const { data, error } = await client.POST("/projects/{projectName}/build", {
        params: { path: { projectName } },
        body: buildBody(selection),
      });
      if (error || data === undefined) throw buildRefusal(error);
      return data.tag ?? "";
    },
    onSuccess: () => refreshBuilds(queryClient, projectName),
  });
}

/**
 * Fix what failed in a version: a repair build of the same features, which
 * re-runs every scenario. Resolves with the version it cut ("v1.1").
 */
export function useStartFix(projectName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (fix: { of: string; stories: string[] }): Promise<string> => {
      const { data, error } = await client.POST("/projects/{projectName}/build", {
        params: { path: { projectName } },
        body: fixBody(fix.of, fix.stories),
      });
      if (error || data === undefined) throw buildRefusal(error);
      return data.tag ?? "";
    },
    onSuccess: () => refreshBuilds(queryClient, projectName),
  });
}
