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

// Thin client for the two BFF calls this service makes. The BFF is the only
// authority: room access (validate-collab-access) and spec content
// (get-project-spec). Git, credentials, and tenancy all stay its monopoly.

export interface CollabIdentity {
  name: string;
  email: string;
}

export interface SpecFile {
  path: string;
  group: string;
  content: string;
}

export interface BffClient {
  /** Resolves to the caller's display identity, or throws on deny. */
  validateAccess(token: string, roomId: string): Promise<CollabIdentity>;
  /** Spec bundle for seeding, read as the connecting user. */
  fetchSpecBundle(token: string, projectName: string): Promise<SpecFile[]>;
}

export class BffAccessDeniedError extends Error {
  constructor(status: number) {
    super(`BFF denied collab access (${status})`);
    this.name = "BffAccessDeniedError";
  }
}

export function createBffClient(
  base: string,
  fetchImpl: typeof fetch = fetch,
): BffClient {
  return {
    async validateAccess(token, roomId) {
      const res = await fetchImpl(`${base}/collab/validate`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Room-Id": roomId,
        },
      });
      if (!res.ok) throw new BffAccessDeniedError(res.status);
      const body = (await res.json()) as CollabIdentity;
      return { name: body.name, email: body.email };
    },

    async fetchSpecBundle(token, projectName) {
      const res = await fetchImpl(
        `${base}/projects/${encodeURIComponent(projectName)}/spec`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        throw new Error(
          `Failed to fetch spec bundle for ${projectName} (${res.status})`,
        );
      }
      const body = (await res.json()) as { files: SpecFile[] };
      return body.files;
    },
  };
}
