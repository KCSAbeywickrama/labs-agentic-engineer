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

export const config = {
  model: process.env.AGENT_MODEL || "claude-sonnet-4-6",
  maxSteps: parseInt(process.env.AGENT_MAX_STEPS || "10", 10),
  logLevel: process.env.LOG_LEVEL || "info",
} as const;

// Route namespace for the agents service. Internal-only (S2S; only the BFF
// calls it, never the gateway), so it sits under /internal/v1 — the version in
// a fixed slot, matching the BFF's /api/v1 edge surface. Keep in sync with
// asdlc-service/clients/agents/client.go.
export const INTERNAL_V1 = "/internal/v1";
export const AGENTS_BASE = `${INTERNAL_V1}/agents`;
