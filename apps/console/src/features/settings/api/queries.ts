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
import { configKeys } from "./keys";
import { ApiRequestError, apiErrorMessage } from "../../../api/errors";

type ConfigProjection = components["schemas"]["ConfigProjection"];
type ConfigPatch = components["schemas"]["ConfigPatch"];
type LLMPatch = components["schemas"]["LLMPatch"];

function errorMessage(error: unknown, fallback: string): string {
  return apiErrorMessage(error, fallback);
}

// --- Org config: GitHub + the model connection --------------------------

export function useConfig() {
  return useQuery({
    queryKey: configKeys.all,
    queryFn: async () => {
      const { data, error } = await client.GET("/config");
      if (error) {
        throw new Error(errorMessage(error, "Failed to load configuration"));
      }
      return data;
    },
    staleTime: 30_000,
  });
}

// The AI agents card's one Save: sends the patch aiSettingsPatch built.
export function useSaveAiSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: ConfigPatch) => {
      const { data, error } = await client.PATCH("/config", { body: patch });
      if (error) {
        // ApiRequestError keeps `details[].field`, which names the section the
        // server refused, so the card can show it on the field it came from.
        throw new ApiRequestError(error, "Failed to save the AI settings");
      }
      return data;
    },
    onSuccess: (data: ConfigProjection) => {
      queryClient.setQueryData(configKeys.all, data);
    },
  });
}

// Test connection: probes the draft's connection without saving it. The
// result (or refusal, whose `details[].field` and `code` name the field) is the
// card's to draw; nothing is cached, since a test changes no server state.
export function useTestConnection() {
  return useMutation({
    mutationFn: async (body: LLMPatch) => {
      const { data, error } = await client.POST("/config/llm/test", { body });
      if (error) throw new ApiRequestError(error, "Failed to test the connection");
      return data;
    },
  });
}

export function useConnectGitHubPat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { pat: string; githubLogin?: string }) => {
      const { data, error } = await client.PATCH("/config", {
        body: {
          gitProvider: {
            kind: "github",
            mode: "pat",
            pat: input.pat,
            ...(input.githubLogin ? { githubLogin: input.githubLogin } : {}),
          },
        },
      });
      if (error) {
        throw new Error(errorMessage(error, "Failed to connect GitHub"));
      }
      return data;
    },
    onSuccess: (data: ConfigProjection) => {
      queryClient.setQueryData(configKeys.all, data);
    },
  });
}

// Disconnect: drops the org's GitHub connection, and with `uninstall` also
// uninstalls the GitHub App (left installed, a later connect re-adopts it).
// The config refetch then finds no connection, and onboarding takes over.
export function useDisconnectGitProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (uninstall: boolean) => {
      const { error } = await client.POST("/config/git-provider/disconnect", {
        params: { query: { uninstall } },
      });
      if (error) throw new Error(errorMessage(error, "Failed to disconnect GitHub"));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: configKeys.all });
    },
  });
}
