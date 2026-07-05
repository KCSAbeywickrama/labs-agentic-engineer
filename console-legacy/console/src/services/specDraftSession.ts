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
 * The spec draft session — the FE-owned working copy that replaced the BFF's
 * per-project working tree (§1/§5). Committed truth lives in GitHub; this module
 * owns the DRAFT: the folded stream output plus manual edits, held until an
 * explicit `files/apply` commits it.
 *
 * It is the single source of truth SHARED between the spec page (requirements /
 * design) and the chat panel: both read and mutate the same draft, and both
 * subscribe for re-render — replacing the old model where the SERVER was the
 * shared state and chat mirrored writes back through a page event bus.
 *
 * Everything here is FULL `specs/…` path space (matching the turn snapshot, the
 * fold, and the Files API). The pages own the filename ↔ full-path mapping.
 *
 * Persistence: the draft, its apply base-SHAs, and the chat conversation id
 * survive reloads in localStorage (the `requirementsDraftStorage` pattern,
 * generalised). The committed `base` content is server truth — refetched on
 * load, never persisted.
 */

import { applyFiles } from './api/files';
import type { ApplyOk, ApplyRequest } from './api/files';

export type SpecKind = 'requirements' | 'design';

export interface SpecDraftKey {
  orgId: string;
  projectId: string;
  kind: SpecKind;
}

export interface SpecDraftState {
  /** Committed HEAD content, full-path keys. In-memory only (server truth). */
  base: Record<string, string>;
  /** Committed HEAD blob sha per path — the apply `baseSha` (persisted). */
  baseShas: Record<string, string>;
  /** The working copy: base + folds + manual edits + derived (persisted). */
  draft: Record<string, string>;
  /** Chat conversation id for this session (requirements; persisted). */
  conversationId?: string;
  /** True once `base` has been synced from the server at least once. */
  loaded: boolean;
}

const SCHEMA_VERSION = 1;
const STORE_PREFIX = 'aep:spec-draft';

function storageKey(key: SpecDraftKey): string {
  return `${STORE_PREFIX}:${key.kind}:${key.orgId}:${key.projectId}`;
}

function cacheKey(key: SpecDraftKey): string {
  return `${key.kind}.${key.orgId}.${key.projectId}`;
}

interface StoredBlob {
  schemaVersion: number;
  draft: Record<string, string>;
  baseShas: Record<string, string>;
  conversationId?: string;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readBlob(key: SpecDraftKey): StoredBlob | null {
  const s = storage();
  if (!s) return null;
  const raw = s.getItem(storageKey(key));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredBlob;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeBlob(key: SpecDraftKey, state: SpecDraftState): void {
  const s = storage();
  if (!s) return;
  const blob: StoredBlob = {
    schemaVersion: SCHEMA_VERSION,
    draft: state.draft,
    baseShas: state.baseShas,
    conversationId: state.conversationId,
  };
  try {
    s.setItem(storageKey(key), JSON.stringify(blob));
  } catch {
    /* quota — drop silently, the draft is best-effort persistence */
  }
}

const cache = new Map<string, SpecDraftState>();
const listeners = new Map<string, Set<() => void>>();

function emptyState(): SpecDraftState {
  return { base: {}, baseShas: {}, draft: {}, loaded: false };
}

function load(key: SpecDraftKey): SpecDraftState {
  const ck = cacheKey(key);
  const existing = cache.get(ck);
  if (existing) return existing;
  const blob = readBlob(key);
  const state: SpecDraftState = blob
    ? { base: {}, baseShas: blob.baseShas ?? {}, draft: blob.draft ?? {}, conversationId: blob.conversationId, loaded: false }
    : emptyState();
  cache.set(ck, state);
  return state;
}

function notify(key: SpecDraftKey): void {
  listeners.get(cacheKey(key))?.forEach((fn) => fn());
}

function set(key: SpecDraftKey, next: SpecDraftState, persist = true): void {
  cache.set(cacheKey(key), next);
  if (persist) writeBlob(key, next);
  notify(key);
}

/** Current immutable session state. Cheap; safe to call in render. */
export function getSpecDraft(key: SpecDraftKey): SpecDraftState {
  return load(key);
}

export function subscribeSpecDraft(key: SpecDraftKey, listener: () => void): () => void {
  const ck = cacheKey(key);
  let set = listeners.get(ck);
  if (!set) {
    set = new Set();
    listeners.set(ck, set);
  }
  set.add(listener);
  return () => set!.delete(listener);
}

/**
 * Adopt a fresh server read as the committed base. If the session has no draft
 * yet (first load, or after a discard), the draft is initialised to the base.
 * If a persisted draft exists it is KEPT (the user's WIP) — dirtiness then shows
 * as draft-vs-base, and a stale apply base-sha surfaces later as a 409.
 */
export function syncBase(
  key: SpecDraftKey,
  server: { files: Record<string, string>; shas: Record<string, string> },
): void {
  const cur = load(key);
  const hasDraft = Object.keys(cur.draft).length > 0;
  const next: SpecDraftState = {
    base: server.files,
    baseShas: hasDraft ? cur.baseShas : server.shas,
    draft: hasDraft ? cur.draft : { ...server.files },
    conversationId: cur.conversationId,
    loaded: true,
  };
  // On a truly fresh session, align base-shas to the server we just read.
  if (!hasDraft) next.baseShas = server.shas;
  set(key, next);
}

/**
 * Re-base a conflicting draft onto the latest server read (the 409 resolution):
 * adopt the server's content and SHAs as the new base but KEEP the draft, so a
 * re-apply now passes CAS and overwrites — the simple, no-merge, last-write-wins
 * resolution. (Distinct from `syncBase`, which preserves the draft's ORIGINAL
 * base-shas so a normal reload still detects a concurrent change.)
 */
export function rebaseToServer(
  key: SpecDraftKey,
  server: { files: Record<string, string>; shas: Record<string, string> },
): void {
  const cur = load(key);
  set(key, { ...cur, base: server.files, baseShas: server.shas, loaded: true });
}

/** Replace the whole draft (a fold result or a version snapshot). */
export function setDraftFiles(key: SpecDraftKey, files: Record<string, string>): void {
  const cur = load(key);
  set(key, { ...cur, draft: { ...files } });
}

/** Manual single-file edit. */
export function patchDraftFile(key: SpecDraftKey, path: string, content: string): void {
  const cur = load(key);
  if (cur.draft[path] === content) return;
  set(key, { ...cur, draft: { ...cur.draft, [path]: content } });
}

/** Manual single-file delete (a draft mutation until apply). */
export function deleteDraftFile(key: SpecDraftKey, path: string): void {
  const cur = load(key);
  if (!(path in cur.draft)) return;
  const draft = { ...cur.draft };
  delete draft[path];
  set(key, { ...cur, draft });
}

export function getConversationId(key: SpecDraftKey): string | undefined {
  return load(key).conversationId;
}

export function setConversationId(key: SpecDraftKey, id: string): void {
  const cur = load(key);
  if (cur.conversationId === id) return;
  set(key, { ...cur, conversationId: id });
}

/** Paths whose draft content differs from committed base + paths deleted. */
export function draftDiff(key: SpecDraftKey): { changed: string[]; deleted: string[] } {
  const { base, draft } = load(key);
  const changed: string[] = [];
  for (const [path, content] of Object.entries(draft)) {
    if (base[path] !== content) changed.push(path);
  }
  const deleted = Object.keys(base).filter((p) => !(p in draft));
  return { changed, deleted };
}

/** True when the draft has any uncommitted change. */
export function hasDraftChanges(key: SpecDraftKey): boolean {
  const { changed, deleted } = draftDiff(key);
  return changed.length > 0 || deleted.length > 0;
}

/**
 * Assemble the atomic apply request from the current draft-vs-base delta. Writes
 * carry `baseSha` when the file existed at HEAD (CAS) and omit it for new files
 * (the BFF then requires absence). Deletes carry the base sha.
 */
export function buildApplyRequest(key: SpecDraftKey, message?: string): ApplyRequest {
  const state = load(key);
  const { changed, deleted } = draftDiff(key);
  const writes = changed.map((path) => {
    const baseSha = state.baseShas[path];
    return baseSha
      ? { path, content: state.draft[path]!, baseSha }
      : { path, content: state.draft[path]! };
  });
  const deletes = deleted.map((path) => {
    const baseSha = state.baseShas[path];
    return baseSha ? { path, baseSha } : { path };
  });
  return { writes, deletes, message };
}

/**
 * Fold a successful apply back into the session: the draft is now committed, so
 * base ← draft and base-shas advance to the returned per-file shas.
 */
export function commitApplied(key: SpecDraftKey, result: ApplyOk): void {
  const cur = load(key);
  const baseShas = { ...cur.baseShas };
  for (const f of result.files) baseShas[f.path] = f.sha;
  // Drop shas for paths no longer in the draft (deleted this commit).
  for (const path of Object.keys(baseShas)) {
    if (!(path in cur.draft)) delete baseShas[path];
  }
  set(key, { ...cur, base: { ...cur.draft }, baseShas });
}

/** Wipe the whole session (used after a tag/save resets the working copy). */
export function clearSpecDraft(key: SpecDraftKey): void {
  const s = storage();
  if (s) s.removeItem(storageKey(key));
  set(key, emptyState(), false);
}

/** The one banner both publish flows show after a CAS conflict re-base. */
export const PUBLISH_CONFLICT_MESSAGE =
  'Your draft was based on an older version — it has been re-based onto the latest. Review and Publish again to overwrite the conflicting files.';

export type PublishDraftOutcome =
  /** Nothing to apply — the draft already matched the committed base. */
  | { status: 'clean' }
  /**
   * The apply landed; the session base advanced (`commitApplied`). The save
   * that follows must pin `commitSha` (the just-created commit) — re-reading
   * `heads/main` server-side loses to GitHub's ref-read lag.
   */
  | { status: 'applied'; commitSha: string }
  /**
   * 409 — a stale `baseSha`; NOTHING was applied. The draft was re-based onto
   * the latest server read (best effort — a failed re-read keeps the draft
   * as-is), so a re-publish overwrites. Caller shows `PUBLISH_CONFLICT_MESSAGE`.
   */
  | { status: 'conflict' };

/**
 * Publish the draft delta: apply → on conflict re-read + re-base → on success
 * fold the apply back into the session. The shared core of both spec pages'
 * Publish flows; page-specific bits (editor flush, derived-artifact recompute,
 * the tag call, navigation) stay with the pages. Non-409 apply failures
 * (400 path/size, 404 project, 5xx) throw `ApiError` — the caller's concern.
 */
export async function publishDraft(
  projectName: string,
  key: SpecDraftKey,
  readServer: () => Promise<{ files: Record<string, string>; shas: Record<string, string> }>,
  message?: string,
): Promise<PublishDraftOutcome> {
  if (!hasDraftChanges(key)) return { status: 'clean' };
  const result = await applyFiles(projectName, buildApplyRequest(key, message));
  if (!result.ok) {
    // Conflict: nothing applied. Re-base the draft onto the latest server
    // state (keeps the user's edits) so a re-publish overwrites; no merge UI.
    try {
      rebaseToServer(key, await readServer());
    } catch {
      /* leave the draft as-is; the caller's banner tells the user */
    }
    return { status: 'conflict' };
  }
  commitApplied(key, result);
  return { status: 'applied', commitSha: result.commitSha };
}
