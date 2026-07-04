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
 * The unified turn runner — the console's single entry point to the BFF's
 * generation/chat endpoint (`POST …/conversations/{id}/turns`).
 *
 * One definition of "run a turn against the spec agent and fold the stream":
 *   1. filter the draft to agent-authored file types (never derived artifacts),
 *   2. POST the `{useCase, instruction, files, …}` body with bearer auth,
 *   3. map the BFF's pre-stream HTTP statuses to typed error codes,
 *   4. parse the raw `StreamPart` frames via the shared `@aep/agent-stream`
 *      reader (no reimplemented SSE loop), and
 *   5. FOLD the streamed tool-calls through the SAME `FileBundle`/`applyToolCall`
 *      the service uses — reproducing the server's post-turn files locally.
 *
 * The fold seed is the exact filtered snapshot we send, so the reconstruction
 * matches the server's (modulo the accepted deploy-skew risk, §3). Derived
 * artifacts are the caller's concern (see `lib/derivedArtifacts.ts`); they are
 * never sent and never folded.
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
import { API_V1, authHeaders } from './http';

export type UseCase =
  | 'requirements-generate'
  | 'requirements-chat'
  | 'design-generate';

export interface TurnBody {
  useCase: UseCase;
  instruction: string;
  /** The FE's current draft (full `specs/…` path keys). Filtered before send. */
  files?: Record<string, string>;
  /** Set when the user hand-edited the draft since the last turn (chat). */
  filesChangedExternally?: boolean;
  /** Optional hint — e.g. a target doc type. */
  target?: string;
}

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

/** A human-readable message for a pre-stream / in-band turn failure. */
export function turnErrorMessage(result: TurnFailure): string {
  switch (result.code) {
    case 'turn_in_progress':
      return 'A turn is already running for this conversation. Please wait for it to finish.';
    case 'missing_org_key':
      return 'No Anthropic API key is configured for this organization. Add one in Organization → Settings → Anthropic.';
    case 'requirements_not_approved':
      return 'Approve (publish) a requirements version before generating the design.';
    case 'too_large':
      return 'The draft is too large to process in one turn.';
    case 'upstream':
      return 'The generation service is unavailable. Please try again shortly.';
    default:
      return result.message || 'The request failed. Please try again.';
  }
}

/** Derived artifacts never enter a turn snapshot (mirrors playground `readSnapshot`). */
function isDerivedArtifact(path: string): boolean {
  return /\.excalidraw$/i.test(path) || /\.gen\.json$/i.test(path);
}

/** Keep only agent-authored files (drop derived `.excalidraw` / `*.gen.json`). */
export function filterAgentAuthored(
  files: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (!isDerivedArtifact(path)) out[path] = content;
  }
  return out;
}

/** A valid FE conversation id: uuid v4 satisfies `^[A-Za-z0-9_.-]{1,200}$`, no `--`. */
export function newConversationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for the rare no-WebCrypto environment; still matches the regex.
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** One message in the rehydrated conversation (the service's `ModelMessage`). */
export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string }>;
}

/**
 * Rehydrate a chat conversation's history (chat only). Returns `{messages}` —
 * the verbatim LLM thread (no files, correctly). Used on refresh when local
 * display history is empty. 404 (unknown/cross-tenant) resolves to empty.
 */
export async function getConversation(
  projectName: string,
  conversationId: string,
): Promise<ConversationMessage[]> {
  const res = await fetch(
    `${API_V1}/projects/${encodeURIComponent(projectName)}/conversations/${encodeURIComponent(conversationId)}`,
    { cache: 'no-store', headers: await authHeaders() },
  );
  if (!res.ok) return [];
  const data = (await res.json().catch(() => null)) as { messages?: ConversationMessage[] } | null;
  return data?.messages ?? [];
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

/** Min interval between partial-preview emits (the deltas arrive per-token). */
const PREVIEW_THROTTLE_MS = 80;

/**
 * Unescape a JSON string-literal prefix (the closing quote may not have
 * arrived yet). A trailing incomplete escape (`…\` or `…\u12`) is dropped.
 */
function unescapeJsonPrefix(s: string): string {
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
function extractAddFilePreview(buffer: string): { path: string; content: string } | null {
  const pathMatch = buffer.match(/"path"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!pathMatch) return null;
  const contentMatch = buffer.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)/);
  return {
    path: unescapeJsonPrefix(pathMatch[1]),
    content: unescapeJsonPrefix(contentMatch?.[1] ?? ''),
  };
}

function classifyPreStreamError(status: number, code: string | undefined): TurnErrorCode {
  if (code === 'turn_in_progress') return 'turn_in_progress';
  switch (status) {
    case 400:
      return 'missing_org_key';
    case 404:
      return 'not_found';
    case 409:
      // 409 with no `turn_in_progress` code ⇒ the design-generate spec-approval gate.
      return 'requirements_not_approved';
    case 413:
      return 'too_large';
    case 502:
    case 503:
    case 504:
      return 'upstream';
    default:
      return 'request_failed';
  }
}

/**
 * Run one turn end to end. Resolves to the folded files on success, or a typed
 * pre-stream / in-band failure. Never throws for an expected transport error —
 * only truly unexpected exceptions (e.g. a JSON parse fault mid-stream) bubble.
 */
export async function runTurn(
  projectName: string,
  conversationId: string,
  body: TurnBody,
  handlers: TurnHandlers = {},
  signal?: AbortSignal,
): Promise<TurnResult> {
  const seed = filterAgentAuthored(body.files ?? {});

  const res = await fetch(
    `${API_V1}/projects/${encodeURIComponent(projectName)}/conversations/${encodeURIComponent(conversationId)}/turns`,
    {
      method: 'POST',
      headers: await authHeaders({ Accept: 'text/event-stream' }),
      body: JSON.stringify({ ...body, files: seed }),
      signal,
    },
  );

  if (!res.ok || !res.body) {
    let code: string | undefined;
    let message = `Turn failed (HTTP ${res.status}).`;
    try {
      const parsed = await res.json();
      code = parsed.code;
      message = parsed.detail || parsed.message || parsed.title || parsed.error || message;
    } catch {
      /* keep default message */
    }
    return { ok: false, code: classifyPreStreamError(res.status, code), message };
  }

  const bundle = new FileBundle(seed);
  const changes: Change[] = [];
  const touched = new Set<string>();
  let streamError: string | null = null;
  let finishReason: string | null = null;
  // Partial addFile inputs by tool id, for the live typing preview.
  const partialInputs = new Map<string, string>();
  let lastPreviewAt = 0;

  for await (const part of parseSseStream(res.body) as AsyncIterable<StreamPart>) {
    switch (part.type) {
      case 'text-delta': {
        const text = part.text ?? part.delta ?? '';
        if (text) handlers.onText?.(text);
        break;
      }
      case 'tool-input-start': {
        if (part.id && part.toolName === 'addFile') partialInputs.set(part.id, '');
        break;
      }
      case 'tool-input-delta': {
        if (!part.id || !partialInputs.has(part.id) || !part.delta) break;
        const buffer = partialInputs.get(part.id)! + part.delta;
        partialInputs.set(part.id, buffer);
        const now = Date.now();
        if (handlers.onSnapshot && now - lastPreviewAt >= PREVIEW_THROTTLE_MS) {
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
        if (part.toolCallId) partialInputs.delete(part.toolCallId);
        if (part.id) partialInputs.delete(part.id);
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
  // `finishReason: "length"` means the model ran out of output tokens mid-turn.
  // If it happened inside an `addFile` whose input JSON never closed, no
  // `tool-call` frame arrived and that file is absent from the fold — salvage the
  // best-effort partial from the still-open input buffer so the user keeps what
  // streamed (they can edit/re-run) instead of the draft silently going empty.
  const truncated = finishReason === 'length';
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
