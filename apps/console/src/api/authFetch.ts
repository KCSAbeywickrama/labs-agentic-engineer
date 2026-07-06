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

// The single global 401 handler (api-guidelines non-negotiable #3), as a
// fetch wrapper under the openapi-fetch client. Every request carries the
// session's Bearer token; a 401 means the token went stale mid-session, so:
// silent renew → retry once → if still unauthorized, full sign-in redirect
// preserving the current URL (issue #91 decision). Features never see 401s.

export interface AuthFetchDeps {
  getToken: () => Promise<string | null>;
  renewToken: () => Promise<string | null>;
  redirectToSignIn: () => void;
  fetch?: typeof globalThis.fetch;
}

function withBearer(request: Request, token: string | null): Request {
  if (!token) return request;
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return new Request(request, { headers });
}

export function createAuthFetch(deps: AuthFetchDeps): typeof globalThis.fetch {
  const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);

  return async function authFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const request = withBearer(new Request(input, init), await deps.getToken());
    // Clone before the first send — a consumed body can't be resent.
    const retryable = request.clone();

    const response = await doFetch(request);
    if (response.status !== 401) return response;

    const renewed = await deps.renewToken();
    if (!renewed) {
      deps.redirectToSignIn();
      return response;
    }

    const retried = await doFetch(withBearer(retryable, renewed));
    if (retried.status === 401) deps.redirectToSignIn();
    return retried;
  };
}
