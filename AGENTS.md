# AGENTS.md — AEP (root)

Agentic Engineer Platform: a polyglot (Go + TypeScript) monorepo. Spec-driven
SDLC platform built on OpenChoreo. **This is the `aep-rewrite` scaffold branch** —
empty-but-wired buckets; real code is ported from `main` later (`plan.md` §10).

## Uniform commands (single entry point: the root `Makefile`)

| Verb | Command | Does |
|---|---|---|
| install | `make install` | pnpm install + `go work sync` |
| gen | `make gen` | regenerate contracts (TS clients + Go server interfaces) |
| build | `make build` | turbo build (TS) + `go build` (go.work) — runs `gen` first |
| dev | `make dev` | start dev servers |
| test | `make test` | turbo test + `go test` |
| lint | `make lint` | eslint + golangci-lint |
| typecheck | `make typecheck` | `tsc` + `go vet` |
| license-check | `make license-check` | fail if any source lacks the Apache header |

## Rules

- **Contracts are the source of truth.** Request/response types come from
  `@aep/contracts` (TS) or the generated Go server interface — never hand-defined.
  Generated code is gitignored (`*.gen.go`, `generated/`) and never hand-edited.
- **One public entry point per package:** `src/index.ts` (TS) / `cmd/<bin>` (Go).
- **npm scope** `@aep/*`; **Go module prefix** `github.com/wso2/labs-agentic-engineer/<bucket>/<name>`.
- Config/env parsing lives in one place per service; add every new var to `.env.example`.
- Each package/bucket has its own `AGENTS.md` (`CLAUDE.md` symlinks to it).

## More

`docs/architecture.md` (overview), `docs/decisions/` (ADRs), `docs/glossary.md`
(domain terms), `docs/developer-guide/` (setup/dev flow), `plan.md` (rewrite plan).
