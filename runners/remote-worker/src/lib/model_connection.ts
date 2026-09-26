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

// THE MODEL CONNECTION as a coding run reads it: which endpoint the run's one
// model is served from, in which wire format, and what the platform resolved
// about it. The organization's connection reaches the pod as `AEP_MODEL_*` env,
// copied onto the Job at dispatch (ADR-0028) like the runtime and the model, so
// a run in flight keeps the connection it was launched with.
//
// This is the one place those variables are read. Each runtime adapter maps the
// connection to its own spelling (Claude Code's `ANTHROPIC_*` env, OpenCode's
// provider block), so the port carries the connection and no runtime's
// vocabulary.
//
// The CREDENTIAL is not part of it. The dispatch mounts exactly one model
// credential as a secret ref, and which variable a runtime presents it under is
// the adapter's business; it reaches the session through `RuntimePolicy.env`.
//
// Absent variables mean today's connection: Anthropic's own API, the key sent as
// `x-api-key`, and no limits stated, because on `api.anthropic.com` both runtimes
// already know Claude's. A Job dispatched before the variables existed, and the
// playground, therefore get exactly the run they had. A variable that IS set
// but names nothing this build knows is an error, never a default: running a
// connection the org did not choose is the same silent substitution the runtime
// registry refuses.

/** The wire format a connection speaks. */
export type ModelFormat = "anthropic" | "openai-compatible";

/** How the connection key is presented: Anthropic's own header, or `Authorization: Bearer`. */
export type ModelAuthScheme = "x-api-key" | "bearer";

/**
 * How a run on this connection searches the web: Anthropic's server-side tool
 * (only `api.anthropic.com` runs it), Ollama's search API, or not at all. The
 * platform decides it once, from the connection's capabilities, and the runner
 * only follows it.
 */
export type WebSearchStrategy = "anthropic-server-tool" | "ollama-api" | "none";

const FORMATS: readonly ModelFormat[] = ["anthropic", "openai-compatible"];
const AUTH_SCHEMES: readonly ModelAuthScheme[] = ["x-api-key", "bearer"];
const WEB_SEARCH_STRATEGIES: readonly WebSearchStrategy[] = ["anthropic-server-tool", "ollama-api", "none"];

/** The connection a run gets when the dispatch stated none: Anthropic's own API. */
const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";

/** A coding run's model connection. */
export interface ModelConnection {
  format: ModelFormat;
  /**
   * The URL as the organization saved it, ending in `/v1` where the format's
   * SDKs expect it. A runtime that wants the root (Claude Code's
   * `ANTHROPIC_BASE_URL`) derives it; the org enters one URL.
   */
  baseURL: string;
  /** `baseURL`'s host: what "on Anthropic's own API" is decided by. */
  host: string;
  authScheme: ModelAuthScheme;
  /**
   * The ONE model of the run: the lead, every subagent and the runtime's own
   * helper calls (titles, summaries) all run on it, because the platform is
   * bring-your-own-key and a second model is one the org's key may not reach.
   * The organization's setting, reaching the pod as `AEP_AGENT_MODEL`.
   *
   * Pinned rather than left to the runtime's default, which drifts across
   * releases (seen live: an unpinned run resolved to `claude-sonnet-4-6`). The
   * platform can only stamp a cost for a model it has a `model_rates` row for,
   * so the settable list is narrower than the list a runtime can serve.
   */
  model: string;
  /** Resolved at save; absent on `api.anthropic.com`, where the runtimes know Claude's. */
  contextWindow?: number;
  /** Resolved at save; absent on `api.anthropic.com`. */
  outputLimit?: number;
  webSearch: WebSearchStrategy;
}

/**
 * Thrown when a dispatched `AEP_MODEL_*` value names nothing this build can run.
 *
 * `shown` is what the message may echo: this pod's output reaches the
 * user-visible build log, so a URL is never echoed whole (it could carry
 * userinfo), only its host when it has one.
 */
export class InvalidModelConnectionError extends Error {
  readonly variable: string;
  constructor(variable: string, shown: string, reason: string) {
    super(`${variable}=${JSON.stringify(shown)} is not a model connection this runner can read: ${reason}`);
    this.name = "InvalidModelConnectionError";
    this.variable = variable;
  }
}

/**
 * The run's model connection, from the dispatch's env.
 *
 * `defaultModel` is the runtime's own default (`Runtime.defaultModel`), used when
 * the organization has chosen no model: what a runtime should default to is the
 * runtime's fact, not this module's.
 *
 * Every value is trimmed and a blank one counts as absent, because a stamped env
 * var picks up whitespace from a YAML block scalar, and a model id with a
 * trailing space resolves to nothing.
 */
export function readModelConnection(defaultModel: string, env: NodeJS.ProcessEnv = process.env): ModelConnection {
  const read = (key: string): string => (env[key] ?? "").trim();

  const baseURL = read("AEP_MODEL_BASE_URL") || DEFAULT_BASE_URL;
  const contextWindow = positiveInt("AEP_MODEL_CONTEXT_WINDOW", read("AEP_MODEL_CONTEXT_WINDOW"));
  const outputLimit = positiveInt("AEP_MODEL_OUTPUT_LIMIT", read("AEP_MODEL_OUTPUT_LIMIT"));
  return {
    format: oneOf("AEP_MODEL_FORMAT", read("AEP_MODEL_FORMAT"), FORMATS, "anthropic"),
    baseURL,
    host: hostOf(baseURL),
    authScheme: oneOf("AEP_MODEL_AUTH_SCHEME", read("AEP_MODEL_AUTH_SCHEME"), AUTH_SCHEMES, "x-api-key"),
    model: read("AEP_AGENT_MODEL") || defaultModel,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(outputLimit !== undefined ? { outputLimit } : {}),
    webSearch: oneOf("AEP_MODEL_WEB_SEARCH", read("AEP_MODEL_WEB_SEARCH"), WEB_SEARCH_STRATEGIES, "anthropic-server-tool"),
  };
}

function oneOf<T extends string>(variable: string, raw: string, allowed: readonly T[], fallback: T): T {
  if (raw === "") return fallback;
  const found = allowed.find((v) => v === raw);
  if (found) return found;
  throw new InvalidModelConnectionError(variable, raw, `expected one of ${allowed.join(", ")}`);
}

function positiveInt(variable: string, raw: string): number | undefined {
  if (raw === "") return undefined;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new InvalidModelConnectionError(variable, raw, "expected a positive integer");
  return Number(raw);
}

function hostOf(baseURL: string): string {
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    throw new InvalidModelConnectionError("AEP_MODEL_BASE_URL", "", "not a URL");
  }
  if (url.protocol !== "https:") {
    throw new InvalidModelConnectionError("AEP_MODEL_BASE_URL", url.hostname, "not an https URL");
  }
  return url.hostname;
}
