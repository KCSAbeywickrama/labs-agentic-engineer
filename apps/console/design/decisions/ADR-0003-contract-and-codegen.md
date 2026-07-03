# ADR-0003: Contract snapshot and codegen pipeline

- **Status:** Accepted
- **Date:** 2026-07-03 (decisions from the 2026-07-02/03 scaffold sessions)
- **Context:** the console is contract-first, but `aep-api` is code-first
  Go/Huma — its spec is a build artifact, not a committed file. The console
  needed a spec to generate from without coupling TS builds to the Go
  toolchain.

## Decision

- **Placeholder spec** committed at `packages/contracts/aep-api/openapi.yaml`
  (currently the projects-list endpoint only). Refresh from the BFF when the
  contract grows: `cd services/aep-api && go run ./cmd/openapigen && cp
  build/openapi.yaml ../../packages/contracts/aep-api/openapi.yaml`
  (fresh checkouts need `make gen-oc-client` first).
- **Console owns `gen`**: `openapi-typescript <spec> -o src/generated/aep-api.d.ts
  && tsr generate`. Move gen into `@aep/contracts` (exporting the types) when
  a second consumer appears.
- **Everything generated lands in `src/generated/`** (API types + TanStack
  route tree): that path is simultaneously gitignored, eslint-ignored, and
  license-check-exempt. `*.gen.ts` outside a `generated/` dir would be
  license-checked — don't relocate.
- **Package-level `apps/console/turbo.json`** overrides `gen.inputs` with
  `$TURBO_ROOT$/packages/contracts/aep-api/openapi.yaml` + route files — the
  root task's package-relative inputs would otherwise cache stale gens
  (verified by content-edit → cache-miss).

## Consequences

- `make gen` must run before build/typecheck on a fresh checkout (turbo wires
  this as a task dependency).
- A contract edit fails mocks and client code at typecheck — the drift guard.
