# Agentic Engineer Platform (AEP)

Spec-driven, AI-enhanced software development lifecycle platform — a polyglot
(Go + TypeScript) monorepo with shared contracts, uniform commands, and strict
typing so agents self-correct via type errors.

> **Status: rewrite scaffold.** This branch (`aep-rewrite`) is a clean-slate
> orphan branch that stands up the *structure and the rails*. Real code is ported
> in from `main` later (see [`plan.md`](./plan.md) §10). The branch is grown until
> it fully replaces `main`, then promoted to the default branch.

## Quick start

```bash
make install     # pnpm install + go work sync
make gen         # regenerate contracts (TS clients + Go server interfaces)
make build       # build everything (TS via turbo, Go via go.work)
make test        # run tests
make lint        # eslint + golangci-lint
make typecheck   # tsc + go vet
```

## Layout

```
apps/         React webapps
services/     long-lived deployables (Go + TS)
runners/      one-shot / job images
packages/     shared libraries
  contracts/  OpenAPI + JSON Schema source of truth + codegen
  core/       shared domain logic / pure helpers
  ui/         shared React components (one package per component)
  clients/    hand-written cross-cutting clients
  agent/      shared agent building blocks
docs/         architecture, ADRs, design, guides
deployments/  canonical local setup (k3d + docker-compose)
tests/        e2e (Playwright) + integration (vitest)
```

See [`AGENTS.md`](./AGENTS.md) for the agent-facing overview and [`docs/`](./docs/)
for architecture, ADRs, and guides.
