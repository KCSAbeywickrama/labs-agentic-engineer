# AGENTS.md — apps/console-next (`@aep/console-next`)

The agentic-first console: a new app that replaces `apps/console`. Features
move into it one by one, users switch over once, and then the old console is
deleted. The two are never used side by side, so until switch-over this app
runs only as a dev server.

Every decision behind it lives on the wayfinder map "The agentic-first
console" (https://claude.ai/artifact/LhkAvt26fS5XVLniiVyu2F). Its build items
are Phase 6 (N1–N10) of the plan tracker
(https://claude.ai/artifact/JyqAbejCdT6gx2J7mkauLx). Read the map's ticket for
an area before changing it.

## Rules

- **Oxygen UI is the only component library.** Colours come from `aepTheme`
  (`src/theme/`), the prototype's palette over Oxygen's base. Never add raw MUI
  or another kit.
- **Build on MSW, approve, then wire.** Each screen is built against MSW
  handlers and fixtures (`src/mocks/`), approved on the running mock
  (`VITE_API_MODE=mock`), and only then wired to aep-api. The mock cannot show
  whether aep-api maps a new contract field onto the response, so the wiring
  step checks against the real API.
- **Depend only on the contract and existing packages.** Code this app needs
  from `apps/console` is copied in and owned here (auth was), not extracted
  into a new shared package. Nothing here imports from `apps/console`.
- **Tests:** unit tests with Vitest (node; `// @vitest-environment jsdom` per
  file for components). The live end-to-end walk lives in `tests/e2e`.
- Request and response types come from the generated client
  (`src/generated/aep-api.d.ts`, from `pnpm gen`); never redefine them.

## Layout

- `src/auth/`: OIDC sign-in, the session and token handling, copied from the
  console. `src/api/`: the `openapi-fetch` client and its 401 handler.
- `src/features/<feature>/{components,api}`: one folder per area. `shell` is
  the frame (rail, chat slot, main outlet) and the route→scope mapping the
  rail and chat read.
- `src/components/`: app-wide primitives copied from the console
  (`ErrorBoundary`, `EmptyState`).
- `src/routes/`: TanStack file routes; `src/generated/` is codegen, gitignored.
- `src/mocks/`: MSW handlers and fixtures for mock mode. Dev-only; never in a
  production build.
