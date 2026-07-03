# ADR-0002: Frontend stack and app shell

- **Status:** Accepted
- **Date:** 2026-07-03 (decisions from the 2026-07-02/03 scaffold sessions)
- **Context:** the console scaffold needed a stack and a shell; the
  `oxygen-ui` skill (with its bundled sample app) is the design-system
  authority.

## Decision

| Concern | Decision |
|---|---|
| Framework | React 19 + Vite 7 + TypeScript (strict base tsconfig + DOM/jsx overrides) |
| Design system | `@wso2/oxygen-ui` **latest** (0.11.0 at adoption) — bundles MUI/emotion; never install `@mui/material` or emotion directly |
| Routing | **TanStack Router, file-based** (`@tanstack/router-plugin`); route files in `src/routes/` stay thin and import from `features/<feature>/` |
| Server state | TanStack Query (rules in `design/api-guidelines.md`) |
| HTTP client | `openapi-fetch` typed from generated OpenAPI types (ADR-0003) |
| Shell | `src/layouts/AppLayout.tsx` mirrors the skill sample's AppLayout: Header (Toggle/Brand/Spacer/Actions: ColorSchemeToggle + UserMenu), Sidebar with route-synced `activeItem`, `AppShell.Main > Outlet`, Footer with oxygen-ui version |
| Pages | `PageContent > PageTitle.Header/SubHeader/Actions > body` (sample pattern) |

**Deliberate deviations from the skill sample:** TanStack Router instead of
react-router (the sample's `config/appRoutes.tsx` structure is replaced by
file-based routes); `features/<feature>/` folders instead of the sample's
`pages/` (AGENTS.md convention). **Deferred:** NotificationPanel, org/project
switchers, sign-out dialog, auth (401 middleware stubbed in
`src/api/client.ts`).

## Consequences

- TanStack packages (`react-router`/`router-plugin`/`router-cli`) are pinned
  exact and bumped together — their minors don't track each other upstream.
- Known upstream wart: Oxygen UI 0.11.0 `UserMenu.Trigger` leaks a `showName`
  prop to the DOM (dev-only React warning; not our usage).
