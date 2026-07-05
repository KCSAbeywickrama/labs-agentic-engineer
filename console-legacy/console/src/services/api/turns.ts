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
 *   4. hand the raw SSE body to the transport-free fold (`turnStream.ts`),
 *      which parses `StreamPart` frames and folds tool-calls through the SAME
 *      `FileBundle`/`applyToolCall` the service uses — reproducing the
 *      server's post-turn files locally.
 *
 * The fold seed is the exact filtered snapshot we send, so the reconstruction
 * matches the server's (modulo the accepted deploy-skew risk, §3). Derived
 * artifacts are the caller's concern (see `lib/derivedArtifacts.ts`); they are
 * never sent and never folded.
 */

import { API_V1, authHeaders, parseErrorEnvelope } from './http';
import { foldTurnStream, type TurnErrorCode, type TurnFailure, type TurnHandlers, type TurnResult } from './turnStream';

export type {
  TurnErrorCode,
  TurnFailure,
  TurnHandlers,
  TurnOk,
  TurnResult,
} from './turnStream';

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
    const { code, message } = await parseErrorEnvelope(res);
    return {
      ok: false,
      code: classifyPreStreamError(res.status, code),
      message: message || `Turn failed (HTTP ${res.status}).`,
    };
  }

  return foldTurnStream(res.body, seed, handlers);
}
