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

// The declared plan (#576, ADR-0022): what the turn said it is ABOUT to write,
// reconciled against what it actually writes. runTurn folds `declare_plan`
// tool-calls and file mutations into this store; the spec rail subscribes for
// its checklist and count, and SpecView for follow-the-write (ADR-0023).
// Lives next to chatStore so runTurn does not import the spec feature.
//
// Every status is DERIVED from the stream, never self-reported by the agent:
// `writing` when the file's mutation starts, `done` when it completes, `error`
// only for the entry being written when the turn died. A clean turn's plan
// dissolves — the files are simply there; a dead turn's wreckage (done ticks,
// the error, the remaining ghosts) persists until the next declaring turn
// replaces it, because the wreckage IS the case for updating the design.

import { DECLARE_PLAN_TOOL } from "@aep/agent-stream";

export type PlanEntryStatus = "planned" | "writing" | "done" | "error";

export interface PlanEntry {
  /** Full repo-relative spec-bundle path — the reconciliation identity. */
  path: string;
  status: PlanEntryStatus;
}

export interface PlanSnapshot {
  /** The declaring turn. A different turn declaring replaces the snapshot. */
  turnId: string;
  /** The UNION of every declaration in the turn, first-seen order. */
  entries: PlanEntry[];
  /**
   * The path an agent write is currently streaming — tracked for EVERY file
   * mutation, declared or not, because follow-the-write (ADR-0023) steers by
   * it and a turn without a plan still writes.
   */
  writingPath: string | null;
  /** False once the turn reached a terminal. */
  turnActive: boolean;
  /** The turn died leaving undone entries — the rail keeps the residue. */
  wreckage: boolean;
}

const plans = new Map<string, PlanSnapshot>();
const listeners = new Map<string, Set<() => void>>();

function notify(chatKey: string): void {
  for (const fn of listeners.get(chatKey) ?? []) fn();
}

// Every write REPLACES the snapshot (and its entries array) rather than
// mutating it: `useSyncExternalStore` compares snapshots by identity, so an
// in-place mutation renders only when something ELSE happens to re-render the
// subscriber — the exact staleness this store exists to prevent.
function commit(chatKey: string, next: PlanSnapshot): void {
  plans.set(chatKey, next);
  notify(chatKey);
}

function fresh(turnId: string): PlanSnapshot {
  return { turnId, entries: [], writingPath: null, turnActive: true, wreckage: false };
}

/**
 * The base the fold builds THIS turn's next snapshot from. Any event from a
 * turn other than the snapshot's starts fresh — a new turn's first plan or
 * first write is what wipes a previous turn's wreckage.
 */
function forTurn(chatKey: string, turnId: string): PlanSnapshot {
  const cur = plans.get(chatKey);
  if (cur && cur.turnId === turnId) return cur;
  return fresh(turnId);
}

/**
 * Parse a `declare_plan` tool-call input (which may arrive as a JSON string —
 * same tolerance as the register-draft fold). Returns the ordered path list,
 * or null when the shape is not a plan at all.
 */
export function parseDeclarePlan(input: unknown): string[] | null {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const paths = (value as { paths?: unknown }).paths;
  if (!Array.isArray(paths)) return null;
  return paths
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Fold one declaration: union-append, restated paths ignored, no removal —
 * the only rule robust to an agent restating its whole plan. Returns how many
 * entries were genuinely new (the chat activity row says "N artifacts").
 */
export function planDeclared(chatKey: string, turnId: string, paths: string[]): number {
  const plan = forTurn(chatKey, turnId);
  const known = new Set(plan.entries.map((e) => e.path));
  const fresh: PlanEntry[] = [];
  for (const path of paths) {
    if (known.has(path)) continue;
    known.add(path);
    fresh.push({ path, status: "planned" });
  }
  if (fresh.length > 0) {
    commit(chatKey, { ...plan, entries: [...plan.entries, ...fresh] });
  } else if (plans.get(chatKey) !== plan) {
    commit(chatKey, plan); // a new turn restated an old plan — still replaces it
  }
  return fresh.length;
}

/** A file mutation's input stream opened and resolved its path. */
export function planFileWriting(chatKey: string, turnId: string, path: string): void {
  const plan = forTurn(chatKey, turnId);
  commit(chatKey, {
    ...plan,
    writingPath: path,
    entries: plan.entries.map((e) =>
      e.path === path && e.status !== "done" ? { ...e, status: "writing" } : e,
    ),
  });
}

/** That mutation's input stream closed — the body is complete. */
export function planFileDone(chatKey: string, turnId: string, path: string): void {
  const plan = plans.get(chatKey);
  if (!plan || plan.turnId !== turnId) return;
  commit(chatKey, {
    ...plan,
    writingPath: plan.writingPath === path ? null : plan.writingPath,
    entries: plan.entries.map((e) => (e.path === path ? { ...e, status: "done" } : e)),
  });
}

/**
 * The turn reached a terminal. Clean → the plan dissolves (the files are
 * simply there). Failed → the entry being written becomes the error, the rest
 * stay ghosts, and the residue persists until the next declaring turn.
 */
export function planTurnEnded(
  chatKey: string,
  turnId: string,
  status: "completed" | "failed",
): void {
  const plan = plans.get(chatKey);
  if (!plan || plan.turnId !== turnId) return;
  if (status === "completed") {
    plans.delete(chatKey);
    notify(chatKey);
    return;
  }
  const entries = plan.entries.map((e) =>
    e.status === "writing" ? { ...e, status: "error" as const } : e,
  );
  const wreckage = entries.some((e) => e.status !== "done");
  if (!wreckage) {
    plans.delete(chatKey);
    notify(chatKey);
    return;
  }
  commit(chatKey, { ...plan, entries, writingPath: null, turnActive: false, wreckage });
}

export function peekPlan(chatKey: string): PlanSnapshot | null {
  return plans.get(chatKey) ?? null;
}

export function subscribePlan(chatKey: string, fn: () => void): () => void {
  const set = listeners.get(chatKey) ?? new Set();
  set.add(fn);
  listeners.set(chatKey, set);
  return () => set.delete(fn);
}

/** Drop any plan for this key — tests drain the module-scoped map. */
export function clearPlan(chatKey: string): void {
  if (!plans.has(chatKey)) return;
  plans.delete(chatKey);
  notify(chatKey);
}

// --- Rehydrate (decision 6: reconstructed the way question cards are) --------

interface HistoryPart {
  type?: string;
  toolName?: string;
  input?: unknown;
}

/**
 * Rebuild the residue from the replayed transcript, so wreckage survives a
 * reload for as long as the conversation log does — the same durability the
 * question cards have.
 *
 * The LAST assistant message carrying a `declare_plan` call is the record of
 * the last declaring turn: its declarations union into the plan, its file
 * mutations mark entries done. A record whose plan completed projects to no
 * snapshot at all (the plan dissolved), so only a turn that died short leaves
 * anything here. Skipped entirely while a live fold owns the store — history
 * REPLACES the log around the very moments a turn is running, and the stream
 * is the fresher truth.
 */
export function rehydratePlanFromHistory(
  chatKey: string,
  history: Array<{ role: string; content: unknown }>,
): void {
  const current = plans.get(chatKey);
  if (current?.turnActive) return;

  let record: HistoryPart[] | null = null;
  for (const message of history) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const parts = message.content.filter(
      (p): p is HistoryPart => typeof p === "object" && p !== null,
    );
    if (parts.some((p) => p.type === "tool-call" && p.toolName === DECLARE_PLAN_TOOL)) {
      record = parts;
    }
  }
  if (!record) {
    if (current) {
      plans.delete(chatKey);
      notify(chatKey);
    }
    return;
  }

  const entries: PlanEntry[] = [];
  const known = new Set<string>();
  for (const part of record) {
    if (part.type !== "tool-call") continue;
    if (part.toolName === DECLARE_PLAN_TOOL) {
      for (const path of parseDeclarePlan(part.input) ?? []) {
        if (known.has(path)) continue;
        known.add(path);
        entries.push({ path, status: "planned" });
      }
    } else if (part.toolName === "addFile" || part.toolName === "editFile") {
      const path = (part.input as { path?: unknown } | null | undefined)?.path;
      const entry =
        typeof path === "string" ? entries.find((e) => e.path === path) : undefined;
      if (entry) entry.status = "done";
    }
  }

  const wreckage = entries.some((e) => e.status !== "done");
  if (!wreckage) {
    if (current) {
      plans.delete(chatKey);
      notify(chatKey);
    }
    return;
  }
  plans.set(chatKey, {
    turnId: "history",
    entries,
    writingPath: null,
    turnActive: false,
    wreckage: true,
  });
  notify(chatKey);
}
