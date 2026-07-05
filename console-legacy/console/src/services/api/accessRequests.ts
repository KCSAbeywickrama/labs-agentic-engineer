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
 * Typed client for the cross-project access-request flow. A consumer whose
 * design references an `org-service` dependency published only at project
 * visibility (dep status `blocked`, reason `access-required`) can request that
 * the provider publish it org-wide. The request is dep-addressed — no
 * `orgServiceName` body field; the dependency name in the path already
 * identifies the provider component. It creates a publish ComponentTask +
 * GitHub issue on the provider's repo; an `AccessRequest` row tracks it. The
 * active org is derived from the verified JWT server-side — no {orgHandle}
 * path segment. See aep-api/internal/feature/dependencies/access.
 */

import { env } from '../../config/env';
import { ApiError } from './rest';
import type { AccessRequest } from './types';

const BASE = env.VITE_CORE_API_BASE_URL;

let _getAccessToken: (() => Promise<string>) | null = null;

export function setAccessRequestsTokenAccessor(fn: (() => Promise<string>) | null): void {
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

export const accessRequestsApi = {
  /**
   * Request cross-project access to an `org-service` dependency. Creates the
   * provider publish task + GitHub issue (idempotent server-side, dedups
   * onto one provider task) and returns the AccessRequest row tracking it.
   */
  async create(
    projectName: string,
    componentName: string,
    depName: string,
  ): Promise<AccessRequest> {
    return fetchJSON<AccessRequest>(
      `/api/v1/projects/${encodeURIComponent(projectName)}/components/${encodeURIComponent(componentName)}/dependencies/${encodeURIComponent(depName)}/access-request`,
      { method: 'POST' },
    );
  },

  /** List the project's cross-project access requests (consumer side). */
  async list(projectName: string): Promise<AccessRequest[]> {
    const data = await fetchJSON<AccessRequest[] | null>(
      `/api/v1/projects/${encodeURIComponent(projectName)}/dependencies/access-requests`,
    );
    return data ?? [];
  },
};
