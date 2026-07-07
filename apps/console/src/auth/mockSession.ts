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

// The mock-auth identity for default dev (VITE_API_MODE=mock): a fixed
// user and org, no Thunder required. The org matches the collab mock
// BFF's default so spec rooms resolve the same way in both places.

export const MOCK_USER = {
  name: "Developer",
  email: "developer@example.com",
  role: "Developer",
} as const;

export const MOCK_ORG = "acme";

// JWT-shaped but unsigned — enough for the collab mock BFF, which decodes
// name/email claims without verifying. Never sent to a real BFF: real API
// runs use thunder auth mode.
export function mockAccessToken(): string {
  const b64 = (v: unknown) =>
    btoa(JSON.stringify(v))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
  return `${b64({ alg: "none" })}.${b64({
    name: MOCK_USER.name,
    email: MOCK_USER.email,
    ouHandle: MOCK_ORG,
  })}.dev`;
}
