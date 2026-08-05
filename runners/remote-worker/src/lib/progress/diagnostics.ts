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

// What a run reads about its OWN health, off the SDK messages the feed
// translator drops.
//
// `from-sdk.ts` answers "what did the agent do". This answers "why is nothing
// happening", which the watchdog could previously only guess at: it could say
// the model turn was the slow half, never why.
//
// The why was already on the wire. The SDK emits a `system`/`api_retry` message
// for every retryable API failure, and `from-sdk.ts` discards it with every
// other unrecognised system subtype — so a run stuck behind an overload storm
// looked exactly like a run thinking hard. Measured against a dead endpoint: 8
// retries in 69s on exponential backoff (0.2s, 0.6s, 1.2s, 2.3s, 4.2s, 9.7s,
// 16.5s, 33.6s), and not one line about any of them.
//
// This is on for EVERY run, cluster included, because it costs nothing a
// healthy run pays: no retries, no messages, no lines. The `error` field is a
// closed enum (`rate_limit`, `overloaded`, `server_error`,
// `authentication_failed`, …), so unlike the SDK's stderr or its debug log
// there is no free text here to leak a prompt or a credential into a build log
// the console forwards.
//
// Note what is deliberately NOT here: the CLI's stderr. It was the obvious
// place to look for retry detail and it does not carry any — probed against the
// same dead endpoint, stderr produced one unrelated startup warning while all 8
// retries went past on the message channel. Capturing it is a developer-only
// sink (see `openDebugSinks`), not the diagnosis.

/** One retryable API failure, as the SDK reports it. */
export interface ApiRetryInfo {
  attempt: number;
  maxRetries: number;
  retryDelayMs: number;
  /** null for connection errors (timeouts, refused) that never got an HTTP response. */
  errorStatus: number | null;
  /** SDKAssistantMessageError — a closed enum, never free text. */
  error: string;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * The retry behind a message, or undefined for every other message.
 *
 * Shape-checked rather than trusted: the runner sees whatever SDK version the
 * image happens to ship, and a renamed field must degrade to "no retry
 * detail" instead of printing `retry NaN/undefined`.
 */
export function readApiRetry(message: unknown): ApiRetryInfo | undefined {
  if (!message || typeof message !== "object") return undefined;
  const m = message as Record<string, unknown>;
  if (m.type !== "system" || m.subtype !== "api_retry") return undefined;
  const status = m.error_status;
  return {
    attempt: num(m.attempt),
    maxRetries: num(m.max_retries),
    retryDelayMs: num(m.retry_delay_ms),
    errorStatus: typeof status === "number" ? status : null,
    error: typeof m.error === "string" && m.error !== "" ? m.error : "unknown",
  };
}

/**
 * The feed line for one retry.
 *
 * Every retry gets a line, not just the late ones: the count is bounded by
 * `max_retries`, and a single retry only ever happens when something IS wrong,
 * so there is no healthy run for this to add noise to. A threshold would have
 * to be tuned against an error class we do not control.
 */
export function apiRetryLine(info: ApiRetryInfo): string {
  // "no response" is the honest rendering of a null status: a refused
  // connection or a timeout never got one, and printing "HTTP 0" would invent
  // a status the API never returned.
  const where = info.errorStatus === null ? "no response" : `HTTP ${info.errorStatus}`;
  // Backoff delays are sub-minute by construction, so plain seconds reads
  // better here than the run-length format the watchdog uses.
  const next = `${Math.round(info.retryDelayMs / 1000)}s`;
  return `[api] retry ${info.attempt}/${info.maxRetries} after ${info.error} (${where}) — next attempt in ${next}`;
}

/**
 * Whether this message is a streaming token frame.
 *
 * Only present when `includePartialMessages` is on, which is a developer-only
 * option: these arrive per token and belong to neither the feed nor
 * `claude.log`. Their one job is to let the watchdog tell a long generation
 * apart from a wedged one, which is the residual fault `api_retry` does not
 * explain — no retries and no tokens is a different problem from no retries
 * and 4,000 tokens.
 */
export function isStreamFrame(message: unknown): boolean {
  return !!message && typeof message === "object" && (message as Record<string, unknown>).type === "stream_event";
}
