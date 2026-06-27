# AGENTS.md — packages/core (`@aep/core`)

Shared domain logic and pure helpers imported across services. No I/O, no
framework coupling — keep it pure and well-typed.

**Status:** seeded with one cross-package example (`describeWidget`) that consumes
`@aep/contracts` to prove the build-graph contract edge fires across packages.
Real shared logic lands as services are built.

## Conventions

- One public entry point: `src/index.ts`.
- Small, focused, descriptively-named files — no giant `utils`.
- Types from `@aep/contracts` — never redefined locally.
