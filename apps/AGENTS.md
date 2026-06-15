# AGENTS.md — apps/

React webapps (Vite + Oxygen UI). One package per app; `apps/<name>` →
`@aep/<name>`.

**Status:** empty bucket. The console is ported here last (`apps/aep-console/`,
`plan.md` §10) — together with the type-folder → feature-folder refactor.

## Conventions

- Feature folders: `features/<feature>/{components,hooks,api,routes}` + a small
  shared `ui/`.
- Request/response types come from `@aep/contracts` — never redefined locally.
- Runtime config via `window._env_` (BFF-owned `env-config.js`); no build-time env.

Commands are the uniform verbs from the root `Makefile` (`make build`, etc.).
