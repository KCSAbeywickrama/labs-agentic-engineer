# AGENTS.md — packages/contracts (`@aep/contracts`)

Shared, hand-written TypeScript types for cross-service boundaries. Consumers
import from here and never redefine the shapes locally.

## Layout

- `src/agents/sse-events.ts` — the agents SSE wire contract (`OpResult`,
  `Skill`, `TurnRequest`, `SSE_DONE`, …), consumed by `services/agents`.
- `src/index.ts` — the public barrel; re-exports the above.

## Build

- `build` / `typecheck` run `tsc`. Consumers depend on this package, so a
  breaking type change fails their typecheck — the drift guard.
