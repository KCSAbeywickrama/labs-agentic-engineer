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
 * Typed client for /api/v1/dependencies/external-resources* (org level) and
 * /api/v1/projects/{p}/dependencies/external-resources/{name}/values
 * (project level). The active org is derived from the verified JWT
 * server-side — no {orgHandle} path segment.
 *
 * Saving an external resource's per-environment values provisions the
 * OpenChoreo Resource model for it in the project and completes the gating
 * config-collection task (the BFF cascade then dispatches the dependent
 * component tasks). See
 * aep-api/internal/feature/dependencies/resources/resources_huma.go.
 */

import { env } from '../../config/env';
import { ApiError } from './rest';
import type { ExternalResource } from './types';

const BASE = env.VITE_CORE_API_BASE_URL;

let _getAccessToken: (() => Promise<string>) | null = null;

export function setExternalResourcesTokenAccessor(fn: (() => Promise<string>) | null): void {
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

/** Per-environment key→value map; `development` is required locally. */
export type ExternalResourceEnvironments = Record<string, Record<string, string>>;

export const externalResourcesApi = {
  /** List the org's registered external resources with their consuming components. */
  async list(): Promise<ExternalResource[]> {
    const data = await fetchJSON<{ externalResources?: ExternalResource[] }>(
      `/api/v1/dependencies/external-resources`,
    );
    return data.externalResources ?? [];
  },

  /**
   * Delete a registered external resource. The server returns 409 (thrown as
   * ApiError) when any component still uses it.
   */
  async delete(name: string): Promise<void> {
    await fetchJSON<void>(
      `/api/v1/dependencies/external-resources/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    );
  },

  /**
   * Save an external resource's per-environment values and provision it.
   * Values are split into plain/secret by the resource's registered schema
   * server-side — the caller supplies plain text for both. Project-scoped:
   * values are shared by every component in the project using `name`.
   */
  async saveValues(
    projectName: string,
    name: string,
    environments: ExternalResourceEnvironments,
  ): Promise<void> {
    await fetchJSON<{ status: string }>(
      `/api/v1/projects/${encodeURIComponent(projectName)}/dependencies/external-resources/${encodeURIComponent(name)}/values`,
      { method: 'POST', body: JSON.stringify({ environments }) },
    );
  },
};
