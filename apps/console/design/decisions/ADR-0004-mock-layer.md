# ADR-0004: Mock layer

- **Status:** Accepted
- **Date:** 2026-07-03 (decisions from the 2026-07-02/03 grilling + scaffold)
- **Context:** the console must be fully developable and demoable without a
  running backend, without mocks drifting from the contract.

## Decision

- **MSW** intercepts the generated client's requests in the browser; app code
  is identical in mock and real mode.
- **Handlers/fixtures are typed against the generated OpenAPI types**
  (`src/generated/aep-api.d.ts`) — contract drift is a typecheck failure, not
  a broken demo. Hand-rolled untyped JSON fixtures are forbidden.
- **Handlers match `*/api/v1/...`** (wildcard prefix) so the runtime API base
  URL can change freely.
- **Every feature's handlers expose scenarios** — at minimum empty, populated,
  and error — switched via `localStorage['aep:mock:<feature>']`, so the
  empty/loading/error states doctrine is buildable and testable.
- **Dev-only:** `VITE_API_MODE=mock` enables MSW; the dynamic import is
  guarded by `import.meta.env.DEV`, so mock code is eliminated from
  production bundles (verified). `public/mockServiceWorker.js` is committed;
  re-run `msw init public/` on msw upgrades.

## Consequences

- UI tests run against mocks; a small smoke suite runs against the real BFF
  before ship.
- Rejected at grilling: Prism mock server (can't script stateful/error
  scenarios), fake client behind DI (skips the real HTTP path).
