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
 * Agent SSE event contract — the typed, documented surface over the main spec
 * agent's turn stream.
 *
 * The wire stays RAW `StreamPart` (the SDK's `TextStreamPart`, one frame per
 * part); this module does NOT add an envelope. It exists so the producer (the
 * Express SSE route in `server.ts`), the eval, and the playground share ONE
 * definition of: the emitted event catalog, the payloads carried inside the
 * frames (`OpResult`, the per-tool `*Input` shapes), the reviewable `Change`
 * projection, and the turn-request body (`TurnRequest`).
 *
 * Ownership: this module is the leaf source of truth, owned by the producer.
 * The domain (`agents/main/bundle.ts` / `tool.ts`) imports these types and the
 * Zod schemas carry a compile-time drift guard asserting they stay assignable
 * to the `*Input` types here — so there is no hand-maintained parallel copy.
 * This stream is NOT part of the generated OpenAPI contracts in
 * `packages/contracts` (raw AI SDK frames aren't OpenAPI-representable).
 */

// --- Result payloads (the `tool-result.output` value) -----------------------

/** The four file-mutation operations the main agent performs. */
export type Op = "add" | "edit" | "remove" | "frontmatter";

/** Error codes the `FileBundle` returns to steer one-step self-correction. */
export type ErrCode =
  | "ALREADY_EXISTS"
  | "INVALID_PATH"
  | "NOT_FOUND"
  | "NOT_UNIQUE"
  | "NO_SUCH_FILE"
  | "EMPTY_OLD_STRING"
  | "INVALID_YAML"
  | "INVALID_JSON"
  | "SCHEMA_VIOLATION"
  | "NO_FRONTMATTER"
  | "PROTECTED_PATH";

/** A candidate line echoed back for NOT_UNIQUE / NOT_FOUND re-anchoring. */
export interface MatchCandidate {
  line: number;
  text: string;
}

/**
 * A successful op. Carries NO file content — a successful result is just the
 * status; the model anchors later edits from its own tool-call args plus the
 * re-inlined CURRENT STATE, and consumers reconstruct file state by folding the
 * stream (see `Change` / `applyToolCall`).
 */
export interface OpOk {
  ok: true;
  path: string;
  op: Op;
  /** `applied` = state changed; `already-applied`/`noop` = idempotent no-change. */
  status: "applied" | "already-applied" | "noop";
}

/** A failed op. Keeps the self-correction payload (candidates / count). */
export interface OpErr {
  ok: false;
  path: string;
  op: Op;
  code: ErrCode;
  message: string;
  /** Populated for NOT_UNIQUE / NOT_FOUND to steer one-step re-anchoring. */
  candidates?: MatchCandidate[];
  count?: number;
}

export type OpResult = OpOk | OpErr;

// --- Per-tool input shapes (the `tool-call.input` value) --------------------
//
// These are the WIRE source of truth. The Zod `inputSchema`s in
// `@aep/agents` `tool.ts` carry a compile-time assert that `z.infer<schema>`
// stays equal to these — divergence fails that package's typecheck.

export interface AddFileInput {
  path: string;
  content: string;
}

export interface EditFileInput {
  path: string;
  oldString: string;
  newString: string;
}

export interface RemoveFileInput {
  path: string;
}

export interface SetFrontmatterFieldInput {
  path: string;
  key: string;
  value: string | number | boolean | string[];
}

// --- Skills (progressive disclosure, ADR-0002) ------------------------------
//
// Skills are GUIDANCE, not code. The caller RESOLVES them (the eval reads
// repo-root `skills/`; in production a BFF reads the org repo) and pushes the
// full candidate set in the turn request. The service never reads skills from
// disk: it shows only a name+description catalog at the end of the system prompt
// and serves a body on demand via the `loadSkill` tool. The body enters context
// only when loaded, and then persists as a tool result in message history.

/** One candidate skill pushed in the turn request — a resolved `SKILL.md`. */
export interface Skill {
  /** Stable id; what the catalog lists and `loadSkill` takes (the dir name). */
  name: string;
  /** One-line summary shown in the catalog so the agent can decide to load it. */
  description: string;
  /** The full guidance body (frontmatter stripped) returned by `loadSkill`. */
  content: string;
  /**
   * Optional reference files (agentskills.io structure): `references/<file>.md`
   * → body. A third disclosure level: listed by `loadSkill`, served one at a
   * time by `loadSkillReference`. Mirrors the coding-agent leg
   * (`SkillResolution.references` in the remote-worker).
   */
  references?: Record<string, string>;
}

/** The `loadSkill` tool input. WIRE source of truth; drift-guarded in `tool.ts`. */
export interface LoadSkillInput {
  name: string;
}

/**
 * The `loadSkill` tool result. Success carries the body; a miss carries the
 * available names so the model self-corrects in one round-trip (cf. NOT_FOUND).
 * `references` (when present) lists the skill's reference paths for
 * `loadSkillReference` — the body tells the agent when each is worth reading.
 */
export type LoadSkillResult =
  | { ok: true; name: string; content: string; references?: string[] }
  | { ok: false; name: string; error: string; available: string[] };

/** The `loadSkillReference` tool input. WIRE source of truth; drift-guarded in `tool.ts`. */
export interface LoadSkillReferenceInput {
  name: string;
  path: string;
}

/**
 * The `loadSkillReference` tool result. A miss lists what IS addressable so the
 * model self-corrects in one round-trip: the skills carrying references (name
 * miss) or that skill's reference paths (path miss).
 */
export type LoadSkillReferenceResult =
  | { ok: true; name: string; path: string; content: string }
  | { ok: false; name: string; path: string; error: string; available: string[] };

// --- MCP discovery (caller-supplied, Task E2) -------------------------------
//
// The org's dependency-discovery MCP server (aep-api
// `internal/feature/dependencies/mcp_server.go`) lists read-only tools
// (list_external_resources, get_external_resource_schema, list_org_endpoints,
// list_platform_resource_types) so the design agent proposes `dependencies`
// entries that reuse resources/endpoints already registered in the org instead
// of inventing new names/shapes. Mirrors `Skill`: the CALLER resolves the
// endpoint (aep-api mints a short-lived per-turn token) and pushes it in the
// turn payload; the service never reads it from its own env. Omitted → no
// `tools/list` fetch and no discovery tools registered (byte-identical to a
// turn without `mcp`).

/** Caller-supplied MCP discovery endpoint for this turn. */
export interface McpConfig {
  /** The MCP JSON-RPC endpoint (aep-api's `/internal/v1/mcp`, org-bound). */
  url: string;
  /**
   * Bearer token for that endpoint. Short-lived (minted per call, ~5 min TTL on
   * the aep-api side) — a turn that outlives it sees the discovery tools 401
   * partway through; `loadMcpTools` degrades that to "no tools" up front, but a
   * mid-turn `tools/call` 401 surfaces as a failed tool call (best-effort, not
   * retried).
   */
  token: string;
}

// --- The reviewable change (§7) ---------------------------------------------

/**
 * A reviewable projection of one `tool-result` part: the op intent plus its
 * result. A browser folds these into a live diff; the eval reconstructs files
 * via `applyToolCall` instead. Pure field projection — see `toChange` in
 * `@aep/agents` `change.ts`.
 */
export interface Change {
  toolCallId: string;
  toolName: string;
  op: Op;
  path: string;
  /** editFile payload. */
  oldString?: string;
  newString?: string;
  /** addFile payload. */
  content?: string;
  /** setFrontmatterField payload. */
  key?: string;
  value?: string | number | boolean | string[];
  result: OpResult;
}

// --- The turn request (the `POST /conversations/:id/turns` body) -------------

/**
 * The turn-request body. The caller passes the full accepted `files` snapshot
 * every turn (the service reads no repo/disk); `filesChangedExternally` flags an
 * out-of-band edit so the server prepends a CURRENT-STATE-authoritative note.
 * The producer (server) validates an untrusted body against this shape; the eval
 * client (and a future browser) construct it — one definition, no drift.
 */
export interface TurnRequest {
  instruction: string;
  files: Record<string, string>;
  filesChangedExternally?: boolean;
  /**
   * The candidate skills for this turn (ADR-0002). Only `name`+`description` are
   * shown (the catalog); the agent pulls a body via `loadSkill`. Omitted/empty →
   * no catalog and no `loadSkill` tool (byte-identical to a skill-free turn).
   */
  skills?: Skill[];
  /**
   * Caller-supplied MCP discovery endpoint for this turn (Task E2). Present →
   * the turn loop fetches `tools/list` from it (best-effort) and registers each
   * as a dynamic tool. Omitted → no fetch, no discovery tools (byte-identical to
   * an mcp-free turn).
   */
  mcp?: McpConfig;
}

// --- The emitted event catalog ----------------------------------------------

/**
 * The documented subset of `StreamPart` `type`s the SSE route emits, one SSE
 * frame each. The wire carries the raw part verbatim; this catalog names what a
 * consumer can expect to see.
 */
export const AGENT_SSE_EVENT_TYPES = [
  "text-delta",
  "tool-input-start",
  "tool-input-delta",
  "tool-call",
  "tool-result",
  "tool-error",
  "error",
  "finish",
] as const;

export type AgentSseEventType = (typeof AGENT_SSE_EVENT_TYPES)[number];

/** The terminal sentinel sent after the last frame: `data: [DONE]`. */
export const SSE_DONE = "[DONE]" as const;

// --- The envelope type ------------------------------------------------------

/**
 * The raw stream-part envelope as produced by the AI SDK server stream
 * (`result.stream`). Re-exported for consumers that want the full SDK type;
 * `@aep/agents` keeps its own minimal structural `StreamPart` for the loop seam.
 */
export type { TextStreamPart } from "ai";
