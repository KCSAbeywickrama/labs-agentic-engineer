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
 * Typed client for /api/v1/org/credentials/github*. The active org is derived from the
 * verified JWT server-side — no {orgHandle} path segment.
 *
 * The console's Org Settings → GitHub Integration page reads from
 * GET .../github (projection — kind, identity, status, etc.) and writes
 * via POST .../github/connect/start (App-mode, OAuth-driven) or
 * POST .../github/pat. The PAT is never echoed back; the projection
 * endpoint deliberately omits it.
 */

import { env } from '../../config/env';
import { ApiError } from './rest';

const BASE = env.VITE_CORE_API_BASE_URL;

let _getAccessToken: (() => Promise<string>) | null = null;

// Pull the token accessor from rest.ts at runtime — they share the same
// auth context. (Importing setTokenAccessor here would create a cycle;
// re-using the rest module's accessor via a small bridge is the simplest
// fix.)
export function setOrgGithubTokenAccessor(fn: (() => Promise<string>) | null): void {
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

export type ConnectionKind = 'app-installation' | 'user-pat' | '';

export interface OrgGithubProjection {
  ocOrgId: string;
  kind: ConnectionKind | 'not_connected';
  githubLogin?: string;
  identityName?: string;
  identityEmail?: string;
  identityLogin?: string;
  installationId?: number;
  selectedRepos?: string[];
  status: 'active' | 'suspended' | 'disconnected' | 'disconnecting' | 'not_connected';
  connectedAt?: string;
  lastValidatedAt?: string;
  identityChangedAt?: string;
  prevIdentityLogin?: string;
}

/**
 * Candidate install surfaced in the picker. The connect callback returns
 * candidates (filtered to user-administered, not-bound-elsewhere installs)
 * via the `?candidates=<base64>` query param when 2+ are present.
 */
export interface AppInstallationSummary {
  installationId: number;
  accountLogin: string;
  accountType: string; // "Organization" | "User"
}

export interface ConnectStartResponse {
  authorizeUrl: string;
}

// ----------------------------------------------------------------------------
// API surface
// ----------------------------------------------------------------------------

export const orgGithubApi = {
  /**
   * Read the projection for the org's GitHub connection.
   */
  async getStatus(): Promise<OrgGithubProjection> {
    const data = await fetchJSON<OrgGithubProjection>(
      `/api/v1/org/credentials/github`,
    );
    return data;
  },

  /**
   * Start the App-mode connect flow. Returns the GitHub OAuth authorize
   * URL the caller should perform a full-page redirect to. The
   * connect-state JWT (15-min TTL) carries (ocOrgId, installationId,
   * actor) through the round-trip; installationId is 0 for the initial
   * connect and non-zero when re-entering from the picker for a chosen
   * candidate.
   */
  async startConnect(installationId?: number): Promise<ConnectStartResponse> {
    const data = await fetchJSON<ConnectStartResponse | { data: ConnectStartResponse }>(
      `/api/v1/org/credentials/github/connect/start`,
      {
        method: 'POST',
        body: JSON.stringify(installationId ? { installationId } : {}),
      },
    );
    const inner = (data as { data?: ConnectStartResponse }).data ?? (data as ConnectStartResponse);
    return inner;
  },

  /**
   * Connect or replace via PAT. Surfaces field-level errors from the
   * git-service validation chain (caller maps `code` to UI placement).
   */
  async connectPAT(pat: string, githubLogin: string): Promise<OrgGithubProjection> {
    return fetchJSON<OrgGithubProjection>(
      `/api/v1/org/credentials/github/pat`,
      { method: 'POST', body: JSON.stringify({ pat, githubLogin }) },
    );
  },

  /**
   * Disconnect — runs the cascade Phases A–D synchronously, plus Phase E
   * (GitHub-side App uninstall) when uninstall is true. uninstall
   * defaults true for App-mode connections; PAT mode ignores the flag.
   */
  async disconnect(uninstall: boolean = true): Promise<void> {
    const qs = uninstall ? '' : '?uninstall=false';
    await fetchJSON<void>(
      `/api/v1/org/credentials/github${qs}`,
      { method: 'DELETE' },
    );
  },
};
