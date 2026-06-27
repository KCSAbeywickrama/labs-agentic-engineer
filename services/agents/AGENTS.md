# AGENTS.md — services/agents (`@aep/agents`)

TS interactive spec agents (Vercel AI SDK). Ported from the legacy `agents/`
service (`plan.md` §10) — currently seeded with ONE agent: the **main
file-mutation agent** (prompt-driven add / edit / remove over a spec bundle,
with an optional disk-streaming mode).

**Status:** seeded with the main agent only. The other spec agents (architect,
requirements-chat, tech-lead) land as the service is fully ported.

## Layout

- `src/agents/main/` — the agent:
  - `bundle.ts` — pure in-memory spec bundle + ops (anchored search/replace with
    uniqueness + candidate echo, idempotency, YAML reparse guard). Testable, no I/O.
  - `disk.ts` — `DiskMirror`: sandboxed real-filesystem mirror for disk mode.
  - `tool.ts` — the four AI-SDK tools (`addFile`/`editFile`/`removeFile`/`setFrontmatterField`).
  - `prompt.ts` — system instructions + the seed corpus the demo mutates.
  - `run.ts` — CLI entry + `renderRun()` (consumes `fullStream`, renders the live
    diff, streams mutations to disk).
- `src/shared/` — the model seam (`createModel`) + config.

Tool-edit rationale (anchored search/replace; alternatives rejected) is
`docs/decisions/ADR-0003-anchored-file-edits.md`; the loop/SSE/persistence/eval
refactor is `docs/design/agent-loop-and-eval-framework.md`. Tool *semantics* live
in `bundle.ts` / `tool.ts`, not a separate design doc.

## Run

- `pnpm --filter @aep/agents main -- "<instruction>"` — in-memory demo.
- `pnpm --filter @aep/agents main -- --root foo1 "<instruction>"` — disk mode;
  open `foo1/specs/design/components/hello-api/openapi.yaml` to watch edits stream in.
- Needs `ANTHROPIC_API_KEY` — export it, or add it to a `.env` at the monorepo
  root (see `.env.example`). `run.ts` reads the env, walking up to the nearest `.env`.

## Conventions

- SDK-specific wiring lives here (the consumer), not in `packages/agent` (the
  SDK-agnostic surface).
- Latest Claude models by default (see the `claude-api` skill for model ids).
- One public entry point per agent under `src/agents/<name>/run.ts`.
