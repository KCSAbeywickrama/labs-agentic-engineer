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
 * The generic `specs/`-scoped Files API (BFF `internal/feature/files`).
 *
 * Committed-truth backed: reads at HEAD are the COMPLETE truth (no client
 * draft, no overlay) and carry per-file blob SHAs that double as an apply's
 * `baseSha`; the single `apply` endpoint commits a batch of manual edits to
 * `main` atomically (all-or-nothing, CAS on every `baseSha` — one commit per
 * save, D13). Generation commits happen SERVER-side from the verified stream
 * fold; this client only commits what the user edits by hand.
 *
 * Paths are always full `specs/…` keys (the page-level filename ↔ full-path
 * mapping lives with the pages, not here).
 */

import { API_V1, authHeaders, toApiError } from './http';

/** One entry from the file list — path + blob sha + byte size at HEAD. */
export interface FileMeta {
  path: string;
  sha: string;
  size: number;
}

/** A single file read: content plus the sha to carry as its draft `baseSha`. */
export interface FileContent {
  path: string;
  content: string;
  sha: string;
}

/** A write in an apply request. Omit `baseSha` to require the file be absent. */
export interface ApplyWrite {
  path: string;
  content: string;
  baseSha?: string;
}

/** A delete in an apply request. `baseSha` guards against deleting stale content. */
export interface ApplyDelete {
  path: string;
  baseSha?: string;
}

export interface ApplyRequest {
  writes?: ApplyWrite[];
  deletes?: ApplyDelete[];
  message?: string;
}

export interface ApplyWarning {
  path: string;
  code: string;
  message: string;
}

export interface FileConflict {
  path: string;
  baseSha: string;
  currentSha: string;
}

/** 200 — the commit landed; every file carries its new sha. */
export interface ApplyOk {
  ok: true;
  commitSha: string;
  files: FileMeta[];
  warnings: ApplyWarning[];
}

/** 409 — a stale `baseSha`; NOTHING was applied. Refetch and re-base. */
export interface ApplyConflict {
  ok: false;
  conflicts: FileConflict[];
}

export type ApplyResult = ApplyOk | ApplyConflict;

function filesBase(projectName: string): string {
  return `${API_V1}/projects/${encodeURIComponent(projectName)}/files`;
}

/** List `specs/…` files at HEAD under an optional prefix (path + sha + size). */
export async function listFiles(
  projectName: string,
  prefix?: string,
): Promise<FileMeta[]> {
  const q = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
  const res = await fetch(`${filesBase(projectName)}${q}`, {
    cache: 'no-store',
    headers: await authHeaders(),
  });
  if (!res.ok) throw await toApiError(res);
  const data = (await res.json()) as FileMeta[] | null;
  return data ?? [];
}

/** Read one `specs/…` file at HEAD: `{path, content, sha}` (sha = baseSha). */
export async function readFile(
  projectName: string,
  path: string,
): Promise<FileContent> {
  // The BFF route is `files/{path...}`; encode each segment but keep slashes.
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${filesBase(projectName)}/${encoded}`, {
    cache: 'no-store',
    headers: await authHeaders(),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as FileContent;
}

/**
 * Read every file under a prefix as a `{fullPath: content}` map plus a
 * `{fullPath: sha}` map — the shape a page needs to seed a draft (content)
 * and to later apply it (baseSha). Two round-trips: one list (for the sha
 * set) and one content read per file.
 */
export async function readTree(
  projectName: string,
  prefix: string,
): Promise<{ files: Record<string, string>; shas: Record<string, string> }> {
  const metas = await listFiles(projectName, prefix);
  const contents = await Promise.all(metas.map((m) => readFile(projectName, m.path)));
  const files: Record<string, string> = {};
  const shas: Record<string, string> = {};
  for (const c of contents) {
    files[c.path] = c.content;
    shas[c.path] = c.sha;
  }
  return { files, shas };
}

/**
 * The one write: atomically commit a draft to `main`. Resolves to `ApplyOk`
 * on 200, `ApplyConflict` on 409 (nothing applied — caller re-bases). Any
 * other non-2xx throws `ApiError` (400 path/size, 404 project, 5xx).
 */
export async function applyFiles(
  projectName: string,
  req: ApplyRequest,
): Promise<ApplyResult> {
  const res = await fetch(`${filesBase(projectName)}/apply`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(req),
  });
  if (res.ok) {
    // The wire body is {commitSha, files, warnings?} — the `ok` discriminant
    // exists only client-side and MUST be set here, never assumed via cast.
    const body = (await res.json()) as Omit<ApplyOk, 'ok' | 'warnings'> & {
      warnings?: ApplyWarning[];
    };
    return { ok: true, commitSha: body.commitSha, files: body.files, warnings: body.warnings ?? [] };
  }
  if (res.status === 409) {
    // Conflict envelope: nothing applied. Return it typed rather than throwing
    // so the caller can drive the refresh/re-base affordance.
    const body = (await res.json().catch(() => null)) as { conflicts?: FileConflict[] } | null;
    if (body && Array.isArray(body.conflicts)) {
      return { ok: false, conflicts: body.conflicts };
    }
  }
  throw await toApiError(res);
}
