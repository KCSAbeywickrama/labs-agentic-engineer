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

// Client for the org's IDP profile, exposed as the `idp` section of the
// consolidated GET/PATCH /api/v1/config resource plus its discovery + client-
// secret action routes (docs/design/org-config-consolidation.md). Org derived
// from the verified JWT. Backs the Org Settings → IDP Integration page.
//
// This wrapper preserves its public surface (getProfile/updateProfile/
// discoverIssuer/rotateSecret returning OrgIDPProfile) so the page is
// unchanged; internally it reads/writes the `idp` section of /config. Unlike
// the legacy PUT (empty-means-keep), PATCH /config replaces the section
// wholesale — the page already round-trips all three fields, so this is
// transparent. The idp section is always present (platform default), so the
// legacy kind=null "no profile yet" state no longer occurs.

import { env } from '../../config/env';
import { ApiError } from './rest';

const BASE = env.VITE_CORE_API_BASE_URL;

let _getAccessToken: (() => Promise<string>) | null = null;

export function setOrgIDPTokenAccessor(fn: (() => Promise<string>) | null): void {
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
  return (await res.json()) as T;
}

export interface OrgIDPProfile {
  orgId?: string;
  kind?: 'platform' | 'asgardeo' | 'custom' | null;
  issuer?: string;
  jwksUrl?: string;
  publisherClientId?: string;
  hasClientSecret?: boolean;
  // Legacy "no profile yet" field — the /config idp section is always present
  // (platform default), so this is no longer populated.
  message?: string;
}

export interface RotateSecretResponse {
  clientSecret: string;
}

export interface UpdateProfileRequest {
  kind?: 'platform' | 'asgardeo' | 'custom';
  issuer?: string;
  jwksUrl?: string;
}

export interface DiscoverIssuerResponse {
  issuer: string;
  jwksUrl: string;
}

// The `idp` section of GET/PATCH /config (always present).
interface ConfigIDPSection {
  kind: 'platform' | 'asgardeo' | 'custom';
  issuer: string;
  jwksUrl: string;
  publisherClientId: string;
  hasClientSecret: boolean;
}

interface ConfigProjection {
  idp: ConfigIDPSection;
}

function profileFromIDP(idp: ConfigIDPSection): OrgIDPProfile {
  return {
    kind: idp.kind,
    issuer: idp.issuer,
    jwksUrl: idp.jwksUrl,
    publisherClientId: idp.publisherClientId,
    hasClientSecret: idp.hasClientSecret,
  };
}

export const orgIDPApi = {
  /** Read the org's IDP profile (the `idp` section of /config, always present). */
  async getProfile(): Promise<OrgIDPProfile> {
    const config = await fetchJSON<ConfigProjection>(`/api/v1/config`);
    return profileFromIDP(config.idp);
  },

  /** Update kind / issuer / jwksUrl via PATCH /config {idp}. The section is
   * replaced wholesale (kind=platform restores the cluster defaults). Switching
   * kind invalidates the publisher app — next protected-component reconcile
   * provisions a fresh one in the new IDP. */
  async updateProfile(req: UpdateProfileRequest): Promise<OrgIDPProfile> {
    const config = await fetchJSON<ConfigProjection>(`/api/v1/config`, {
      method: 'PATCH',
      body: JSON.stringify({ idp: { kind: req.kind, issuer: req.issuer, jwksUrl: req.jwksUrl } }),
    });
    return profileFromIDP(config.idp);
  },

  /** OIDC discovery helper — given an issuer URL, returns the JWKS URL
   * from /.well-known/openid-configuration. Used by the BYO-IDP form
   * to auto-populate the JWKS URL field. */
  async discoverIssuer(issuer: string): Promise<DiscoverIssuerResponse> {
    return fetchJSON<DiscoverIssuerResponse>(
      `/api/v1/config/idp/discovery?issuer=${encodeURIComponent(issuer)}`,
    );
  },

  /** Rotate the publisher client secret via POST /config/idp/client-secret.
   * Returns the new secret — the caller surfaces it once (subsequent GETs only
   * show has-secret state). */
  async rotateSecret(): Promise<RotateSecretResponse> {
    return fetchJSON<RotateSecretResponse>(
      `/api/v1/config/idp/client-secret`,
      { method: 'POST' },
    );
  },
};
