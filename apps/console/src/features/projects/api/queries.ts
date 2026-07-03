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

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { components } from "../../../generated/aep-api";
import { client } from "../../../api/client";
import { githubKeys, projectKeys } from "./keys";

type CreateProjectRequest = components["schemas"]["CreateProjectRequest"];

export function useProjectsList(search = "") {
  return useInfiniteQuery({
    queryKey: projectKeys.list(search),
    queryFn: async ({ pageParam }) => {
      const { data, error } = await client.GET("/projects", {
        params: {
          query: {
            ...(search && { search }),
            ...(pageParam && { cursor: pageParam }),
          },
        },
      });
      if (error) {
        throw new Error(error.detail ?? error.title ?? "Failed to load projects");
      }
      return data;
    },
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? null,
    // Keep the previous result visible while a new search resolves — no
    // flicker between keystrokes.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useProject(projectName: string) {
  return useQuery({
    queryKey: projectKeys.detail(projectName),
    queryFn: async () => {
      const { data, error } = await client.GET("/projects/{projectName}", {
        params: { path: { projectName } },
      });
      if (error) {
        throw new Error(error.detail ?? error.title ?? "Failed to load project");
      }
      return data;
    },
    staleTime: 30_000,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateProjectRequest) => {
      const { data, error } = await client.POST("/projects", { body });
      if (error) {
        throw new Error(
          error.detail ?? error.title ?? "Failed to create project",
        );
      }
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

// The connected GitHub org, for the repo-URL preview in the create flow.
// get-github-status is untyped in the contract (issue #72 asks the BFF to
// firm this up), so the org is read defensively from the likely fields.
export function useGithubOrg() {
  return useQuery({
    queryKey: githubKeys.status,
    queryFn: async () => {
      const { data, error } = await client.GET("/org/credentials/github");
      if (error || !data) return null;
      const status = data as Record<string, unknown>;
      const org = status.org ?? status.owner ?? status.login;
      return typeof org === "string" && org ? org : null;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}
