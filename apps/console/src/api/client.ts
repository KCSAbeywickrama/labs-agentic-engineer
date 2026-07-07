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

import createClient from "openapi-fetch";
import type { paths } from "../generated/aep-api";
import { env } from "../config/env";
import { getAccessToken, redirectToSignIn, renewAccessToken } from "../auth/token";
import { createAuthFetch } from "./authFetch";

// Token attach + the single global 401 handler live in the fetch wrapper
// (see authFetch.ts); features never handle auth themselves.
//
// The contract's paths are unprefixed; its `servers` entry is /api/v1, which
// openapi-fetch does not apply automatically — so it lives in the baseUrl.
export const client = createClient<paths>({
  baseUrl: `${env.apiBaseUrl}/api/v1`,
  fetch: createAuthFetch({
    getToken: getAccessToken,
    renewToken: renewAccessToken,
    redirectToSignIn,
  }),
});
