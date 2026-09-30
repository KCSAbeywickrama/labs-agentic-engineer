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

import type { AgentModelConnection } from "@aep/ui-agent-view";

import { FORMAT_LABELS } from "../../settings/aiSettings";

interface LlmConnection {
  kind: string;
  baseURL: string;
  model: string;
}

/** The slice of the `/config` query this reads. */
export interface ConfigRead {
  isPending: boolean;
  isError: boolean;
  data: { llm: LlmConnection | null } | undefined;
}

/**
 * The Agent spec's Model panel, from the org's model connection in Settings:
 * every agent runs on that connection, so it is the model to show, and the
 * AFM's `model:` block only holds the `${env:}` placeholders the deploy fills
 * from it. `undefined` (a failed read) leaves the panel out rather than
 * claiming no model is connected.
 */
export function agentModelConnection(
  config: ConfigRead,
): AgentModelConnection | null | "loading" | undefined {
  if (config.isPending) return "loading";
  if (config.isError || !config.data) return undefined;
  const llm = config.data.llm;
  if (!llm) return null;
  return {
    model: llm.model,
    format: FORMAT_LABELS[llm.kind as keyof typeof FORMAT_LABELS]?.label ?? llm.kind,
    host: hostOf(llm.baseURL),
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
