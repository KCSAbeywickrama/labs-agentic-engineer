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
import { createAnthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
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
 * Build a Vercel AI SDK `LanguageModel` from resolved credentials. This is the
 * ONLY function that knows which provider SDK to instantiate.
 */
export function createModel(cfg: LlmConfig): LanguageModel {
  const provider = createAnthropic({
    apiKey: cfg.apiKey,
    ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
  });
  return provider(cfg.model ?? config.model);
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
