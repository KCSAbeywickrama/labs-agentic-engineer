# AGENTS.md — services/agents (`@aep/agents`)

TS interactive spec agents (Vercel AI SDK). Seeded with ONE agent: the **main
file-mutation agent** (prompt-driven add/edit/remove over a spec bundle), exposed
as an **SSE turn stream** (one turn = one HTTP request). The runtime **writes no
files** — accept/edit/save is a separate concern.

## Design

The client-side consumption surface — wire types (SSE events, `OpResult`,
`*Input`, `Change`, `TurnRequest`), the `FileBundle` fold (`applyToolCall`,
`toChange`) with the component `design.json` write-gate, the SSE reader
(`streamTurn`), and the published JSON Schema — lives in the workspace package
**`@aep/agent-stream`** (moved there so the console/evals/playground fold one
definition). This service imports it; `tool.ts`'s Zod schemas are drift-guarded
against the wire `*Input` types there. See `design/`
(`ADR-0001-anchored-file-edits.md`, `ADR-0002-skills-progressive-disclosure.md`,
`agent-loop-and-eval-framework.md`).

**Skills** are guidance (not code): the caller pushes `skills: { name, description,
content }[]` in the turn payload, the service shows a name+description **catalog** at
the end of the system prompt, and the agent pulls a body on demand via the
**`loadSkill`** tool. The service never reads skills from disk (the eval reads
repo-root `skills/`); no skills in the payload → no catalog, behaves as today. See
ADR-0002.

## Run

- `pnpm --filter @aep/agents dev` — SSE server, watch/reload. `start` — run once.
- Endpoints: `GET /healthz` (open) · `POST /conversations/:id/turns` (SSE) ·
  `GET /conversations/:id` — the last two behind the M2M gate.
- **No boot-time Anthropic key**: the model is built per turn from the
  `X-Anthropic-Key` header (missing → 400). `X-Org-Id` is log-only attribution.
- **M2M gate is always on**: set `AGENT_JWT_JWKS_URL` (RS256) **or**
  `AGENT_JWT_SECRET` (HS256) — the server refuses to boot with neither. `aud`
  defaults to `agents-service` (`AGENT_JWT_AUDIENCE`); `AGENT_JWT_ISSUER` optional.
- **Store**: Postgres when `DATABASE_URL` is set (idempotent bootstrap + TTL
  sweep, `CONVERSATIONS_TTL_MS` / `CONVERSATIONS_SWEEP_MS`), else in-memory.
- Keep-alives every `AGENT_KEEPALIVE_MS` (default 15s) while a turn streams.
- The evals/playground read `ANTHROPIC_API_KEY` themselves and send it (plus an
  HS256 M2M token) as headers, like any caller.

## Test

- `test` — source unit tests (`src/**/*.test.ts`), no tokens.
- `test:eval` — deterministic eval-tree tests (`evals/**/*.test.ts`), no tokens.
- `eval` — model suite over the live route; report-not-gate, skips without a key.
- `typecheck:eval` — typecheck the eval tree (`tsconfig.eval.json`).

## Conventions

- Agent + SDK wiring (the `ToolLoopAgent` loop, tools, prompt, server) lives
  here; the client-safe fold + wire contracts live in `@aep/agent-stream`.
- Latest Claude models by default (see the `claude-api` skill for model ids).
- One agent per `src/agents/<name>/`; the loop (`run-turn.ts`) is shared.
- `src/` writes no files; only `evals/` touches the filesystem.
