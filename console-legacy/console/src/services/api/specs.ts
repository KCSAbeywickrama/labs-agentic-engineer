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

/**
 * Typed client for the external-dependency spec-collection endpoint. When a
 * component has an `external` dependency with `needsSpec: true` and no
 * `specPath`, the user can attach an OpenAPI spec by pasting raw YAML/JSON or
 * providing a public URL. The BFF validates, stores, and commits the spec
 * then returns the relative path where it was stored. The active org is
 * derived from the verified JWT server-side — no {orgHandle} path segment.
 * See aep-api/internal/feature/dependencies/resources (spec collect).
 */

import { env } from '../../config/env';
import { ApiError } from './rest';

const BASE = env.VITE_CORE_API_BASE_URL;

let _getAccessToken: (() => Promise<string>) | null = null;

export function setSpecsTokenAccessor(fn: (() => Promise<string>) | null): void {
  _getAccessToken = fn;
}

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  };
  if (_getAccessToken) {
    const token = await _getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text();
    let message = body;
    try {
      const parsed = JSON.parse(body);
      message = parsed.detail || parsed.title || parsed.message || parsed.error || body;
    } catch {
      /* raw body */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const specsApi = {
  /**
   * Attach an OpenAPI spec to an external dependency. Supply exactly one of
   * `rawSpec` (pasted/uploaded YAML or JSON text) or `specUrl` (a publicly
   * reachable URL the BFF will fetch). On success returns the spec file
   * path (relative to the component dir).
   *
   * Throws `ApiError` on 400 (invalid spec / missing fields) or 502 (BFF
   * could not fetch the URL).
   */
  async collect(
    projectName: string,
    componentName: string,
    depName: string,
    body: { rawSpec: string } | { specUrl: string },
  ): Promise<{ specPath: string }> {
    return fetchJSON<{ specPath: string }>(
      `/api/v1/projects/${encodeURIComponent(projectName)}/components/${encodeURIComponent(componentName)}/dependencies/${encodeURIComponent(depName)}/spec`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },
};
