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
 * Shared HTTP primitives for the newer feature services (files + turns).
 * `restApi` keeps its own `fetchJSON`; these helpers exist so the
 * files/turns modules attach the same bearer auth and parse the same two
 * error envelopes without duplicating that logic or bloating `rest.ts`.
 */

import { env } from '../../config/env';
import { ApiError, getToken } from './rest';

export const API_BASE = env.VITE_CORE_API_BASE_URL;
export const API_V1 = `${API_BASE}/api/v1`;

/** Content-Type + bearer token, matching `rest.ts`'s request headers. */
export async function authHeaders(
  extra?: Record<string, string>,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  };
  const token = await getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Turn a non-2xx response into an `ApiError` with the most human-readable
 * message available. Mirrors `rest.ts`'s dual-envelope handling: RFC 9457
 * problem+json (Huma routes) and the legacy `{error,message}` envelope.
 */
export async function toApiError(res: Response): Promise<ApiError> {
  const body = await res.text().catch(() => '');
  let message = body;
  try {
    const parsed = JSON.parse(body);
    message = parsed.detail || parsed.message || parsed.title || parsed.error || body;
    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      const details = parsed.errors
        .map((e: { message?: string; location?: string }) =>
          e.location ? `${e.location}: ${e.message ?? ''}` : e.message,
        )
        .filter(Boolean)
        .join('; ');
      if (details) message = message ? `${message} (${details})` : details;
    }
  } catch {
    /* use raw body */
  }
  return new ApiError(res.status, message);
}
