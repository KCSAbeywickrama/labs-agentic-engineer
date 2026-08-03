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
 * One spec file ready for seeding. `path` is the FULL repo-relative path
 * (e.g. specs/requirements/prd.md). Doc keys, commits, the console's file
 * model, and the agents' live-peer writes all share this ONE verbatim scheme
 * — no strip/re-add anywhere. (Retires #113 decision 2's stripped room-key
 * scheme, whose only rationale was matching a historical unprefixed console
 * model; the strip-here/re-add-on-commit dance double-prefixed agent-created
 * files into specs/specs/…, so it's gone.)
 */
export interface SpecFile {
  path: string;
  content: string;
  /** Git blob sha at read time — the committer's baseSha precondition (#133). */
  sha: string;
}

/** The Files API is scoped under specs/; the spec room seeds only these. */
export const SPECS_PREFIX = "specs/";

/** One write in a commit batch: full repo path + full content + baseSha. */
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
  /** New per-file shas on success (full repo paths). */
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

/** Apply rejected for auth — the committer may pull a fresh token and retry once (D6). */
export class ApplyAuthError extends Error {
  constructor(
    readonly status: number,
    detail = "",
  ) {
    super(`apply auth failed (${status})${detail ? `: ${detail}` : ""}`);
    this.name = "ApplyAuthError";
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
          // Spec room seeds only specs/ files; the path is kept VERBATIM.
          if (!meta.path.startsWith(SPECS_PREFIX)) return [];
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
              return { path: meta.path, content: body.content, sha: body.sha };
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
          // Paths are already full repo paths (verbatim doc keys) — apply as-is.
          writes: batch.writes.map((w) => ({
            path: w.path,
            content: w.content,
            baseSha: w.baseSha,
          })),
          deletes: batch.deletes.map((d) => ({
            path: d.path,
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
          (body.conflicts ?? []).map((c) => c.path),
        );
      }
      if (res.status === 401 || res.status === 403) {
        const detail = await res.text().catch(() => "");
        throw new ApplyAuthError(res.status, detail.slice(0, 500));
      }
      if (!res.ok) {
        // Surface the BFF's error body — a bare status hides the reason a
        // batch was rejected (bad path, oversized file, precondition detail).
        const detail = await res.text().catch(() => "");
        throw new Error(
          `Failed to apply spec files for ${projectName} (${res.status})` +
            (detail ? `: ${detail.slice(0, 500)}` : ""),
        );
      }
      const body = (await res.json()) as {
        commitSha: string;
        files?: { path: string; sha: string }[] | null;
      };
      return {
        commitSha: body.commitSha,
        files: (body.files ?? []).map((f) => ({ path: f.path, sha: f.sha })),
      };
    },
  };
}
