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
 * Typed client for the org's git-provider connection, exposed as the
 * `gitProvider` section of the consolidated GET/PATCH /api/v1/config resource
 * plus its App-mode connect/disconnect action routes
 * (docs/design/org-config-consolidation.md). The active org is derived from the
 * verified JWT server-side — no {orgHandle} path segment.
 *
 * This wrapper preserves its original public surface (getStatus/startConnect/
 * connectPAT/disconnect returning OrgGithubProjection) so the Org Settings →
 * GitHub page and the connect components are unchanged; internally it maps the
 * `gitProvider` section (kind=github + mode=pat|app) back to the legacy
 * kind=user-pat|app-installation shape. The PAT is never echoed back.
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

export type ConnectionKind = 'app-installation' | 'user-pat' | '';

export interface OrgGithubProjection {
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

// The `gitProvider` section of GET/PATCH /config (null = not connected). The
// role-named kind=github + mode=pat|app is mapped back to the legacy kind for
// the UI (which branches on 'app-installation' vs 'user-pat').
interface ConfigGitProviderSection {
  kind: string; // "github"
  mode: 'app' | 'pat';
  githubLogin?: string;
  identityName?: string;
  identityEmail?: string;
  identityLogin?: string;
  installationId?: number;
  selectedRepos?: string[];
  status: OrgGithubProjection['status'];
  connectedAt?: string;
  lastValidatedAt?: string;
  identityChangedAt?: string;
  prevIdentityLogin?: string;
}

interface ConfigProjection {
  gitProvider: ConfigGitProviderSection | null;
}

function projectionFromGitProvider(gp: ConfigGitProviderSection | null): OrgGithubProjection {
  if (!gp) return { kind: 'not_connected', status: 'not_connected' };
  return {
    kind: gp.mode === 'app' ? 'app-installation' : 'user-pat',
    githubLogin: gp.githubLogin,
    identityName: gp.identityName,
    identityEmail: gp.identityEmail,
    identityLogin: gp.identityLogin,
    installationId: gp.installationId,
    selectedRepos: gp.selectedRepos,
    status: gp.status,
    connectedAt: gp.connectedAt,
    lastValidatedAt: gp.lastValidatedAt,
    identityChangedAt: gp.identityChangedAt,
    prevIdentityLogin: gp.prevIdentityLogin,
  };
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
   * Read the projection for the org's GitHub connection (the `gitProvider`
   * section of /config, mapped back to the legacy projection shape).
   */
  async getStatus(): Promise<OrgGithubProjection> {
    const config = await fetchJSON<ConfigProjection>(`/api/v1/config`);
    return projectionFromGitProvider(config.gitProvider);
  },

  /**
   * Start the App-mode connect flow via the connect-sessions action route.
   * Returns the GitHub OAuth authorize URL the caller should perform a
   * full-page redirect to. The connect-state JWT (15-min TTL) carries
   * (ocOrgId, installationId, actor) through the round-trip; installationId is
   * 0 for the initial connect and non-zero when re-entering from the picker.
   */
  async startConnect(installationId?: number): Promise<ConnectStartResponse> {
    return fetchJSON<ConnectStartResponse>(
      `/api/v1/config/git-provider/connect-sessions`,
      {
        method: 'POST',
        body: JSON.stringify(installationId ? { installationId } : {}),
      },
    );
  },

  /**
   * Connect or replace via PAT through PATCH /config {gitProvider}. Surfaces
   * field-level errors from the git-service validation chain as a 422 pointing
   * at body.gitProvider.
   */
  async connectPAT(pat: string, githubLogin: string): Promise<OrgGithubProjection> {
    const config = await fetchJSON<ConfigProjection>(`/api/v1/config`, {
      method: 'PATCH',
      body: JSON.stringify({ gitProvider: { kind: 'github', mode: 'pat', pat, githubLogin } }),
    });
    return projectionFromGitProvider(config.gitProvider);
  },

  /**
   * Disconnect via the disconnect action route — runs the cascade Phases A–D
   * synchronously, plus Phase E (GitHub-side App uninstall) when uninstall is
   * true. uninstall defaults true for App-mode connections; PAT mode ignores
   * the flag.
   */
  async disconnect(uninstall: boolean = true): Promise<void> {
    const qs = uninstall ? '' : '?uninstall=false';
    await fetchJSON<{ status: string }>(
      `/api/v1/config/git-provider/disconnect${qs}`,
      { method: 'POST', body: '{}' },
    );
  },
};
