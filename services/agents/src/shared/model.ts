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
 * Model seam — the single provider-aware module. Everything that needs an LLM
 * goes through `createModel`, so the rest of the code consumes a
 * provider-agnostic `LanguageModel` and never imports a provider SDK directly.
 * A turn's model is described by a `ModelConnection` (format, base URL, auth
 * scheme, key, model id) and `createModel` switches on its `format`, so a new
 * format is one new branch here — no call-site changes. Only the Anthropic
 * format exists today.
 *
 * The key and the model id both arrive per turn (the `X-Anthropic-Key` header
 * and the turn body's `model`); `config.model` (`AGENT_MODEL`) is only the
 * default for a caller that sends no model. Every provider request goes out
 * through `guardedFetch`, which refuses a host that resolves to a non-public
 * address.
 */

import type { LanguageModel } from "ai";
import { anthropic, createAnthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import type { ProviderOptions } from "../agents/main/run-turn.js";
import { config } from "./config.js";
import { guardedFetch } from "./guarded-fetch.js";

/** The wire format a connection speaks. Only the Anthropic format exists today. */
export type ModelFormat = "anthropic";

/** How the key is sent: Anthropic's `x-api-key` header, or `Authorization: Bearer`. */
export type AuthScheme = "x-api-key" | "bearer";

/** The resolved connection a turn's model is built from. */
export interface ModelConnection {
  format: ModelFormat;
  /** Provider base URL, e.g. `https://api.anthropic.com/v1`. */
  baseURL: string;
  authScheme: AuthScheme;
  /** Provider API key. */
  apiKey: string;
  /** Model id. */
  model: string;
}

/** Anthropic's own API, the only connection the platform serves today. */
const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";

/**
 * A connection's identity for history replay, `format@host`: stored parts a
 * provider can replay (signed reasoning, provider-executed tool calls) are
 * tied to the format and the host that produced them. Stamped on each turn's
 * journal entry and compared by `historyFor`.
 */
export function connectionFingerprint(conn: Pick<ModelConnection, "format" | "baseURL">): string {
  return `${conn.format}@${new URL(conn.baseURL).host}`;
}

/** The fingerprint of today's connection (`anthropicConnection`), for a turn built without one. */
export const DEFAULT_CONNECTION_FINGERPRINT = connectionFingerprint({ format: "anthropic", baseURL: ANTHROPIC_BASE_URL });

/**
 * Today's connection: `model` on Anthropic's API with the key as `x-api-key`.
 * An absent model resolves to the service default (`resolveModelId`).
 */
export function anthropicConnection(apiKey: string, model?: string): ModelConnection {
  return {
    format: "anthropic",
    baseURL: ANTHROPIC_BASE_URL,
    authScheme: "x-api-key",
    apiKey,
    model: resolveModelId(model !== undefined ? { model } : {}),
  };
}

/**
 * The model ids a turn may name: the contract's `AgentModel` enum, the set the
 * platform can price (pinned against the contract by test/model.test.ts). A
 * turn naming none runs on `AGENT_MODEL`, the operator's default, which this
 * list does not bind.
 */
export const OFFERED_MODELS: readonly string[] = ["claude-sonnet-5", "claude-haiku-4-5"];

/** Whether a turn may name `modelId`. */
export function isOfferedModel(modelId: string): boolean {
  return OFFERED_MODELS.includes(modelId);
}

/**
 * The model id `createModel` resolves for `cfg`. Exported so the composition
 * root can thread the SAME id it instantiates into the turn (usage attribution
 * on the terminal manifest, #249) instead of re-deriving the default elsewhere.
 */
export function resolveModelId(cfg: { model?: string } = {}): string {
  return cfg.model ?? config.model;
}

/** Per-call overrides of how `createModel` reaches the provider. */
interface CreateModelOptions {
  /**
   * The fetch provider requests go out through. Defaults to `guardedFetch`;
   * tests and cassette replays pass a recorder or reach a local server the
   * guard would refuse.
   */
  fetch?: typeof globalThis.fetch;
}

/**
 * Build a Vercel AI SDK `LanguageModel` from a connection. This is the ONLY
 * function that knows which provider SDK to instantiate.
 */
export function createModel(conn: ModelConnection, options: CreateModelOptions = {}): LanguageModel {
  const auth = conn.authScheme === "bearer" ? { authToken: conn.apiKey } : { apiKey: conn.apiKey };
  const provider = createAnthropic({
    baseURL: conn.baseURL,
    ...auth,
    fetch: options.fetch ?? guardedFetch,
  });
  // Trace capture is NOT wrapped around the model: a capturing object's
  // lifetime became the trace's run identity, and this object is rebuilt every
  // turn (the key is per-request), which split one conversation across N runs.
  // Capture registers once at the composition root and is stamped per turn —
  // see shared/telemetry.ts.
  return provider(conn.model);
}

/**
 * Models that reject Anthropic's `effort` parameter. `@ai-sdk/anthropic`
 * forwards `effort` as `output_config.effort` without checking the model, and
 * the API answers a 400 on these rather than ignoring it, so the option is
 * omitted for them. Every other offered model (Sonnet 5, Opus 4.5 and later)
 * takes it.
 */
const MODELS_WITHOUT_EFFORT = ["claude-haiku-4-5", "claude-sonnet-4-5"] as const;

/** Whether `modelId` accepts the `effort` option. Prefix match covers dated ids. */
export function supportsEffort(modelId: string): boolean {
  return !MODELS_WITHOUT_EFFORT.some((prefix) => modelId.startsWith(prefix));
}

/**
 * Provider-specific per-call options for the turn's model, built here so the
 * reasoning-effort knob (like the provider SDK itself) stays inside this seam.
 * The generic turn loop passes the returned object through untouched. A model
 * that rejects `effort` gets no options at all, so its request carries no
 * `output_config`.
 */
export function modelProviderOptions(modelId: string): ProviderOptions | undefined {
  if (!supportsEffort(modelId)) return undefined;
  return {
    anthropic: { effort: config.reasoningEffort } satisfies AnthropicLanguageModelOptions,
  };
}

/**
 * The provider-specific PROMPT-CACHE breakpoint, or undefined when caching is
 * off. Lives in this seam for the same reason `modelProviderOptions` does: the
 * marker is Anthropic's (`cacheControl`), and the turn loop stays
 * provider-agnostic by passing whatever this returns through opaquely.
 *
 * Anthropic caches the prompt prefix UP TO AND INCLUDING the marked block, so a
 * caller marks the last stable block rather than every block — the API allows
 * only a handful of breakpoints, and marking history messages individually
 * would exhaust them as a conversation grows.
 */
export function modelCacheBreakpoint(): ProviderOptions | undefined {
  if (!config.promptCache) return undefined;
  return { anthropic: { cacheControl: { type: "ephemeral" } } };
}

/**
 * True iff `model` is served by the Anthropic provider (`provider` starts with
 * "anthropic") — gates the provider-executed `web_search` tool (external-
 * dependency-discovery #252), which is Anthropic-specific: injecting it
 * against another provider would error, so a mismatch degrades silently to no
 * web_search tool instead. `createModel` is Anthropic-only today, so this is
 * always true in production; the check keeps the call site correct if a
 * second provider is ever added.
 */
export function isAnthropicModel(model: LanguageModel): boolean {
  return (
    typeof model === "object" &&
    model !== null &&
    "provider" in model &&
    typeof (model as { provider?: unknown }).provider === "string" &&
    (model as { provider: string }).provider.startsWith("anthropic")
  );
}

/**
 * Anthropic's provider-executed `web_search` tool (external-dependency-
 * discovery #252): gives the turn's model direct access to real-time web
 * content so it can verify a candidate external API/SDK actually exists
 * before proposing a `dependencies` entry for it, instead of inventing one.
 * `maxUses` bounds the per-turn search budget. Anthropic-only — call only
 * behind `isAnthropicModel`.
 */
export function webSearchTool(): ReturnType<typeof anthropic.tools.webSearch_20250305> {
  return anthropic.tools.webSearch_20250305({ maxUses: 4 });
}
