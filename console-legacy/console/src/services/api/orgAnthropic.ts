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
 * Typed client for the org's LLM connection, exposed as the `llm` section of the
 * consolidated GET/PATCH /api/v1/config resource (docs/design/org-config-consolidation.md).
 * The active org is derived from the verified JWT server-side — no {orgHandle}
 * path segment.
 *
 * This wrapper preserves its original public surface (getStatus/connect/disconnect
 * returning OrgAnthropicProjection) so the Org Settings → Anthropic page is
 * unchanged; internally it reads/writes the `llm` section of /config. A null
 * `llm` section maps back to the {status:"not_connected"} shape the UI expects.
 *
 * The raw key is never echoed back; the projection deliberately omits it.
 *
 * See docs/design/anthropic-key-dual-token.md.
 */

import { env } from '../../config/env';
import { ApiError } from './rest';

const BASE = env.VITE_CORE_API_BASE_URL;

let _getAccessToken: (() => Promise<string>) | null = null;

export function setOrgAnthropicTokenAccessor(fn: (() => Promise<string>) | null): void {
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
    let code: string | undefined;
    try {
      const parsed = JSON.parse(body);
      if (parsed.message) message = parsed.message;
      if (parsed.error) message = parsed.error;
      // RFC-9457 problem (the /config surface): prefer the section-pointed
      // errors[] message, else the top-level detail.
      if (parsed.detail) message = parsed.detail;
      if (parsed.errors?.[0]?.message) message = parsed.errors[0].message;
      if (parsed.code) code = parsed.code;
    } catch {
      /* use raw body */
    }
    const err = new ApiError(res.status, message);
    (err as ApiError & { code?: string }).code = code;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type AnthropicStatus = 'active' | 'invalid' | 'disconnected' | 'not_connected';

export interface OrgAnthropicProjection {
  status: AnthropicStatus;
  keyPrefix?: string;
  keyLast4?: string;
  connectedAt?: string;
  lastValidatedAt?: string;
  validationError?: string;
}

// The `llm` section of GET/PATCH /config (null = not connected).
interface ConfigLLMSection {
  kind: string;
  keyPrefix?: string;
  keyLast4?: string;
  status: AnthropicStatus;
  connectedAt?: string;
  lastValidatedAt?: string;
  validationError?: string;
}

interface ConfigProjection {
  llm: ConfigLLMSection | null;
}

function projectionFromLLM(llm: ConfigLLMSection | null): OrgAnthropicProjection {
  if (!llm) return { status: 'not_connected' };
  return {
    status: llm.status,
    keyPrefix: llm.keyPrefix,
    keyLast4: llm.keyLast4,
    connectedAt: llm.connectedAt,
    lastValidatedAt: llm.lastValidatedAt,
    validationError: llm.validationError,
  };
}

// ----------------------------------------------------------------------------
// API surface
// ----------------------------------------------------------------------------

export const orgAnthropicApi = {
  /**
   * Read the org's LLM connection projection. Returns {status:"not_connected"}
   * (no key fields) when the `llm` section of /config is null.
   */
  async getStatus(): Promise<OrgAnthropicProjection> {
    const config = await fetchJSON<ConfigProjection>(`/api/v1/config`);
    return projectionFromLLM(config.llm);
  },

  /**
   * Connect or replace the org's Anthropic API key via PATCH /config {llm}. The
   * validation chain runs server-side; a probe failure is a 422 pointing at
   * body.llm, surfaced on ApiError.message.
   */
  async connect(apiKey: string): Promise<OrgAnthropicProjection> {
    const config = await fetchJSON<ConfigProjection>(`/api/v1/config`, {
      method: 'PATCH',
      body: JSON.stringify({ llm: { kind: 'anthropic', apiKey } }),
    });
    return projectionFromLLM(config.llm);
  },

  /**
   * Disconnect via PATCH /config {llm:null} — removes the encrypted key bytes
   * from org_secrets, the metadata row, and the per-org WP Secret. In-flight
   * WorkflowRuns are NOT cancelled.
   */
  async disconnect(): Promise<void> {
    await fetchJSON<ConfigProjection>(`/api/v1/config`, {
      method: 'PATCH',
      body: JSON.stringify({ llm: null }),
    });
  },
};
