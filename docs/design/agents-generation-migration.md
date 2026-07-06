# Generation flows: agents-legacy → new agents service — decision record

**Status:** 📐 Decided (grilling session 2026-07-03) — not started. Updated same day after **PR #70 (skillInt)** merged: skill `references` (third disclosure level), component `design.json` model with author-time schema gating, and the `@aep/excalidraw-dsl` / `@aep/design-projection` packages. Sections below reflect post-#70 reality.

**Scope:** migrate the BFF's LLM generation flows (requirements generate, requirements chat, design generate) from `services/agents-legacy` to the new file-mutation agent in `services/agents`. **Task generation is explicitly out of scope** — it stays on agents-legacy and gets its own design session later.

**Audience:** whoever implements this. Assumes familiarity with `services/agents` (ADR-0001 anchored edits, ADR-0002 skills), the `internal/feature/*` BFF layout, and `docs/design/skills-repo-storage.md` (the GitHub-direct commit pattern reused here).

---

## 1. The ownership triangle (the core model)

Every decision below follows from three ownerships:

| Owner | Owns | Never owns |
|---|---|---|
| **Frontend** | The latest draft — folded stream output **plus manual edits** | History, committed state |
| **GitHub** | Committed truth (commits on `main`; tags = versions) | Drafts |
| **Agents service** | The LLM thread (`ModelMessage[]`, verbatim, append-only — required for prompt cache + tool_use/tool_result pairing) | Files. It stays **files-stateless**: snapshot in per turn, throwaway FileBundle, discarded |

The existing `TurnRequest` contract (caller sends full `files` snapshot every turn) is not a wart — it **is** this model. It stays.

## 2. Use-case behavior = skills, not named agents

- One generic file-mutation agent. Requirements/design/chat behavior is expressed as **skills** (data), pushed by the BFF in the `TurnRequest`.
- **No pinned-skill param.** The BFF ends the instruction with an explicit action steer ("Generate the requirements …") and the model picks the skill(s) up from the catalog via `loadSkill`. Multiple skills may be pushed per turn — routing is by steering line + model choice.
- **Three disclosure levels** (post-#70): catalog (name+description) → `loadSkill` (body; result lists reference paths) → `loadSkillReference` (per-reference body). A skill may carry `references: Record<path,content>` (e.g. `openapi-conventions` ships the WSO2 REST guidelines); `loadSkillReference` is registered only when some pushed skill actually has references, so a references-free turn keeps the exact prior tool set.
- Blast radius of a skipped skill load is a wasted generation (review-before-accept), not corruption — accepted.
- **Evals must assert skill pickup**: the eval suite checks the stream contains the `loadSkill` tool-call for the expected skill (today's pickup eval expects `high-level-architecture`), so pickup-rate regressions surface on prompt changes.

### Skill storage
- Core flow skills live in **repo-root `skills/`** (current set: `high-level-architecture`, `excalidraw-wireframes`, `openapi-conventions` — each optionally with `references/*.md`; `component-architecture` was removed by #70). BFF ships them via `go:embed` — **including the `references/` files, pushed as `Skill.references`** — and pushes per-turn; **evals and playground read the same files** (`loadRepoSkills` already builds the references map) — the regression net tests exactly what deploys.
- The per-org `org-skills` repo keeps its auxiliary role. **Orgs cannot override core flow skills in v1.**

## 3. Frontend folds the stream; contract facts to honor

- Tool frames are **operations, not content**: `addFile` input carries full content; `editFile` carries anchor+replacement; `setFrontmatterField` is a YAML mutation; tool-results carry status only (`applied`/`noop`/error), no content.
- **Component `design.json` writes are schema-gated inside `FileBundle`** (post-#70): malformed JSON → `INVALID_JSON`, schema/name mismatch → `SCHEMA_VIOLATION`, and the write is blocked — the model self-corrects by re-emitting the whole file (`removeFile` + `addFile`). Because the gate lives in `FileBundle`, a client folding via the shared package enforces it identically for free — one more reason never to reimplement the fold.
- The console reconstructs files by importing the **actual `applyToolCall`/`FileBundle` code as a shared workspace package** exported from `services/agents` — real code-sharing, never a reimplementation.
- Fold only ops whose paired tool-result is `applied`, in stream order. **Failed attempts DO appear on the wire** (tool-result error + model's corrected retry, including the `design.json` schema rejections above) — useful for "re-anchoring…" UX; do not assume only-success frames. Unrecoverable failures end as an `error` frame → FE displays error.
- **Accepted risk (no tripwire):** deploy skew between console bundle and agents service could silently diverge folds. Per-file-hash-on-finish was proposed and declined; documented here as the known failure mode.

## 4. Files API in the BFF: GETs + one atomic apply

- **Reads:** `GET` list/file (served from GitHub at HEAD with the HEAD-SHA-revalidated cache pattern from the skills store). Reads return per-file blob SHAs.
- **Write:** exactly one endpoint — atomic `POST /projects/{p}/files:apply` with `{writes: [{path, content, baseSha}], deletes: [{path, baseSha}]}`. **Full final content per file** (diffs are a UI rendering concern only — the WYSIWYG md editor shows draft-vs-base diffs client-side; GitHub takes blobs anyway). Any stale `baseSha` → 409, all-or-nothing.
- No individual PUT/DELETE routes.

## 5. GitHub-direct: the working tree dies

- `files:apply` **commits straight to GitHub `main`** via the Git Data API (CAS retry, same as `skills/repo_store.go`). One commit per accept.
- **Save = cut a tag at HEAD.** Discard = revert to last tag. Versions = tags (unchanged).
- The per-project local clone (`REPO_BASE_PATH`) is removed — the BFF's biggest local state and horizontal-scaling blocker. Untagged commits on `main` are the new "working tree"; downstream consumers key on **tags**, so intermediate commits are harmless by construction.
- Work item: re-point the Yjs collab session, which reads the clone today. Chat per-turn undo snapshots and session baselines die (undo is a client-side draft operation now).

## 6. Conversation model

- FE sends its draft (manual edits included) with **every** turn; BFF forwards as `files`, setting `filesChangedExternally` when the user edited since the last turn. Each turn re-inlines the snapshot as CURRENT STATE — manual edits need no special path.
- **Snapshot filtering is a deliberate rule:** send only agent-authored file types — `.md`, `.dsl`, and component `design.json`; never derived artifacts (`.excalidraw` scenes can be 100s of KB of JSON, and `*.gen.json` projections). This mirrors the playground's `readSnapshot` exclusions exactly.
- **Derived artifacts are computed by the FE post-fold, not by the agent or BFF:** `.dsl` → `.excalidraw` via `@aep/excalidraw-dsl`, and `design.json` → `specs/design/cell-diagram.gen.json` via `@aep/design-projection` (the playground's post-turn `derived.ts` models this exact FE role). Derived files go into the `files/apply` writes so they're committed alongside their sources, but never into turn snapshots.
- Single-turn flows (requirements/design generate) = fresh conversation per click. Chat is the only multi-turn flow.
- BFF embeds org/project in the conversation id (namespaced prefix) and rejects turns/rehydrates outside the authenticated scope. No mapping table. Service stays tenancy-blind.
- **Postgres `ConversationStore` is a blocker for chat cutover only** (interface exists; in-memory fine for single-turn flows). Threads embed inlined snapshots → conversations need a **TTL/retention policy**.
- Refresh recovery: drafts in localStorage (existing `requirementsDraftStorage` pattern); `GET /conversations/:id` rehydrates chat history only — no files in the GET, correctly.
- Accepted cost: token growth on long chats (snapshot per turn + compounding history). Prefix caching absorbs reads. "Send only changed files" is a later, measured optimization — not designed in now.

## 7. Agents service operational envelope (phase 0, prerequisite)

- **Per-request Anthropic key:** `X-Anthropic-Key` header, model built per turn. **No built-in key at boot** — missing key is a hard 400. Evals/playground read the env key themselves and send it as a header like any caller.
- **Auth: plain M2M token** (no org claim — nothing calls back to the BFF; all context is pushed in). Pass org id as a plain header for logging/cost attribution only. Revisit if a server-side tool ever needs to fetch from the BFF mid-turn.
- **SSE keep-alives** (15s comments, as legacy does) — long generations behind ingress die without them.
- **Error mapping** in the BFF for the service's pre-stream statuses: 400, 409 (concurrent turn — FE needs defined "a turn is already running" behavior), 413 (body too large — BFF and service body limits must agree), 500.

## 8. Validation: three tiers — author-time, soft at accept, hard at the tag

Legacy's architect `finalize` tool schema-validated output. Post-#70 the generic agent partially does too, so validation now has three tiers:

- **Author-time (agent write gate, exists since #70):** `FileBundle` blocks malformed component `design.json` at write time (`checkComponentDesign` → `INVALID_JSON`/`SCHEMA_VIOLATION`; model self-corrects in-turn). This covers *agent-authored* content only — it cannot vouch for what the user hand-edits in the draft afterwards.
- **`files:apply`:** path scoping (`specs/` prefix, traversal, size caps) + non-blocking warnings only. Keeps the Files API generic.
- **Save (tag creation) is still the hard semantic gate**, precisely because drafts are user-editable after the fold: per-artifact schemas (top-level `design.md` frontmatter, component `design.json`, OpenAPI parseability), design layout. Nothing malformed can acquire a tag — the only thing downstream trusts. For `design.json` the Go-side gate must validate against **the same schema definition** — publish `componentDesignSchema` (services/agents `src/contracts/component-design.ts`) as JSON Schema so BFF and agent validate one definition, not two hand-kept copies.
- FE pre-validates the draft before accept (it holds the files) for instant feedback.
- Spec-approval gating (design generation requires a tagged requirements version) stays as a BFF pre-check on the generate endpoint.

## 9. Tasks: redesigned separately

Task generation stayed on agents-legacy when this doc was written. Its redesign
happened in the 2026-07-04 grilling session — see **`tasks-github-native.md`**:
Task = GitHub issue (labels + machine block), Postgres keeps only per-attempt
`executions` rows, execution is label-triggered through a single reactive funnel,
and planning runs on the new service's generic agent via **domain task tools**
(`planTask`/`updateTask`) whose self-contained tool calls the BFF executes
mid-stream — no fold in Go, superseding the task-stub-files + `POST /tasks/batch`
sketch this section previously carried.

Side effect resolved by #70: the `.dsl` → `.excalidraw` transform is now the **`@aep/excalidraw-dsl` workspace package** (FE derives post-fold, §6), so migrated flows no longer need agents-legacy's `dsl/render` at all. It remains only as an internal dependency of the not-yet-migrated legacy flows and dies with them.

## 10. Migration order

1. **Phase 0** — service hardening (§7) + Postgres ConversationStore + first BFF→new-service wiring.
2. **Requirements generate** (simplest: mostly one file, `addFile`-heavy).
3. **Requirements chat** (multi-turn; exercises draft-per-turn contract + shared fold package in the console).
4. **Design generate** (multi-file + save-gate validation).
5. Tasks: deferred on legacy.

Each flow cuts over behind config with legacy still runnable. The console's stream parsing is rewritten per flow (AI SDK UI-message frames → raw `StreamPart`s + shared fold package).

## 11. One framing note

"One BFF endpoint, different prompts" is true at the wire, but a **per-use-case context assembler** remains behind it: design turns need the requirements bundle + previous design; chat needs the draft files; each picks its skills and steering suffix. The endpoint unifies; the assembly logic relocates rather than disappears.

## 12. Boundaries, API contracts, and service modifications

### 12.1 Boundaries (who may talk to whom)

```
Console ──REST/SSE──► BFF (aep-api) ──M2M+SSE──► agents service ──► Anthropic API
                        │
                        └──Git Data API──► GitHub (per-project repo)
```

| Component | May | May NOT |
|---|---|---|
| **Console** | Call BFF REST/SSE; fold streams via the shared package; derive artifacts post-fold (`@aep/excalidraw-dsl`, `@aep/design-projection`); hold drafts (localStorage) | Talk to the agents service, GitHub, or Anthropic; see raw service conversation ids |
| **BFF** | Assemble per-use-case context; namespace conversation ids; resolve org Anthropic key; commit/tag/read via Git Data API; enforce all tenancy + gates | Fold anchored edits (no Go fold — bodies excepted per §9 sketch, out of scope here); reconstruct or resend LLM history |
| **Agents service** | Run turns against caller-supplied snapshots; persist conversation threads (its own Postgres table); call Anthropic with the per-request key | Read/write files anywhere; call GitHub or the BFF; hold an API key of its own; know about orgs/projects (log-only header) |
| **GitHub** | Source of truth for committed artifacts (commits + tags) | — |

### 12.2 BFF public API (all under `/api/v1`, Huma code-first, org from verified token)

**Files (new feature package, e.g. `internal/feature/files`)** — generic, `specs/`-scoped, GitHub-at-HEAD backed:

| Op | Endpoint | Notes |
|---|---|---|
| List | `GET /projects/{projectName}/files?prefix=specs/…` | `[{path, sha, size}]` at HEAD (HEAD-SHA-revalidated cache, skills-store pattern) |
| Read | `GET /projects/{projectName}/files/{path...}` | `{path, content, sha}`; SHA doubles as the draft's `baseSha` |
| Apply | `POST /projects/{projectName}/files/apply` | The one write — atomic accept (below) |

`POST /files/apply` request/response:

```jsonc
// request
{
  "writes":  [{ "path": "specs/design/design.md", "content": "…", "baseSha": "abc…" }],  // baseSha omitted ⇒ must not exist yet
  "deletes": [{ "path": "specs/design/components/foo/design.json", "baseSha": "def…" }],
  "message": "optional commit message suffix"
}
// 200
{ "commitSha": "…", "files": [{ "path": "…", "sha": "…" }], "warnings": [{ "path": "…", "code": "…", "message": "…" }] }
// 409 (any stale baseSha; nothing applied)
{ "conflicts": [{ "path": "…", "baseSha": "…", "currentSha": "…" }] }
```

Semantics: path validation (`specs/` prefix, no traversal, size caps) → soft-validation warnings (never blocking) → single commit to `main` via Git Data API under bounded CAS retry. All-or-nothing.

**Generation/chat (unified turn endpoint, new feature package, e.g. `internal/feature/genai`):**

| Op | Endpoint |
|---|---|
| Turn | `POST /projects/{projectName}/conversations/{conversationId}/turns` → SSE |
| Rehydrate | `GET /projects/{projectName}/conversations/{conversationId}` (chat only) |

Turn request (FE → BFF):

```jsonc
{
  "useCase": "requirements-generate" | "requirements-chat" | "design-generate",
  "instruction": "user message / generation directive",
  "files": { "specs/requirements/requirements.md": "…" },   // FE's current draft (latest truth)
  "filesChangedExternally": true,                            // user hand-edited since last turn (chat)
  "target": "optional — e.g. requirement file name / doc type"
}
```

BFF assembler (per `useCase`, behind the single endpoint):
1. Tenancy: `conversationId` is FE-chosen (uuid); BFF forwards to the service as `org_{orgId}--proj_{projectId}--{useCase}--{uuid}`. Any turn/rehydrate outside the authenticated scope → 404. FE never sees the namespaced id.
2. Gates: design-generate requires an approved (tagged) requirements version — pre-stream 4xx, as today.
3. Snapshot: filter FE files to agent-authored types (`.md`, `.dsl`, component `design.json`; never `.excalidraw`/`*.gen.json`); for design-generate, merge in the approved requirements bundle read at its tag (server-side context the FE doesn't own).
4. Skills: embedded core skills for the use case — bodies **and** `references` maps — pushed in the `TurnRequest` (+ auxiliary org skills); steering suffix appended to `instruction`.
5. Key: resolve org Anthropic key (no platform fallback) → `X-Anthropic-Key`.
6. Stream: **verbatim passthrough** of the service's raw `StreamPart` frames + `[DONE]`. The BFF injects no frames (unlike legacy task/chat flows). Keep-alive comments pass through.

Error mapping (pre-stream): service 409 → BFF 409 `{code:"turn_in_progress"}`; 413 → 413 (body limits must agree); 400/500 → 502-style upstream error. Mid-stream failures arrive as in-band `error` frames — status is already sent.

**Existing endpoints — kept, reworked, or removed at each flow's cutover:**

| Endpoint | Fate |
|---|---|
| `POST …/requirements/save`, `…/design/save` | Kept; internals become: **hard semantic validation → tag at HEAD** (§8). Design-save keeps triggering task reconciliation |
| `…/requirements/discard`, `…/design/discard` | Kept; semantics become **revert-commit back to last tag** (no working tree to reset) |
| `GET …/requirements`, `GET …/design/bundle`, versions GETs | Kept; reads move from clone to GitHub-at-HEAD / at-tag |
| `PUT/DELETE …/requirements/files/{name}`, `…/design/files/{path...}`, `DELETE …/design/components/{name}` | **Removed** — manual edits are FE drafts until `files/apply` |
| `POST …/requirements/files/{name}/generate`, `…/design/generate`, `…/requirements/chat` | **Removed** at cutover → unified turn endpoint |
| `…/chat/turns/{turnId}/undo`, baseline/snapshot endpoints, collab-session | Undo/baseline **removed** (client-side draft ops); collab re-pointed (work item §5) |
| Task endpoints + `clients/agents` legacy methods for tech-lead/dsl | **Unchanged** (§9) |

### 12.3 Agents service modifications (`services/agents`)

**Contract baseline the BFF codes against (as of #70):** `POST /conversations/:id/turns` body `{instruction, files, filesChangedExternally?, skills?}` where each skill is `{name, description, content, references?}`; raw `StreamPart` wire format + `[DONE]`; tools `addFile`/`editFile`/`removeFile`/`setFrontmatterField` + `loadSkill` (+ `loadSkillReference` only when references were pushed); tool-result error codes now include `INVALID_JSON`/`SCHEMA_VIOLATION` (component `design.json` gate); throwaway per-turn `FileBundle`; single `main` agent; `GET /conversations/:id` (messages only — no files, correctly). Pre-stream statuses 400/409/413/500 and the `bodyLimit` config already exist — the BFF-side mapping in §12.2 is BFF work, not a service change.

**Changes (phase 0) — still to build:**

1. **Per-request model** — require `X-Anthropic-Key`; `createModel` per turn; missing key = 400 pre-stream. Delete the boot-time model singleton and the server's env-key read (`ANTHROPIC_API_KEY` is read only by evals/playground harnesses, which send it as the header like any caller).
2. **M2M gate** — Bearer JWT middleware, `aud: agents-service`, verified against configured JWKS/secret. No org claim (nothing calls back to the BFF). Optional `X-Org-Id` header logged for cost/error attribution only.
3. **SSE keep-alives** — `: keep-alive` comment every 15s while a turn streams.
4. **Postgres `ConversationStore`** — implements the existing interface (`get`/`save` whole aggregate). Sketch: `conversations(id text pk, messages jsonb, status text, created_at, updated_at)` + TTL sweep on `updated_at` (threads embed inlined snapshots → they have real size).
5. **Publish `componentDesignSchema` as JSON Schema** (from `src/contracts/component-design.ts`) so the BFF's save-gate validates the same definition (§8).

### 12.4 Shared fold package (new)

Extract the client-side consumption surface into a workspace package the console can import (e.g. `@aep/agent-stream`) — still to build; #70 established the exact pattern with `packages/excalidraw-dsl` and `packages/design-projection`. Contents, moved not copied, from `services/agents`:

- `StreamPart` types + SSE reader (`evals/sse-client.ts`'s `streamTurn` parsing loop),
- `FileBundle`, `applyToolCall`, `toChange` (`src/agents/main/{bundle,change,stream-types}.ts`),
- the wire contracts (`src/contracts/{sse-events,component-design}.ts`) — moving `FileBundle` brings the `design.json` write gate (§3) with it, so the FE fold enforces the same schema automatically.

Constraints: zero server-side deps (no Express/AI-SDK server imports); `services/agents`, evals, playground, and the console all consume this one package, so fold semantics have a single definition. The accepted deploy-skew risk (§3) is between *deployed versions* of this package, not between implementations. The console additionally consumes `@aep/excalidraw-dsl` + `@aep/design-projection` for the derived artifacts (§6).
