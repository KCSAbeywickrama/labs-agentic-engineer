# ADR-0003: Contract source and codegen pipeline

- **Status:** Accepted (amended 2026-07-03: real spec replaced the placeholder)
- **Date:** 2026-07-03 (decisions from the 2026-07-02/03 scaffold sessions)
- **Context:** the console is contract-first. The scaffold initially shipped a
  hand-written placeholder spec because no contract was committed; upstream
  now commits the real BFF contract, which supersedes it.

## Decision

- **The committed BFF contract** at `packages/contracts/api/v1/openapi.yaml`
  is the codegen source. Its paths are unprefixed with `servers: /api/v1`;
  openapi-fetch does not apply `servers`, so the client's `baseUrl` carries
  `/api/v1` (`src/api/client.ts`) and call sites use unprefixed paths
  (`client.GET("/projects")`).
- **Console owns `gen`**: `openapi-typescript <spec> -o src/generated/aep-api.d.ts
  && tsr generate`. Move gen into `@aep/contracts` (exporting the types) when
  a second consumer appears.
- **Everything generated lands in `src/generated/`** (API types + TanStack
  route tree): that path is simultaneously gitignored, eslint-ignored, and
  license-check-exempt. `*.gen.ts` outside a `generated/` dir would be
  license-checked — don't relocate.
- **Package-level `apps/console/turbo.json`** overrides `gen.inputs` with
  `$TURBO_ROOT$/packages/contracts/api/v1/openapi.yaml` + route files — the
  root task's package-relative inputs would otherwise cache stale gens
  (verified by content-edit → cache-miss).

## Consequences

- `make gen` must run before build/typecheck on a fresh checkout (turbo wires
  this as a task dependency).
- A contract edit fails mocks and client code at typecheck — the drift guard.
