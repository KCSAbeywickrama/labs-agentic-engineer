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

export type AuthMode = "mock" | "thunder";

// Issue #91 dev-mode matrix: production always signs in against Thunder;
// in dev the default follows the API mode (mock APIs → mock auth, nothing
// to run), and VITE_AUTH_MODE=thunder opts into real OIDC against the
// dev-thunder-setup container while MSW keeps serving the APIs.
export function resolveAuthMode(
  isDev: boolean,
  apiMode: string | undefined,
  override: string | undefined,
): AuthMode {
  if (!isDev) return "thunder";
  if (override === "thunder" || override === "mock") return override;
  return apiMode === "mock" ? "mock" : "thunder";
}
