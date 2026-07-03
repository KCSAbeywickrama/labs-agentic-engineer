# AEP Console

The web frontend of the Agentic Engineer Platform: a React + TypeScript
single-page app (Vite + Oxygen UI) talking to the `aep-api` BFF through a
generated OpenAPI client. See [`PRD.md`](PRD.md) for what it does and for
whom.

> **Status:** docs-first. The development cycle and design docs are in place;
> the app scaffold lands with the first feature. A quickstart section will be
> added here when `make dev` can actually start the console.

## How development works

Console features are built in **Claude Code sessions** following a fixed
cycle — feature doc → grilling interview → recorded decisions → contract →
mocks → UI → ship. Don't freestyle a feature; start the cycle:

1. Read [`PRD.md`](PRD.md) for the current product picture.
2. Copy `design/features/_template/` to `design/features/<NNN>-<slug>/` and
   fill in `feature.md`.
3. In a Claude Code session, run `/grill-me` on it and follow
   [`design/development-flow.md`](design/development-flow.md) from there.

## Docs map

Start at the top, go down as needed:

| Doc | What it answers |
|---|---|
| [`PRD.md`](PRD.md) | What the console does today; what's in flight |
| [`design/development-flow.md`](design/development-flow.md) | How a feature goes from idea to shipped |
| [`design/design-system.md`](design/design-system.md) | How things should look; which skills to use |
| [`design/api-guidelines.md`](design/api-guidelines.md) | How to call the BFF; the mock layer; error handling |
| [`design/features/<NNN>-*/`](design/features/) | Why each feature is the way it is (`feature.md` + `decisions.md`) |
| [`AGENTS.md`](AGENTS.md) | Entry point for AI sessions (same docs, terser) |

## Commands

The uniform verbs from the root `Makefile`: `make install`, `make build`,
`make dev`, `make test`, `make lint`, `make typecheck`.
