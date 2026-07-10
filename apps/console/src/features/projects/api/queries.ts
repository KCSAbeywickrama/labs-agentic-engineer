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
import { useConfig } from "../../settings/api/queries";
import { projectKeys } from "./keys";

type CreateProjectRequest = components["schemas"]["CreateProjectRequest"];

export function useProjectsList(search = "", limit?: number) {
  return useInfiniteQuery({
    queryKey: projectKeys.list(search, limit),
    queryFn: async ({ pageParam }) => {
      const { data, error } = await client.GET("/projects", {
        params: {
          query: {
            ...(search && { search }),
            ...(pageParam && { cursor: pageParam }),
            ...(limit && { limit }),
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

// Spec-view reads still poll at a flat interval (tags below).
const OVERVIEW_POLL_MS = 10_000;

// Status polling is adaptive (#183): fast while any stage is moving, slow
// when settled — idle polling stays on because spec pushes happen on GitHub
// and must flip the v1+ chip without a reload.
const STATUS_ACTIVE_POLL_MS = 5_000;
const STATUS_IDLE_POLL_MS = 30_000;

type ProjectStatus = components["schemas"]["ProjectStatus"];

function statusIsMoving(status: ProjectStatus): boolean {
  return (
    status.build.status === "running" ||
    status.deploy.status === "deploying" ||
    status.repoStatus === "pending" ||
    status.repoStatus === "cloning"
  );
}

function useProjectResource<T>(
  queryKey: readonly unknown[],
  fetcher: () => Promise<{ data?: T; error?: unknown }>,
  what: string,
  refetchInterval?: number | ((data: T | undefined) => number | false),
) {
  return useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await fetcher();
      if (error || data === undefined) {
        const e = error as { detail?: string; title?: string } | undefined;
        throw new Error(e?.detail ?? e?.title ?? `Failed to load ${what}`);
      }
      return data;
    },
    ...(refetchInterval !== undefined && {
      refetchInterval:
        typeof refetchInterval === "function"
          ? (query: { state: { data: T | undefined } }) =>
              refetchInterval(query.state.data)
          : refetchInterval,
    }),
  });
}

// The page's only poller (#183): the whole pipeline renders from this one
// aggregate (ADR-0006), so nothing else on the overview needs an interval.
export function useProjectStatus(projectName: string) {
  return useProjectResource(
    projectKeys.status(projectName),
    () =>
      client.GET("/projects/{projectName}/status", {
        params: { path: { projectName } },
      }),
    "project status",
    (status) =>
      !status || statusIsMoving(status)
        ? STATUS_ACTIVE_POLL_MS
        : STATUS_IDLE_POLL_MS,
  );
}

// No standing interval (#183): the overview refetches this when the status
// poll shows a build/deploy transition (components only change then).
export function useProjectComponents(projectName: string) {
  return useProjectResource(
    projectKeys.components(projectName),
    () =>
      client.GET("/projects/{projectName}/components", {
        params: { path: { projectName } },
      }),
    "components",
  );
}

// Spec version tags (#117). The BE hasn't implemented /tags yet, so a failed
// read degrades to "no tags" instead of an error card — the version chips
// simply don't render until the endpoint lands.
export function useProjectTags(projectName: string) {
  return useQuery({
    queryKey: projectKeys.tags(projectName),
    queryFn: async () => {
      const { data, error } = await client.GET("/projects/{projectName}/tags", {
        params: { path: { projectName } },
      });
      if (error || data === undefined) return null;
      return data;
    },
    refetchInterval: OVERVIEW_POLL_MS,
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

// Delete a project (#107). The BFF cascade destroys the OC project, its
// deployments, and the GitHub repo; the confirm dialog owns the warning.
// Invalidates every list page so the card leaves the grid on success.
export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (projectName: string) => {
      const { error } = await client.DELETE("/projects/{projectName}", {
        params: { path: { projectName } },
      });
      if (error) {
        throw new Error(
          error.detail ?? error.title ?? "Failed to delete project",
        );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

// Trigger a project build (#162): the single-tag flow — the BFF validates,
// tags v<N>, and runs the dev workflow, returning the tag. The Spec view
// commits the room first (collab flush-on-demand) so this tags the current
// HEAD. Invalidates the project's reads since status/tasks/tags shift once the
// build starts.
export function useBuildProject(projectName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await client.POST("/projects/{projectName}/build", {
        params: { path: { projectName } },
        body: {},
      });
      if (error || data === undefined) {
        const e = error as { detail?: string; title?: string } | undefined;
        throw new Error(e?.detail ?? e?.title ?? "Failed to start the build");
      }
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: projectKeys.detail(projectName),
      });
    },
  });
}

// The connected GitHub org, for the repo-URL preview in the create flow.
// GitHub connection state now lives on the org config (issue #96 moved it
// off the old /org/credentials/github onto GET /config's gitProvider
// section), so this rides the settings feature's shared useConfig query
// instead of a second, independent fetch of the same endpoint. gitProvider
// is nullable (not connected yet), hence the optional chaining.
export function useGithubOrg() {
  const { data } = useConfig();
  return {
    data: data?.gitProvider?.githubLogin ?? data?.gitProvider?.identityLogin ?? null,
  };
}
