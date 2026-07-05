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

import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "../generated/aep-api";
import { env } from "../config/env";

// The single global 401 handler (api-guidelines non-negotiable #3).
// TODO(auth): wire the re-auth flow here when auth lands; features never
// handle 401s themselves.
const auth401: Middleware = {
  onResponse({ response }) {
    if (response.status === 401) {
      console.warn("[api] 401 from BFF — re-auth flow not implemented yet");
    }
    return response;
  },
};

// The contract's paths are unprefixed; its `servers` entry is /api/v1, which
// openapi-fetch does not apply automatically — so it lives in the baseUrl.
export const client = createClient<paths>({ baseUrl: `${env.apiBaseUrl}/api/v1` });
client.use(auth401);
