# AGENTS.md — apps/aep-console (`@aep/aep-console`)

React SPA console for AEP. Vite + TypeScript + Oxygen UI, talking to the
`aep-api` BFF through the generated OpenAPI client.

**Read before working on any feature:**

- `PRD.md` — the living product picture: what exists, what's planned.
- `design/development-flow.md` — the feature cycle (feature doc → grilling →
  decisions → build → ship → PRD update). Follow it; don't freestyle features.
- `design/design-system.md` — Oxygen UI conventions and which skills to use.
- `design/api-guidelines.md` — data fetching, error handling, user feedback,
  and the mock layer. Three rules are non-negotiable; the rest is judgment
  with a promotion path.

## Layout

- `features/<feature>/{components,hooks,api,routes}` + small shared `ui/`.
- `src/mocks/` — MSW handlers + fixtures, typed against `@aep/contracts`
  generated types. Dev-only; excluded from production builds.
- Request/response types come from the generated OpenAPI client — never
  redefined locally.
- Runtime config via `window._env_` (BFF-owned `env-config.js`).

## Feature docs

- `design/features/<NNN>-<slug>/feature.md` — intent, written at feature start.
- `design/features/<NNN>-<slug>/decisions.md` — grilling outcomes; the record
  future sessions load to understand why things are the way they are.
- `design/decisions/` — post-ship ADRs (repo-wide convention: final state).

Commands are the uniform verbs from the root `Makefile` (`make build`, etc.).
