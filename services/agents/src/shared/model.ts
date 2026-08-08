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
 * Multi-provider stays additive: `LlmConfig` grows a `provider` discriminator
 * and `createModel` switches on it — no call-site changes.
 *
 * (The per-org key resolver from the legacy agents-service is intentionally NOT
 * ported here — this package is the standalone main-agent demo, which reads its
 * key from the environment. See run.ts.)
 */

import type { LanguageModel } from "ai";
import { anthropic, createAnthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import type { ProviderOptions } from "../agents/main/run-turn.js";
import { config } from "./config.js";

/** Resolved LLM configuration for a single run. */
export interface LlmConfig {
  /** Provider API key. */
  apiKey: string;
  /** Model id. Defaults to the service-wide `config.model`. */
  model?: string;
  /** Optional provider base URL override (gateways / proxies / self-host). */
  baseURL?: string;
}

/**
 * The model id `createModel` resolves for `cfg`. Exported so the composition
 * root can thread the SAME id it instantiates into the turn (usage attribution
 * on the terminal manifest, #249) instead of re-deriving the default elsewhere.
 */
export function resolveModelId(cfg: Pick<LlmConfig, "model"> = {}): string {
  return cfg.model ?? config.model;
}

/**
 * Build a Vercel AI SDK `LanguageModel` from resolved credentials. This is the
 * ONLY function that knows which provider SDK to instantiate.
 */
export function createModel(cfg: LlmConfig): LanguageModel {
  const provider = createAnthropic({
    apiKey: cfg.apiKey,
    ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
  });
  // Trace capture is NOT wrapped around the model: a capturing object's
  // lifetime became the trace's run identity, and this object is rebuilt every
  // turn (the key is per-request), which split one conversation across N runs.
  // Capture registers once at the composition root and is stamped per turn —
  // see shared/telemetry.ts.
  return provider(resolveModelId(cfg));
}

/**
 * Provider-specific per-call options, built here so the reasoning-effort knob
 * (like the provider SDK itself) stays inside this seam. The generic turn loop
 * passes the returned object through untouched.
 */
export function modelProviderOptions(): ProviderOptions {
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
