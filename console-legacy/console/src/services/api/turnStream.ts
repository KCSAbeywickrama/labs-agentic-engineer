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
 * The transport-free half of the turn runner: fold one already-open turn
 * stream (the raw SSE `StreamPart` body) into a `TurnResult`. `runTurn`
 * (turns.ts) owns fetch/auth/pre-stream status mapping and delegates here.
 *
 * Kept free of `http.ts`/`config/env.ts` imports on purpose — those read
 * `import.meta.env`, which only exists under Vite. This module runs equally in
 * the browser and in Node tests, which feed it recorded cassette streams
 * (`@aep/sse-cassette`) instead of a live fetch body.
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

/** Pre-stream failure codes mapped from the BFF's HTTP statuses. */
export type TurnErrorCode =
  | 'turn_in_progress' // 409 — a turn is already running for this conversation
  | 'missing_org_key' // 400 — no org Anthropic key configured
  | 'requirements_not_approved' // 409 — design-generate with no tagged requirements
  | 'not_found' // 404 — unknown project / cross-tenant conversation
  | 'too_large' // 413 — body over the limit
  | 'upstream' // 502 — upstream agents-service error
  | 'request_failed' // any other non-2xx
  | 'stream_error'; // an in-band `error` frame (status was already 200)

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
  /** The folded agent-authored snapshot (seed + applied ops), full-path keys. */
  files: Record<string, string>;
  changes: Change[];
  /**
   * The turn ran out of output tokens mid-generation (`finishReason: "length"`).
   * The last tool-call never closed, so `files` may carry a best-effort partial
   * of the truncated file instead of a fully-folded one — callers should keep the
   * content but warn the user the generation was cut off.
   */
  truncated?: boolean;
}

export interface TurnFailure {
  ok: false;
  code: TurnErrorCode;
  message: string;
}

export type TurnResult = TurnOk | TurnFailure;

export interface FoldOptions {
  /** Min interval between partial-preview emits (the deltas arrive per-token). */
  previewThrottleMs?: number;
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

/**
 * Fold one open turn stream into the final files. `seed` must be the exact
 * filtered snapshot that was sent with the request — the reconstruction then
 * matches the server's. Resolves to the folded files, or an in-band
 * `stream_error` failure; never throws for an expected stream condition.
 */
export async function foldTurnStream(
  body: ReadableStream<Uint8Array>,
  seed: Record<string, string>,
  handlers: TurnHandlers = {},
  opts: FoldOptions = {},
): Promise<TurnResult> {
  const previewThrottleMs = opts.previewThrottleMs ?? PREVIEW_THROTTLE_MS;
  const bundle = new FileBundle(seed);
  const changes: Change[] = [];
  const touched = new Set<string>();
  let streamError: string | null = null;
  let finishReason: string | null = null;
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
    const r = await frames.next();
    if (r.done) {
      streamEnd = r.value;
      break;
    }
    const part = r.value as StreamPart;
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
      case 'finish': {
        // The whole-turn terminator carries the reason the model stopped.
        if (part.finishReason) finishReason = part.finishReason;
        break;
      }
      case 'error': {
        streamError =
          typeof part.error === 'string'
            ? part.error
            : part.error
              ? JSON.stringify(part.error)
              : 'The agent reported an error.';
        break;
      }
      default:
        // text/finish-step/tool-result-for-non-mutation — no fold action.
        break;
    }
  }

  if (streamError) {
    return { ok: false, code: 'stream_error', message: streamError };
  }

  const files = bundle.snapshot();
  // Two ways a turn ends incomplete:
  //   - `finishReason: "length"` — the model ran out of output tokens mid-turn;
  //   - `streamEnd: "eof"` with no `finish` frame — the connection died before
  //     the server's `[DONE]` (network drop, upstream failure the BFF couldn't
  //     relay). Before this check, a dropped stream looked like a clean success.
  // In either case the last `addFile` input JSON may never have closed, so no
  // `tool-call` frame arrived and that file is absent from the fold — salvage the
  // best-effort partial from the still-open input buffer so the user keeps what
  // streamed (they can edit/re-run) instead of the draft silently going empty.
  const truncated = finishReason === 'length' || (streamEnd === 'eof' && finishReason === null);
  if (truncated) {
    for (const buffer of partialInputs.values()) {
      const preview = extractAddFilePreview(buffer);
      if (preview && files[preview.path] === undefined) {
        files[preview.path] = preview.content;
      }
    }
    return { ok: true, files, changes, truncated: true };
  }
  return { ok: true, files, changes };
}
