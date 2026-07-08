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

// Thin client for the BFF calls this service makes. The BFF is the only
// authority: room access (validate-collab-access) and spec content (the
// Files API, #114). Git, credentials, and tenancy all stay its monopoly.

export interface CollabIdentity {
  name: string;
  email: string;
  /**
   * Project resolved from the room ID by the oracle — only the BFF can split
   * `spec-<org>-<project>` (it knows the caller's org).
   */
  projectName: string;
}

/**
 * One spec file ready for seeding. `path` is the ROOM KEY — the repo path
 * with the `specs/` prefix stripped (e.g. requirements/prd.md), matching what
 * the console looks up (#113 decision 2). The strip happens here, at the
 * Files API boundary, and nowhere else.
 */
export interface SpecFile {
  path: string;
  content: string;
  /** Git blob sha at read time — the committer's baseSha precondition (#133). */
  sha: string;
}

/** The Files API serves repo-relative paths; rooms key by the remainder. */
export const SPECS_PREFIX = "specs/";

export function toRoomPath(repoPath: string): string | null {
  return repoPath.startsWith(SPECS_PREFIX)
    ? repoPath.slice(SPECS_PREFIX.length)
    : null;
}

/** One write in a commit batch: room-keyed path + full content + baseSha. */
export interface ApplyWrite {
  path: string;
  content: string;
  /** Blob sha this write supersedes; "" = the file must not exist yet. */
  baseSha: string;
}

export interface ApplyDelete {
  path: string;
  baseSha: string;
}

export interface ApplyOutcome {
  /** New per-file shas on success (room-keyed paths). */
  files: { path: string; sha: string }[];
  commitSha: string;
}

/** A stale-baseSha rejection: nothing was applied (#133 doc-wins retry). */
export class ApplyConflictError extends Error {
  constructor(readonly paths: string[]) {
    super(`apply conflict on: ${paths.join(", ")}`);
    this.name = "ApplyConflictError";
  }
}

export interface BffClient {
  /** Resolves to the caller's display identity, or throws on deny. */
  validateAccess(token: string, roomId: string): Promise<CollabIdentity>;
  /** Spec files for seeding, read via the Files API as the connecting user. */
  fetchSpecFiles(token: string, projectName: string): Promise<SpecFile[]>;
  /**
   * Land a batch as ONE bot commit via the Files API's apply (#133): the
   * committer's tier-2. Throws ApplyConflictError on stale baseShas.
   */
  applyFiles(
    token: string,
    projectName: string,
    batch: { writes: ApplyWrite[]; deletes: ApplyDelete[]; message: string },
  ): Promise<ApplyOutcome>;
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
      return {
        name: body.name,
        email: body.email,
        projectName: body.projectName,
      };
    },

    async fetchSpecFiles(token, projectName) {
      const project = encodeURIComponent(projectName);
      const headers = { Authorization: `Bearer ${token}` };

      const listRes = await fetchImpl(`${base}/projects/${project}/files`, {
        headers,
      });
      if (!listRes.ok) {
        throw new Error(
          `Failed to list spec files for ${projectName} (${listRes.status})`,
        );
      }
      const metas = ((await listRes.json()) ?? []) as { path: string }[];

      return Promise.all(
        metas.flatMap((meta) => {
          const roomPath = toRoomPath(meta.path);
          if (roomPath === null) return [];
          const encoded = meta.path
            .split("/")
            .map(encodeURIComponent)
            .join("/");
          return [
            (async (): Promise<SpecFile> => {
              const res = await fetchImpl(
                `${base}/projects/${project}/files/${encoded}`,
                { headers },
              );
              if (!res.ok) {
                throw new Error(
                  `Failed to read ${meta.path} for ${projectName} (${res.status})`,
                );
              }
              const body = (await res.json()) as { content: string; sha: string };
              return { path: roomPath, content: body.content, sha: body.sha };
            })(),
          ];
        }),
      );
    },

    async applyFiles(token, projectName, batch) {
      const project = encodeURIComponent(projectName);
      const res = await fetchImpl(`${base}/projects/${project}/files/apply`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          writes: batch.writes.map((w) => ({
            path: SPECS_PREFIX + w.path,
            content: w.content,
            baseSha: w.baseSha,
          })),
          deletes: batch.deletes.map((d) => ({
            path: SPECS_PREFIX + d.path,
            baseSha: d.baseSha,
          })),
          message: batch.message,
        }),
      });
      if (res.status === 409) {
        const body = (await res.json()) as {
          conflicts?: { path: string }[];
        };
        throw new ApplyConflictError(
          (body.conflicts ?? []).map((c) => toRoomPath(c.path) ?? c.path),
        );
      }
      if (!res.ok) {
        throw new Error(
          `Failed to apply spec files for ${projectName} (${res.status})`,
        );
      }
      const body = (await res.json()) as {
        commitSha: string;
        files?: { path: string; sha: string }[] | null;
      };
      return {
        commitSha: body.commitSha,
        files: (body.files ?? []).flatMap((f) => {
          const roomPath = toRoomPath(f.path);
          return roomPath === null ? [] : [{ path: roomPath, sha: f.sha }];
        }),
      };
    },
  };
}
