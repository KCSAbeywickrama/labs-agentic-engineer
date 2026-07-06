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

export interface CollabConfig {
  port: number;
  /** BFF origin incl. API prefix, e.g. http://localhost:9090/api/v1. */
  aepApiBase: string | null;
  /** Skip the BFF oracle and seed rooms from fixtures. Never in cluster. */
  devMode: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CollabConfig {
  const aepApiBase = env.AEP_API_BASE?.replace(/\/$/, "") ?? null;
  const devFlag = env.COLLAB_DEV === "1" || env.COLLAB_DEV === "true";
  // Without a BFF there is no oracle or seed source — dev mode is the only
  // way to run, so imply it rather than refusing to start (`make dev`
  // ergonomics; the console's mock mode has the same spirit).
  const devMode = devFlag || aepApiBase === null;
  return {
    port: Number(env.COLLAB_PORT ?? 8091),
    aepApiBase,
    devMode,
  };
}
