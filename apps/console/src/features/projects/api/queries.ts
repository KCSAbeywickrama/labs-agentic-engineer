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
import type { components } from "../../../generated/aep-api";
import { client } from "../../../api/client";
import { ApiRequestError, apiErrorMessage } from "../../../api/errors";
import { useConfig } from "../../settings/api/queries";

export type Project = components["schemas"]["Project"];
type CreateProjectRequest = components["schemas"]["CreateProjectRequest"];

const projectKeys = {
  list: () => ["projects"] as const,
  detail: (projectName: string) => ["projects", projectName] as const,
};

/** The org's projects, first page: the Projects grid. */
export function useProjects() {
  return useQuery({
    queryKey: projectKeys.list(),
    queryFn: async () => {
      const { data, error } = await client.GET("/projects");
      if (error) throw new ApiRequestError(error, "Couldn't load projects");
      return data.items ?? [];
    },
  });
}

/** One project: the overview's header and the chat's breadcrumb. */
export function useProject(projectName: string) {
  return useQuery({
    queryKey: projectKeys.detail(projectName),
    queryFn: async () => {
      const { data, error } = await client.GET("/projects/{projectName}", {
        params: { path: { projectName } },
      });
      if (error) throw new ApiRequestError(error, "Couldn't load the project");
      return data;
    },
  });
}

/** What a project is called on screen: its display name, else its slug. */
export function projectLabel(project: Project): string {
  return project.displayName?.trim() || project.name;
}

/**
 * Create a project from New project. With a `prompt`, the platform persists it
 * as the project's brief and fires the `/start` kickoff itself (#562), unless
 * `referencesPending` says documents are coming, in which case the reference
 * upload fires it instead.
 */
export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateProjectRequest) => {
      const { data, error } = await client.POST("/projects", { body });
      if (error) {
        // ApiRequestError, not Error: the create flow reacts to a repo-name
        // conflict specifically (#561), and the envelope's `code` is the only
        // stable way to tell it apart from any other failure.
        throw new ApiRequestError(error, "Failed to create project");
      }
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.list(), exact: true });
    },
  });
}

/**
 * Upload the reference documents attached on New project to the project's
 * off-git reference store (ADR-0017). Deliberately not part of
 * useCreateProject: a failed upload must leave the created project intact, so
 * the details step can offer Retry upload or Continue without documents.
 */
export function useUploadReferences() {
  return useMutation({
    mutationFn: async ({ projectName, files }: { projectName: string; files: File[] }) => {
      // multipart, not base64-in-JSON: raw bytes keep the server's 5 MiB cap
      // honest, where a base64 body would inflate ~33%.
      const formData = new FormData();
      for (const file of files) formData.append("files", file);
      // openapi-fetch passes FormData through its default body serializer
      // untouched (the browser sets the boundary), but the generated request
      // type describes the JSON Schema shape, not the wire.
      const { error } = await client.POST("/projects/{projectName}/references", {
        params: { path: { projectName } },
        body: formData as unknown as { files: string[] },
      });
      if (error) {
        throw new Error(apiErrorMessage(error, "Failed to upload the reference documents"));
      }
    },
  });
}

/** The GitHub organization new repositories are created in, from the org's config. */
export function useGithubOrg(): string | null {
  const { data } = useConfig();
  return data?.gitProvider?.githubLogin ?? data?.gitProvider?.identityLogin ?? null;
}
