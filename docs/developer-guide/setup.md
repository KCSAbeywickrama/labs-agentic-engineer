# Developer guide — setup & dev flow

## Prerequisites

- Go 1.26 (auto-downloaded by the toolchain if your local `go` is older;
  `GOTOOLCHAIN=auto`).
- Node 22 LTS + pnpm 10 (`corepack enable` to get the pinned pnpm).
- `make tools` to install pinned Go tools (golangci-lint).

## First run

```bash
make install     # pnpm install + go work sync
make gen         # regenerate contracts (TS clients + Go server interfaces)
make build       # build everything
```

## Uniform verbs

All driven from the root `Makefile` (the single entry point):

| Verb | What it does |
|---|---|
| `make gen` | `openapi-typescript` (TS) + `go generate` (Go) codegen |
| `make build` | turbo build (TS) + `go build` (go.work) — runs `gen` first |
| `make dev` | start dev servers |
| `make test` | turbo test + `go test` |
| `make lint` | eslint + golangci-lint |
| `make typecheck` | `tsc` + `go vet` |
| `make license-check` | fail if any source lacks the Apache header |

## Adding a package

- **TypeScript:** create `packages/<name>` (or `apps/`, `services/`, `runners/`)
  with a `package.json` exposing the uniform scripts. A workspace glob picks it up
  — no tooling edits.
- **Go:** create the module and add one `use` line to `go.work`. The Makefile
  discovers it dynamically.

## Local stack

The canonical local setup (k3d + docker-compose) lives in `deployments/` and is
ported during migration (`plan.md` §10). Until then the scaffold has no runnable
stack.
