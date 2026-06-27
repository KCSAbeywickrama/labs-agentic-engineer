# AGENTS.md — apps/

React webapps (Vite + Oxygen UI). One package per app; `apps/<name>` →
`@aep/<name>`.

**Status:** nothing here yet. The console lands here as `apps/aep-console/`.

## Conventions

- Feature folders: `features/<feature>/{components,hooks,api,routes}` + a small
  shared `ui/`.
- Request/response types come from `@aep/contracts` — never redefined locally.
- Runtime config via `window._env_` (BFF-owned `env-config.js`); no build-time env.

Commands are the uniform verbs from the root `Makefile` (`make build`, etc.).
