# Console

The web frontend of the Agentic Engineer Platform: a React + TypeScript
single-page app (Vite + Oxygen UI) talking to the `aep-api` BFF through a
generated OpenAPI client. See [`PRD.md`](PRD.md) for what it does and for
whom.

## Quickstart

```bash
make install                                   # pnpm install + go work sync (repo root)
make gen                                       # generated API types + route tree
VITE_API_MODE=mock pnpm --filter @aep/console dev   # http://localhost:8090, no backend needed
```

Mock scenarios: `localStorage.setItem('aep:mock:projects', 'empty' | 'some' | 'error')`.
Against a real BFF: `pnpm --filter @aep/console dev` (proxies `/aep-api-service`
to `API_PROXY_TARGET`, default `http://localhost:9090`).

## How development works

Console features are built in **Claude Code sessions** following a fixed,
issue-driven cycle — grilling interview → feature issue (durable decisions
become ADRs) → contract → mocks → UI → ship
(spec: [`design/development-flow.md`](design/development-flow.md)). Don't
freestyle a feature — start every one with the `/console-feature` skill,
passing it the idea in plain words:

```
/console-feature I want the project list to show each project's environments
```

It reads the PRD and ADRs, runs the grilling interview on the idea (the
`/grill-me` session), then drafts the feature issue from the template with
the decisions in the body, creates it with `gh` (labels `console` +
`feature`, upstream repo) once you approve the draft, and asks at each
following stage whether to continue: graduate ADRs, open the BE handshake
issue if the contract changes, mark the PRD in-flight, build (contract →
`make gen` → mocks → UI in mock mode), and ship. Stop at any checkpoint and
pick the feature back up later with the issue number:

```
/console-feature 42
```

## Docs map

Start at the top, go down as needed:

| Doc | What it answers |
|---|---|
| [`PRD.md`](PRD.md) | What the console does today; what's in flight |
| [`design/development-flow.md`](design/development-flow.md) | How a feature goes from idea to shipped |
| [`design/design-system.md`](design/design-system.md) | How things should look; which skills to use |
| [`design/api-guidelines.md`](design/api-guidelines.md) | How to call the BFF; the mock layer; error handling |
| [`design/decisions/`](design/decisions/) | ADRs — the durable conventions and why (feature history lives in GitHub issues) |
| [`AGENTS.md`](AGENTS.md) | Entry point for AI sessions (same docs, terser) |

## Commands

The uniform verbs from the root `Makefile`: `make install`, `make build`,
`make dev`, `make test`, `make lint`, `make typecheck`.
