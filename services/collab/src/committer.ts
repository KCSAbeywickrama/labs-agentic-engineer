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

// The #86 phase-3 committer (#133): project a room's live doc into git as
// ONE bot commit per flush, through the BFF's files/apply — git stays the
// BFF's monopoly; this module only decides WHEN (Hocuspocus's debounced
// onStoreDocument + the pre-unload final store) and WHAT (doc snapshot vs
// the room baseline). Conflicts are doc-wins: refetch shas, re-apply,
// bounded retries (#86 d6).

import type { Document } from "@hocuspocus/server";
import {
  hasPendingAgentMarks,
  isMarkdownPath,
  snapshotDoc,
} from "@aep/collab-doc";
import {
  ApplyConflictError,
  type ApplyDelete,
  type ApplyWrite,
  type BffClient,
} from "./bff.js";
import { roomState, type RoomState } from "./rooms.js";
import type { CollabContext } from "./server.js";

const MAX_CONFLICT_RETRIES = 2;

interface FlushDeps {
  bff: BffClient;
  log?: ((message: string) => void) | undefined;
}

/**
 * The diff between the live doc and the room's baseline. Interim flushes
 * (`force: false`) HOLD files with pending agentInsertion marks — unreviewed
 * agent text never reaches git mid-session; the forced session-end flush
 * commits everything (accept-by-default; the serializer strips marks).
 */
export function pendingChanges(
  doc: Document,
  state: RoomState,
  force: boolean,
): { writes: ApplyWrite[]; deletes: ApplyDelete[]; held: string[] } {
  const current = snapshotDoc(doc);
  const writes: ApplyWrite[] = [];
  const deletes: ApplyDelete[] = [];
  const held: string[] = [];
  for (const [path, content] of Object.entries(current)) {
    const base = state.baseline.get(path);
    if (base && base.content === content) continue;
    // Emptied md fragments write as empty (top-level fragments cannot be
    // deleted from a Y.Doc); empty NEW files are noise — skip them.
    if (!base && content === "") continue;
    if (!force && isMarkdownPath(path) && hasPendingAgentMarks(doc, path)) {
      held.push(path);
      continue;
    }
    writes.push({ path, content, baseSha: base?.sha ?? "" });
  }
  for (const [path, base] of state.baseline) {
    if (current[path] !== undefined) continue;
    if (isMarkdownPath(path)) continue; // fragments never vanish; guard anyway
    if (base.sha === "") continue; // never reached git — nothing to delete
    deletes.push({ path, baseSha: base.sha });
  }
  return { writes, deletes, held };
}

function trailers(state: RoomState): string {
  const lines = [...state.participants.values()]
    .sort((a, b) => a.email.localeCompare(b.email))
    .map((p) => `Co-authored-by: ${p.name || p.email} <${p.email}>`);
  return lines.length > 0 ? "\n\n" + lines.join("\n") : "";
}

/**
 * Flush a room's pending changes as one commit. No-ops when clean, when the
 * room has no committer state (dev mode never registers any), or when no
 * participant token is available. Doc-wins on conflict: refresh the baseline
 * shas from HEAD and re-apply.
 */
export async function flushRoom(
  deps: FlushDeps,
  documentName: string,
  doc: Document,
  context: CollabContext | undefined,
  force = false,
): Promise<void> {
  const state = roomState(documentName);
  if (!state) return;
  const token = context?.token ?? state.lastToken;
  if (!token) {
    deps.log?.(`committer: no token for ${documentName} — skipping flush`);
    return;
  }

  for (let attempt = 0; ; attempt++) {
    const { writes, deletes, held } = pendingChanges(doc, state, force);
    if (held.length > 0) {
      deps.log?.(
        `committer: ${documentName} holding ${held.join(", ")} (pending agent review)`,
      );
    }
    if (writes.length === 0 && deletes.length === 0) return;

    try {
      const outcome = await deps.bff.applyFiles(token, state.projectName, {
        writes,
        deletes,
        message: "collab session" + trailers(state),
      });
      // Baseline moves to what we just landed.
      const newShas = new Map(outcome.files.map((f) => [f.path, f.sha]));
      for (const w of writes) {
        state.baseline.set(w.path, {
          content: w.content,
          sha: newShas.get(w.path) ?? "",
        });
      }
      for (const d of deletes) state.baseline.delete(d.path);
      deps.log?.(
        `committer: ${documentName} → ${outcome.commitSha.slice(0, 8)} ` +
          `(${writes.length} write(s), ${deletes.length} delete(s))`,
      );
      return;
    } catch (err) {
      if (err instanceof ApplyConflictError && attempt < MAX_CONFLICT_RETRIES) {
        // Someone moved git under the session: the DOC wins (#86 d6) — adopt
        // HEAD's shas as the new base and re-apply our content over it.
        deps.log?.(
          `committer: ${documentName} conflict on ${err.paths.join(", ")} — re-applying (doc wins)`,
        );
        const head = await deps.bff.fetchSpecFiles(token, state.projectName);
        for (const f of head) {
          const base = state.baseline.get(f.path);
          state.baseline.set(f.path, {
            // Keep OUR notion of content (so the diff still sees the doc's
            // version as a change), but adopt HEAD's sha as the precondition.
            content: base?.content ?? "",
            sha: f.sha,
          });
        }
        continue;
      }
      throw err;
    }
  }
}
