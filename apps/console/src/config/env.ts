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

interface RuntimeEnv {
  VITE_API_BASE_URL?: string;
}

declare global {
  interface Window {
    _env_?: RuntimeEnv;
  }
}

// Runtime config (window._env_, served as /env-config.js by the hosting
// layer) takes precedence over build-time env, then a dev-proxy default.
function getEnv(key: keyof RuntimeEnv): string | undefined {
  if (typeof window !== "undefined" && window._env_) {
    const runtimeValue = window._env_[key];
    if (runtimeValue !== undefined && runtimeValue !== "") {
      return runtimeValue;
    }
  }
  return import.meta.env[key];
}

export const env = {
  apiBaseUrl: getEnv("VITE_API_BASE_URL") || "/aep-api-service",
} as const;
