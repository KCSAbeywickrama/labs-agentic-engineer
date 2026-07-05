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
 * Typed client for the platform-resource provisioning endpoints. The active
 * org is derived from the verified JWT server-side — no {orgHandle} path
 * segment.
 *
 * - `provision` — POST …/dependencies/{dep}/provision: authors the OC
 *   Resource model for a platform-resource dependency and marks the
 *   matching task in-flight. Async: returns as soon as the CRs are
 *   authored; readiness is polled via `getStatus`.
 * - `getStatus` — GET …/dependencies/{dep}/status: returns task status, OC
 *   binding readiness, and MASKED output names (values are NEVER surfaced).
 *
 * See aep-api/internal/feature/dependencies/resources/resources_huma.go.
 *
 * SECURITY: secret output values must never be requested, logged, or
 * rendered. The status endpoint intentionally emits name-only outputs; this
 * client does not add any mechanism to retrieve values.
 */

import { env } from '../../config/env';
import { ApiError } from './rest';

const BASE = env.VITE_CORE_API_BASE_URL;

let _getAccessToken: (() => Promise<string>) | null = null;

export function setProvisioningTokenAccessor(fn: (() => Promise<string>) | null): void {
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

// -- Request / response shapes (mirrors resources_huma.go) -------------------

export interface ProvisionDependencyBody {
  /** Provisioning parameters applied to all environments. May be omitted if
   *  the resource type requires no parameters. */
  params?: Record<string, string>;
  /** Environment names to bind the resource to (e.g. ["development"]). */
  environments: string[];
}

/** Masked output from the OC resource binding. Value is never present. */
export interface DependencyOutputName {
  name: string;
}

export interface DependencyStatusResponse {
  /** Mirrors the resource-provisioning task status (pending, building,
   *  deployed, failed, …). */
  status: string;
  /** Whether the OC binding's native Ready condition is True. */
  ready: boolean;
  /** Masked outputs — name only; secret values are never surfaced. */
  outputs: DependencyOutputName[];
}

function depPrefix(projectName: string, componentName: string, depName: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectName)}/components/${encodeURIComponent(componentName)}/dependencies/${encodeURIComponent(depName)}`;
}

export const provisioningApi = {
  /**
   * Author the OC Resource model for `depName` on `componentName` and mark
   * the matching resource-provisioning task in-flight. Returns when the CRs
   * are authored; readiness must be polled via `getStatus`.
   *
   * Route: POST …/dependencies/{depName}/provision
   * Body: { params?, environments }
   * Response: 202 { status: "provisioning" }
   */
  async provision(
    projectName: string,
    componentName: string,
    depName: string,
    body: ProvisionDependencyBody,
  ): Promise<void> {
    await fetchJSON<{ status: string }>(
      `${depPrefix(projectName, componentName, depName)}/provision`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    // 202 body contains { status: "provisioning" } — caller does not need it;
    // readiness is observed via getStatus.
  },

  /**
   * Get the provisioning status and masked outputs for `depName` on
   * `componentName`.
   *
   * Route: GET …/dependencies/{depName}/status
   * Response: { status, ready, outputs: [{ name }] }
   *
   * SECURITY: outputs are name-only (values masked at the BFF). This client
   * must not attempt to read secret values.
   */
  async getStatus(
    projectName: string,
    componentName: string,
    depName: string,
    environment?: string,
  ): Promise<DependencyStatusResponse> {
    const qs = environment ? `?environment=${encodeURIComponent(environment)}` : '';
    const data = await fetchJSON<{
      status: string;
      ready: boolean;
      outputs?: DependencyOutputName[] | null;
    }>(`${depPrefix(projectName, componentName, depName)}/status${qs}`);
    return { status: data.status, ready: data.ready, outputs: data.outputs ?? [] };
  },
};
