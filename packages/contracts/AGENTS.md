# AGENTS.md — packages/contracts (`@aep/contracts`)

The single source of truth for service boundaries: **OpenAPI** for REST,
**JSON Schema** for internal events. Consumers import generated artifacts only and
never redefine request/response types.

## Layout

- `openapi/<service>.yaml` — contract per producing service (REST only, no gRPC).
- `events/*.schema.json` — internal event schemas (JSON Schema).
- `src/generated/` — TS client (openapi-typescript). **Gitignored, never hand-edited.**
- `example-server/` — Go module proving the producer rails (oapi-codegen
  `StrictServerInterface` + a trivial handler). `api.gen.go` is gitignored.

## Codegen (wired into the build graph, not run by hand)

- `make gen` runs `openapi-typescript` (TS client) + `go generate` (Go server
  interface via the pinned `oapi-codegen` go tool).
- `build`/`typecheck` depend on `gen`; consumers depend on this package — so a
  contract change forces regeneration and fails consumers that are now wrong.

## Drift guards (the self-correction thesis)

1. Producer compile — handler ↔ `StrictServerInterface` (Go build).
2. Consumer compile — generated TS client (`tsc`); renamed field → typecheck error.
3. Build-graph freshness — `gen` is a prereq of `build`/`typecheck`.
4. CI staleness — `make gen` then `git diff --exit-code`.

**Status:** machinery + one minimal example only. Real per-service contracts are
authored when each service is ported (`plan.md` §10).
