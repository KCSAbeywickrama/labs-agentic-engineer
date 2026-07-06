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
 * The transport-free half of the committed-truth turn client: fold one open
 * turn stream (raw SSE `StreamPart` frames replayed/tailed from
 * `GET …/turns/{id}/stream`) into a DISPLAY-ONLY snapshot, and run the
 * attach/reconnect loop over an injected connector. `turns.ts` owns
 * fetch/auth/URLs and delegates here.
 *
 * Committed truth (shared-volume-clone D13/D14/D16): the backend folds the
 * same stream server-side, verifies it against the turn manifest, and commits
 * it. The fold here exists only for live preview — the stream ends with ONE
 * terminal event (`turn-committed` / `turn-failed`) which is the authoritative
 * outcome; on `turn-committed` callers refetch the server tree. A stream that
 * ends WITHOUT a terminal event is a connection loss, not an outcome: the
 * loop reconnects with `?from=N` (bounded), and the final state comes from
 * the turn-status GET.
 *
 * Kept free of `http.ts`/`config/env.ts` imports on purpose — those read
 * `import.meta.env`, which only exists under Vite. This module runs equally in
 * the browser and in Node tests, which feed it recorded cassette streams
 * (`@aep/sse-cassette`) and synthetic connectors instead of a live fetch.
 */

import {
  FileBundle,
  applyToolCall,
  isFileMutationTool,
  parseSseStream,
  toChange,
  type Change,
  type StreamPart,
} from '@aep/agent-stream';

// ---------------------------------------------------------------------------
// Result vocabulary
// ---------------------------------------------------------------------------

/** Why the backend failed a turn (the `turn-failed` terminal event / status row). */
export type TurnFailureReason =
  | 'stream-died'
  | 'fold-parity'
  | 'base-moved'
  | 'dispatch-failed'
  | 'internal';

/** Failure codes a turn attach can resolve to. */
export type TurnErrorCode =
  | 'turn_failed' // the backend's terminal `turn-failed` event (see `reason`)
  | 'not_found' // unknown/expired turn — nothing to attach to
  | 'stream_lost' // reconnects exhausted while the turn still runs server-side
  | 'request_failed'; // any other unexpected transport condition

export interface TurnHandlers {
  /** Assistant text deltas (v7 parts carry `.text`; mock carries `.delta`). */
  onText?: (delta: string) => void;
  /** One folded mutation, projected from a `tool-result` frame. */
  onChange?: (change: Change) => void;
  /** The live folded snapshot after each applied tool-call (for live preview). */
  onSnapshot?: (files: Record<string, string>) => void;
  /** The set of paths touched so far this turn (drives busy/pending UX). */
  onBusyPaths?: (paths: Set<string>) => void;
}

export interface TurnOk {
  ok: true;
  /** The display-only folded snapshot (seed + applied ops), full-path keys.
   *  Cosmetic — the commit is the backend's manifest-verified fold; refetch
   *  the server tree for truth (a resumed attach may differ mid-replay). */
  files: Record<string, string>;
  changes: Change[];
  /** The commit the turn landed on `main` ('' when resolved via a status row
   *  that carried none). */
  commitSha: string;
  /** True when the turn completed without touching any file (chat-only). */
  noChanges: boolean;
}

export interface TurnFailure {
  ok: false;
  code: TurnErrorCode;
  message: string;
  /** Set when the backend reported a `turn-failed` reason. */
  reason?: TurnFailureReason;
  /** `base-moved`: the paths that changed under the turn (D15/D20). */
  paths?: string[];
}

export type TurnResult = TurnOk | TurnFailure;

export interface FoldOptions {
  /** Min interval between partial-preview emits (the deltas arrive per-token). */
  previewThrottleMs?: number;
}

// ---------------------------------------------------------------------------
// Start-turn error classification (pure; the POST itself lives in turns.ts)
// ---------------------------------------------------------------------------

export type StartTurnErrorCode =
  | 'turn_in_progress' // 409 — another turn is active for the project (D18)
  | 'requirements_not_approved' // 409 — design-generate with no tagged requirements (D19)
  | 'missing_org_key' // 400 — no org Anthropic key configured
  | 'not_found' // 404 — unknown project / cross-tenant conversation
  | 'upstream' // 502/503/504 — agents-service unavailable
  | 'request_failed'; // any other non-2xx

export interface StartTurnError {
  ok: false;
  code: StartTurnErrorCode;
  message: string;
  /** `turn_in_progress`: the running turn to attach to as a viewer (D18). */
  activeTurnId?: string;
}

/** Best human-readable text from a problem+json / legacy error body. */
function errorMessageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    for (const field of ['detail', 'message', 'title', 'error']) {
      if (typeof b[field] === 'string' && b[field]) return b[field] as string;
    }
  }
  return fallback;
}

/**
 * Does a 400 body message point at the missing-org-key cause? The server
 * returns 400 for several distinct reasons (no Anthropic key, invalid use
 * case, invalid conversation id, empty instruction) with a plain human message
 * and no machine code — only the missing-key one names the key, so match on it
 * rather than assuming every 400 is a missing key.
 */
function indicatesMissingOrgKey(message: string): boolean {
  return /anthropic/i.test(message) || /\bkey\b/i.test(message);
}

/**
 * Map a non-2xx create-turn response to a typed error. `body` is the parsed
 * JSON body (or undefined when it did not parse); `raw` the raw text.
 */
export function classifyStartTurnError(
  status: number,
  body: unknown,
  raw = '',
): StartTurnError {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const code = typeof b.code === 'string' ? b.code : undefined;
  const message = errorMessageFromBody(body, raw || `Turn failed (HTTP ${status}).`);
  if (code === 'turn_in_progress') {
    const err: StartTurnError = { ok: false, code: 'turn_in_progress', message };
    if (typeof b.activeTurnId === 'string' && b.activeTurnId) err.activeTurnId = b.activeTurnId;
    return err;
  }
  if (code === 'requirements_not_approved') {
    return { ok: false, code: 'requirements_not_approved', message };
  }
  switch (status) {
    case 400:
      // Only the missing-key 400 gets the "add an org key" guidance; any other
      // 400 falls through to a generic error that carries the server's own
      // message so the user sees the real reason (not a misleading key prompt).
      return indicatesMissingOrgKey(message)
        ? { ok: false, code: 'missing_org_key', message }
        : { ok: false, code: 'request_failed', message };
    case 404:
      return { ok: false, code: 'not_found', message };
    case 409:
      // 409 with no machine code ⇒ the design-generate spec-approval gate.
      return { ok: false, code: 'requirements_not_approved', message };
    case 502:
    case 503:
    case 504:
      return { ok: false, code: 'upstream', message };
    default:
      return { ok: false, code: 'request_failed', message };
  }
}

// ---------------------------------------------------------------------------
// Turn status (GET …/turns/{id} — fetched by turns.ts, consumed by the loop)
// ---------------------------------------------------------------------------

export interface TurnStatus {
  turnId: string;
  conversationId: string;
  useCase: string;
  status: 'running' | 'completed' | 'failed';
  commitSha?: string;
  reason?: TurnFailureReason;
  message?: string;
  paths?: string[];
  noChanges?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Turn-seed filter (display-fold parity with the agents-side snapshot read)
// ---------------------------------------------------------------------------

/**
 * Mirror of the agents service's `readSnapshot` keep-filter: a turn's input is
 * only `*.md`, `*.dsl` and `design.json` files (no dot-led segments, no binary
 * content). Seeding the display fold with the same subset keeps it in step
 * with the server fold — e.g. an `addFile` of `openapi.yaml` must land on a
 * bundle where the path does NOT already exist, exactly as it does server-side.
 */
export function filterTurnSeed(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    const segments = path.split('/');
    if (segments.some((s) => s.startsWith('.'))) continue;
    const base = segments[segments.length - 1] ?? '';
    const keep = path.endsWith('.md') || path.endsWith('.dsl') || base === 'design.json';
    if (!keep) continue;
    if (content.includes('\0')) continue;
    out[path] = content;
  }
  return out;
}

// ---- live partial-input preview ---------------------------------------------
//
// `addFile` carries the WHOLE file body inside its tool input, and that input
// JSON streams as `tool-input-delta` frames for the entire generation. The fold
// can only apply a COMPLETE tool call, so without peeking at the deltas a
// one-file generate (requirements.md) shows nothing until the very end. This
// section is presentation-only: it best-effort extracts `path` + the
// `content`-so-far from the partial JSON so pages can render a "typing" preview.
// The authoritative snapshot still comes exclusively from the shared fold.

/** Default min interval between partial-preview emits. */
const PREVIEW_THROTTLE_MS = 80;

/**
 * Unescape a JSON string-literal prefix (the closing quote may not have
 * arrived yet). A trailing incomplete escape (`…\` or `…\u12`) is dropped.
 */
export function unescapeJsonPrefix(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') {
      out += c;
      continue;
    }
    if (i + 1 >= s.length) break; // trailing lone backslash — incomplete escape
    const e = s[++i];
    switch (e) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case '"': out += '"'; break;
      case '\\': out += '\\'; break;
      case '/': out += '/'; break;
      case 'u': {
        const hex = s.slice(i + 1, i + 5);
        if (hex.length < 4) return out; // incomplete \uXXXX at the buffer edge
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          // Not a valid hex quad (e.g. a garbled `\u12zz` mid-stream) — leave the
          // sequence literal instead of feeding NaN to fromCharCode (which would
          // emit U+0000 garbage into the live preview).
          out += '\\u';
          continue; // i still points at 'u'; the loop resumes at the next char
        }
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
        break;
      }
      default: out += e;
    }
  }
  return out;
}

/**
 * Pull `{path, content-so-far}` out of a partial `addFile` input JSON buffer.
 * Returns null until the complete `path` string literal has arrived.
 */
export function extractAddFilePreview(buffer: string): { path: string; content: string } | null {
  const pathMatch = buffer.match(/"path"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!pathMatch) return null;
  const contentMatch = buffer.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)/);
  return {
    path: unescapeJsonPrefix(pathMatch[1]),
    content: unescapeJsonPrefix(contentMatch?.[1] ?? ''),
  };
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

/** How one attached stream leg ended. */
export type FoldEnd =
  /** The backend committed the turn — the authoritative success signal. */
  | { kind: 'committed'; commitSha: string; noChanges: boolean }
  /** The backend failed the turn — the authoritative failure signal. */
  | { kind: 'failed'; reason: TurnFailureReason; message: string; paths?: string[] }
  /**
   * The stream ended with NO terminal event: a connection loss (or a legacy
   * recording). `done` says whether the `[DONE]` sentinel arrived; a captured
   * in-band `error` frame rides along for diagnostics. Callers reconnect with
   * `?from=N` and resolve the real outcome from the turn-status GET.
   */
  | { kind: 'severed'; done: boolean; streamError?: string };

export interface FoldResult {
  end: FoldEnd;
  /** The folded display snapshot (seed + applied ops), full-path keys. */
  files: Record<string, string>;
  changes: Change[];
  /** Data frames consumed this leg — the `?from=` advance for a reconnect. */
  parts: number;
}

const KNOWN_REASONS: ReadonlySet<string> = new Set([
  'stream-died',
  'fold-parity',
  'base-moved',
  'dispatch-failed',
  'internal',
]);

function toFailureReason(value: unknown): TurnFailureReason {
  return typeof value === 'string' && KNOWN_REASONS.has(value)
    ? (value as TurnFailureReason)
    : 'internal';
}

/** Terminal-event fields (the `turn-committed` / `turn-failed` frames). */
interface TerminalPart extends StreamPart {
  commitSha?: string;
  noChanges?: boolean;
  reason?: string;
  message?: string;
  paths?: string[];
}

/**
 * Fold one open turn stream leg. `seed` is the tree the replayed parts apply
 * on top of — for a fresh attach, the server tree at the turn's base (pass it
 * through `filterTurnSeed` to match the agents-side snapshot view); for a
 * reconnect leg, the previous leg's folded `files`. Never throws for a stream
 * condition — a read error is reported as a severed end.
 */
export async function foldTurnStream(
  body: ReadableStream<Uint8Array>,
  seed: Record<string, string>,
  handlers: TurnHandlers = {},
  opts: FoldOptions = {},
): Promise<FoldResult> {
  const previewThrottleMs = opts.previewThrottleMs ?? PREVIEW_THROTTLE_MS;
  const bundle = new FileBundle(seed);
  const changes: Change[] = [];
  const touched = new Set<string>();
  let streamError: string | null = null;
  let terminal: FoldEnd | null = null;
  let parts = 0;
  // Partial addFile inputs by tool id, for the live typing preview.
  const partialInputs = new Map<string, string>();
  // Ids whose tool-input-start named a NON-previewable tool (e.g. editFile —
  // its input carries edit hunks, not the file body). Deltas for these are
  // never primed; deltas with an id we never saw a start for ARE primed
  // (some providers omit tool-input-start entirely).
  const nonPreviewIds = new Set<string>();
  let lastPreviewAt = 0;

  // Iterate manually: the generator's return value says whether the server's
  // `[DONE]` sentinel arrived ("done") or the connection died mid-turn ("eof").
  const frames = parseSseStream(body)[Symbol.asyncIterator]();
  let streamEnd: 'done' | 'eof' = 'eof';
  while (true) {
    let r: IteratorResult<StreamPart, 'done' | 'eof'>;
    try {
      r = await frames.next();
    } catch {
      // A mid-read transport fault (network drop, abort) is a severed stream —
      // the attach loop decides whether to reconnect or give up.
      break;
    }
    if (r.done) {
      streamEnd = r.value;
      break;
    }
    const part = r.value;
    parts++;
    switch (part.type) {
      case 'text-delta': {
        const text = part.text ?? part.delta ?? '';
        if (text) handlers.onText?.(text);
        break;
      }
      case 'tool-input-start': {
        if (!part.id) break;
        if (part.toolName === 'addFile') partialInputs.set(part.id, '');
        else nonPreviewIds.add(part.id);
        break;
      }
      case 'tool-input-delta': {
        const id = part.id ?? part.toolCallId;
        if (!id || nonPreviewIds.has(id) || !part.delta) break;
        // Prime on the first delta when no tool-input-start arrived for this id.
        const buffer = (partialInputs.get(id) ?? '') + part.delta;
        partialInputs.set(id, buffer);
        const now = Date.now();
        if (handlers.onSnapshot && now - lastPreviewAt >= previewThrottleMs) {
          const preview = extractAddFilePreview(buffer);
          if (preview) {
            lastPreviewAt = now;
            touched.add(preview.path);
            handlers.onSnapshot({ ...bundle.snapshot(), [preview.path]: preview.content });
            handlers.onBusyPaths?.(new Set(touched));
          }
        }
        break;
      }
      case 'tool-call': {
        if (part.toolCallId) {
          partialInputs.delete(part.toolCallId);
          nonPreviewIds.delete(part.toolCallId);
        }
        if (part.id) {
          partialInputs.delete(part.id);
          nonPreviewIds.delete(part.id);
        }
        if (isFileMutationTool(part.toolName ?? '')) {
          applyToolCall(bundle, part);
          const path = (part.input as { path?: string } | undefined)?.path;
          if (path) touched.add(path);
          lastPreviewAt = 0; // the folded snapshot is authoritative — emit now
          handlers.onSnapshot?.(bundle.snapshot());
          handlers.onBusyPaths?.(new Set(touched));
        }
        break;
      }
      case 'tool-result': {
        if (isFileMutationTool(part.toolName ?? '')) {
          const change = toChange(part);
          changes.push(change);
          handlers.onChange?.(change);
        }
        break;
      }
      case 'error': {
        // In-band agent error — the backend's terminal `turn-failed` follows;
        // keep the text for diagnostics if the stream severs before it.
        streamError =
          typeof part.error === 'string'
            ? part.error
            : part.error
              ? JSON.stringify(part.error)
              : 'The agent reported an error.';
        break;
      }
      case 'turn-committed': {
        const t = part as TerminalPart;
        terminal = {
          kind: 'committed',
          commitSha: typeof t.commitSha === 'string' ? t.commitSha : '',
          noChanges: t.noChanges === true,
        };
        break;
      }
      case 'turn-failed': {
        const t = part as TerminalPart;
        const failed: FoldEnd = {
          kind: 'failed',
          reason: toFailureReason(t.reason),
          message:
            typeof t.message === 'string' && t.message
              ? t.message
              : (streamError ?? 'The generation failed.'),
        };
        if (Array.isArray(t.paths) && t.paths.every((p) => typeof p === 'string')) {
          failed.paths = t.paths;
        }
        terminal = failed;
        break;
      }
      case 'manifest':
        // The backend does not forward manifest frames; tolerate one anyway.
        break;
      default:
        // text/finish/finish-step/tool-result-for-non-mutation — no fold action.
        break;
    }
    // The terminal event is the last data frame before [DONE] — stop folding
    // and drain the trailing sentinel so the transport closes cleanly.
    if (terminal) {
      try {
        while (!(await frames.next()).done) {
          /* nothing after the terminal event folds */
        }
      } catch {
        /* the outcome is already known */
      }
      break;
    }
  }

  // Every exit above is a `break`, so this runs on all of them — a mid-read
  // fault, a severed EOF, or the clean terminal drain. Settle the parser
  // generator and drop the underlying stream so the attach loop's reconnect
  // never leaves an abandoned reader/connection behind. Best-effort: a stream
  // already at its terminal state is a no-op, and `parseSseStream` may still
  // hold its reader lock (then `cancel` is skipped rather than throwing).
  try {
    // The completion value is discarded — the loop already resolved the outcome;
    // this only settles the generator so it stops holding the stream.
    await frames.return?.('eof');
  } catch {
    /* the generator was already settled */
  }
  if (!body.locked) {
    try {
      await body.cancel();
    } catch {
      /* the stream was already closed or errored */
    }
  }

  const files = bundle.snapshot();
  if (terminal) return { end: terminal, files, changes, parts };
  const severed: FoldEnd = { kind: 'severed', done: streamEnd === 'done' };
  if (streamError) severed.streamError = streamError;
  return { end: severed, files, changes, parts };
}

// ---------------------------------------------------------------------------
// The attach loop (transport injected — Node-testable)
// ---------------------------------------------------------------------------

/** One connection attempt's outcome, as the injected connector reports it. */
export type TurnStreamConnection =
  | { ok: true; body: ReadableStream<Uint8Array> }
  /** `notFound`: the stream 404'd pre-stream (unknown turn / expired replay
   *  buffer) — the status GET is the only remaining truth. */
  | { ok: false; notFound: boolean; message: string };

export type TurnStreamConnector = (from: number) => Promise<TurnStreamConnection>;
export type TurnStatusReader = () => Promise<TurnStatus | null>;

export interface AttachLoopOptions {
  /** Stream index to start from (0 = full replay; resume passes the offset). */
  from?: number;
  /** The fold seed for the FIRST leg (see `foldTurnStream`). */
  seed: Record<string, string>;
  handlers?: TurnHandlers;
  signal?: AbortSignal;
  /** Reconnect attempts after a severed stream before falling back to the
   *  status GET (default 3). */
  maxReconnects?: number;
  /** Base reconnect delay; grows linearly per attempt (default 500ms). */
  reconnectDelayMs?: number;
  foldOptions?: FoldOptions;
}

const STREAM_LOST_MESSAGE =
  'Lost the connection to the generation stream. The generation is still running — refresh the page to re-attach.';

function abortError(): Error {
  return new DOMException('The turn attach was aborted.', 'AbortError');
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attach to a turn stream and drive it to an authoritative outcome:
 * replay+tail → terminal event, reconnecting on connection loss with the
 * stream offset advanced past the consumed parts (`Last-Event-ID` semantics
 * via `?from=`), falling back to the turn-status GET when the stream is gone
 * or retries are exhausted. Throws only on abort (`opts.signal`).
 */
export async function runTurnAttachLoop(
  connect: TurnStreamConnector,
  readStatus: TurnStatusReader,
  opts: AttachLoopOptions,
): Promise<TurnResult> {
  const maxReconnects = opts.maxReconnects ?? 3;
  const baseDelayMs = opts.reconnectDelayMs ?? 500;
  let from = opts.from ?? 0;
  let files: Record<string, string> = { ...opts.seed };
  let changes: Change[] = [];
  let reconnects = 0;

  const throwIfAborted = (): void => {
    if (opts.signal?.aborted) throw abortError();
  };

  const resolveViaStatus = async (): Promise<TurnResult> => {
    let status: TurnStatus | null;
    try {
      status = await readStatus();
    } catch {
      throwIfAborted();
      return { ok: false, code: 'stream_lost', message: STREAM_LOST_MESSAGE };
    }
    throwIfAborted();
    if (!status) {
      return {
        ok: false,
        code: 'not_found',
        message: 'This generation is no longer available. Refresh to load the latest state.',
      };
    }
    if (status.status === 'completed') {
      return {
        ok: true,
        files,
        changes,
        commitSha: status.commitSha ?? '',
        noChanges: status.noChanges === true,
      };
    }
    if (status.status === 'failed') {
      const failure: TurnFailure = {
        ok: false,
        code: 'turn_failed',
        reason: status.reason ?? 'internal',
        message: status.message || 'The generation failed.',
      };
      if (status.paths) failure.paths = status.paths;
      return failure;
    }
    return { ok: false, code: 'stream_lost', message: STREAM_LOST_MESSAGE };
  };

  while (true) {
    throwIfAborted();
    let conn: TurnStreamConnection;
    try {
      conn = await connect(from);
    } catch (err) {
      throwIfAborted();
      conn = {
        ok: false,
        notFound: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
    if (!conn.ok) {
      // Pre-stream 404: the replay window is gone (or the turn never existed);
      // only the status row can say how the turn ended.
      if (conn.notFound || reconnects >= maxReconnects) return resolveViaStatus();
      reconnects++;
      await sleep(baseDelayMs * reconnects);
      continue;
    }
    const fold = await foldTurnStream(conn.body, files, opts.handlers, opts.foldOptions);
    throwIfAborted();
    files = fold.files;
    changes = changes.concat(fold.changes);
    if (fold.end.kind === 'committed') {
      return {
        ok: true,
        files,
        changes,
        commitSha: fold.end.commitSha,
        noChanges: fold.end.noChanges,
      };
    }
    if (fold.end.kind === 'failed') {
      const failure: TurnFailure = {
        ok: false,
        code: 'turn_failed',
        reason: fold.end.reason,
        message: fold.end.message,
      };
      if (fold.end.paths) failure.paths = fold.end.paths;
      return failure;
    }
    // Severed: reconnect past the parts this leg consumed. The fold continues
    // on its own folded files, so replayed parts are never applied twice.
    from += fold.parts;
    if (reconnects >= maxReconnects) return resolveViaStatus();
    reconnects++;
    await sleep(baseDelayMs * reconnects);
  }
}
