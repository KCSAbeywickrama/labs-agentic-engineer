# Rewrite — Scaffold & Wiring Plan (Agentic Engineer Platform, `aep`)

**What this plan is:** the plan to stand up the *structure and the rails* for the
rewrite — the monorepo skeleton, root tooling, conventions, context files, and the
contract/codegen wiring — as a green, no-op foundation, built fresh at the **repo
root of a clean orphan branch** (no existing code present), that real code is ported
into later.

**What this plan is NOT:** the migration itself. No service is moved, no behavior
changes, no real per-service contract is authored here. Those are a separate,
later **implementation plan** (outlined in §10 so the target is visible, but
explicitly out of scope).

Polyglot (Go + TypeScript), reorganized into a clean monorepo with shared
contracts, uniform commands, and strict typing so agents self-correct via type
errors. §1–§8 describe the **target** the scaffold is built toward; §9 is the only
section this plan actually executes.

---

## Branch & layout strategy (clean-slate, not strangler)

This scaffold is built on a **fresh orphan branch** seeded with an empty commit, so
the repo root starts truly empty — none of today's services, dirs, or tooling are
present. Everything in §9 is created **at the repo root** (including `plan.md`); the
"existing → new mapping" (§1) and the migration (§10) describe code that still lives
on `main`/`rewrite` and is **ported in later**, branch-to-branch.

This replaces the earlier strangler framing (scaffold coexisting with the old tree
on one branch). The benefit: a pristine root with no legacy workspace globs, no dual
`go.work` entries, and no "keep the old code green" constraints during Phase 1. The
cost: the safety net moves from "existing services keep building here" to "each §10
port proves its service builds in the new structure," with the old code's
guaranteed-good state living on `main`/`rewrite`, untouched, the whole time.

**Endgame — this branch becomes `main`.** The rewrite branch is grown until it fully
replaces the current codebase, then it is **promoted to the default branch** (old
`main` is retired/archived). It is never merged back; the orphan history *is* the new
history. This is the intended outcome of choosing an orphan branch.

**Mechanics (feasible today):**

```bash
git checkout --orphan <rewrite-branch>     # new branch, no parent; index still full
git rm -rf .                               # clear the working tree → empty root
git commit --allow-empty -m "chore(aep): empty root for rewrite scaffold"
# build the §9 scaffold at root; author plan.md at root
# port code later with: git checkout main -- <path>   (then reshape into new dirs)
# when complete: make <rewrite-branch> the default branch; retire old main
```

**Record as an ADR (§8):** an orphan branch has *unrelated history* to `main`, so the
cutover is a **default-branch swap**, not a merge (a merge-back, if ever forced,
needs `--allow-unrelated-histories`). For a rewrite meant to supersede the codebase
this is deliberate.

> Note: `deployments/` (the canonical local stack) and anything needed to *run* the
> system are absent until ported, so the stack can't come up during pure-scaffold
> Phase 1. If you want a runnable stack early, make `deployments/` one of the first
> §10 ports.

---

## 0. Scope, goals, non-goals

**Goal.** Create the target tree as empty-but-wired buckets, with the full root
toolchain in place, such that:

- every uniform verb (`build`/`dev`/`test`/`lint`/`typecheck`/`gen`) runs green as
  a no-op across the workspace, and
- the root of the orphan branch holds **only** the new structure — no legacy dirs,
  no retained workspace globs, no `go.work` entries pointing at old modules.

The output is a skeleton you can drop real code into later without touching
tooling — the rails are live, the lanes are empty.

**In scope (this plan):**

- Directory skeleton (§1) as empty buckets, each seeded with its own `AGENTS.md`.
- Root tooling (§2): `pnpm-workspace.yaml`, root `package.json`, `turbo.json`,
  `go.work`, root `Makefile`, `tsconfig.base.json`, eslint + golangci-lint configs,
  `.gitignore`, `.env.example`.
- Pinned conventions (§2), per-package templates (§3), context-file rules (§4).
- Contract **machinery** (§5): the codegen pipeline + build-graph edges + CI guards,
  proven by a single minimal **example** contract that compiles green — not a real
  service's API.
- Uniform verbs wired (§6); code-org **conventions** documented (§7); CI scaffold
  and guardrails (§8).

**Out of scope (deferred to the implementation plan, §10):**

- Porting any service, package, runner, or the console into the new tree.
- Authoring real per-service OpenAPI/contracts and the generated clients that
  replace today's hand-written request/response types.
- The console type-folder → feature-folder refactor.
- Reclassifying `asdlc-service/clients/*` (infra vs. generated).
- Deleting the committed `local-dispatcher` binary.
- Any behavior change.

**Done when:** the Phase 1 exit criteria (§9) are met.

**Decisions deferred to the implementation plan** (called out now so they aren't
lost; this plan does not resolve them):

1. Which of the 14 `asdlc-service/clients/*` are infra clients (→ `packages/clients`)
   vs. service-to-service clients that become generated from contracts
   (`agents`, `database`, …).
2. Contract-authoring approach for services that have **no existing spec today**:
   reverse-engineer current handlers, and reconcile generated types with the
   console's hand-written client types + the inevitable spec/runtime drift.
3. Cutover rules per port — running `main` (old) and the rewrite branch (new) in
   parallel, `go.work` `use`-path additions, `docker-compose.yml` wiring, and the
   rollback path (stay on `main` until a port is proven).
4. Fate of the two `deployments/*` Go modules (`local-secret-manager-api`,
   `local-cluster-gateway-proxy`) in the new layout.
5. Ownership of merging the three skill locations (`asdlc-service/skills`,
   `agents/src/skills`, `remote-worker/plugin/skills/asdlc`) into `packages/agent`,
   untangling SDK-specific bits.
6. Migrating the existing CI (`.cicd/`, `.github/`) and the runner image build/push.

---

## 1. Target repo structure

Created here as **empty buckets** (each seeded with an `AGENTS.md`). Code lands in
them later. The "existing → new mapping" below is the **target-placement reference**
for the implementation plan — this plan does not perform any of those moves.

```
repo/
├── AGENTS.md                     # root context file (canonical); CLAUDE.md imports it
├── CLAUDE.md                     # one line: @AGENTS.md
├── README.md
├── turbo.json                    # JS task graph (pipeline, caching, --filter)
├── pnpm-workspace.yaml           # globs: apps/*, services/*, packages/*, runners/*
├── go.work                       # Go workspace: services/aep-api, services/database, Go packages/*
├── Makefile                      # root verbs that fan out to turbo + go (single entry point)
├── .env.example                  # every env var, documented
├── docs/
│   ├── architecture.md           # system overview, diagrams-as-text, data ownership
│   ├── glossary.md               # domain terms (from current CONTEXT.md)
│   ├── decisions/                # ADRs (ADR-001-why-temporal.md, …)
│   ├── design/                   # per-area design docs
│   ├── developer-guide/          # setup, dev flow, build/run/test
│   ├── operations/               # runbooks (cluster-health, etc.)
│   └── user-guide/
├── requirements/                 # user scenarios (basis for e2e tests)
├── packages/                     # shared libraries (imported, never deployed alone)
│   ├── contracts/                # OpenAPI + JSON Schema source of truth + codegen (§5)
│   ├── core/                     # shared domain logic / pure helpers
│   ├── ui/                       # shared React components — one package per component (§7)
│   ├── clients/                  # hand-written cross-cutting clients (k8s, openchoreo, oauth, …)
│   └── agent/                    # shared agent building blocks (skills, tools, prompts, key-resolver)
├── apps/
│   └── aep-console/              # the React webapp (Vite + Oxygen UI)
├── services/                     # long-lived deployables
│   ├── aep-api/                  # Go BFF + GitHub webhook receiver (includes git ops)
│   ├── database/                 # Go data service
│   ├── agents/                   # TS interactive spec agents (Vercel AI SDK)
│   └── collab/                   # TS Yjs collaboration server
├── runners/                      # one-shot / job images (not long-lived)
│   └── coding-agent/             # TS Claude Agent SDK one-shot pod
├── deployments/                  # CANONICAL local setup — k3d cluster + docker-compose (infra)
├── scripts/                      # one-command dev tasks (setup/start/stop/teardown, codegen)
└── tests/
    ├── e2e/                      # Playwright (browser)
    └── integration/              # API integration against the real cluster (vitest)
```

### Existing → new mapping (reference for the later implementation plan)

| Today | New location | Notes |
|---|---|---|
| `console/` | `apps/aep-console/` | type-folders → feature-folders (§7) |
| `asdlc-service/` (Go BFF + git ops) | `services/aep-api/` | git ops stay folded in; do not split out a git-service |
| `database-service/` (Go) | `services/database/` | |
| `agents/` (TS) | `services/agents/` | Vercel AI SDK |
| `collab-server/` (TS) | `services/collab/` | Yjs |
| `remote-worker/` (TS) | `runners/coding-agent/` | Claude Agent SDK one-shot |
| `ui-components/*` (`@asdlc/*`) | `packages/ui/*` (`@aep/ui-*`) | one package each: explorer, md-editor, excalidraw-editor, cell-diagram-view, openapi-view, project-status, excalidraw-dsl |
| `schemas/progress-event.schema.json` | `packages/contracts/events/` | JSON Schema events |
| `asdlc-service/clients/{k8s,openchoreo,oauth,oidc,secretmanagersvc,…}` | `packages/clients/` | infra clients only; service-to-service clients are generated from contracts (classification deferred, §0) |
| `agents/src/skills`, `asdlc-service/skills`, the `asdlc` skill | `packages/agent/` | shared agent building blocks |
| `docs/design/*` | `docs/design/` + `docs/decisions/` | promote ADRs |
| `CONTEXT.md` | `docs/glossary.md` | |
| `deployments/` | `deployments/` | unchanged location |
| `requirements/` | `requirements/` | unchanged location |
| `tests/` | `tests/{e2e,integration}/` | + per-package unit/integration |
| `local-dispatcher` (committed binary) | removed from VCS | build from source or fetch in `scripts/` |
| `Makefile` (license headers) | folded into root `make license` | |

---

## 2. Tooling

- **JS graph:** pnpm workspaces + **Turborepo** (caching, `--filter`, task deps).
  All TS packages live in one workspace.
- **Go graph:** a single **`go.work`** spanning the Go modules, so a change in a
  shared Go package is picked up on the next build with no `replace` directives.
- **Single entry point:** a root **`Makefile`** exposing the uniform verbs (§6)
  that fan out to `turbo run <task>` and `go` per package. This is how Go
  packages get the same script names without a `package.json`.

### Pinned conventions

| Concern | Decision |
|---|---|
| npm scope | `@aep/*` (e.g. `@aep/contracts`, `@aep/core`, `@aep/ui-explorer`) |
| Go module prefix | `github.com/wso2/labs-agentic-engineer/<bucket>/<name>` |
| Go workspace `go` directive | `1.26` |
| Node | 22 LTS (`engines.node >=22`) |
| pnpm | 10 (root `packageManager: pnpm@10`) |
| Turborepo | 2.x (root devDependency) |
| TS package dir vs name | dir `packages/ui/explorer` → name `@aep/ui-explorer`; bucket prefix in the name only for `ui/*` |
| Generated code | gitignored; marked `*.gen.go` / `generated/`; never hand-edited |

---

## 3. Per-package structure

Templates the scaffold seeds and that migrated code later conforms to.

**TypeScript package** (apps, TS services, `packages/ui/*`, runners):

```
<package>/
├── AGENTS.md            # ≤40 lines: what this is, commands, rules; link out for detail
├── CLAUDE.md -> AGENTS.md
├── README.md            # purpose, ownership, links
├── package.json         # name + uniform scripts: dev/build/test/lint/typecheck
├── tsconfig.json        # extends root config; project references for in-repo deps
├── src/index.ts         # single public entry point / exports
└── tests/{unit,integration}/
```

**Go package** (`aep-api`, `database`, Go `packages/*`):

```
<package>/
├── AGENTS.md            # ≤40 lines
├── CLAUDE.md -> AGENTS.md
├── README.md
├── go.mod               # member of go.work
├── Makefile             # uniform verbs (dev/build/test/lint/typecheck)
├── cmd/<bin>/main.go    # entry point(s)
├── internal/            # private packages
└── (layered: api/ routes, services/ domain, repositories/, clients/, models/)
```

One public entry point per package: `src/index.ts` (TS), `cmd/<bin>` (Go).

---

## 4. Context files

- One canonical file per level: **`AGENTS.md`**, with `CLAUDE.md` importing it via
  `@AGENTS.md`, at every package and the root.
- **Root `AGENTS.md`:** short — system overview + uniform commands + links into
  `docs/`. Well under 40 lines; detail lives in `docs/`.
- **Nested `AGENTS.md`:** ≤40 lines, package-local (what it is, its commands, its
  rules), linking to design docs for anything longer.

`packages/agent` is intended to hold only the SDK-agnostic surface (skills, tool
schemas, prompt fragments, `anthropic-key-resolver`, shared types). SDK-specific
wiring stays in each consumer — the spec agents use the Vercel AI SDK, the
coding-agent runner uses the Claude Agent SDK. (The actual consolidation is
implementation work, §0 / §10.)

---

## 5. Contracts (OpenAPI-first, REST only — no gRPC)

This plan stands up the **machinery and the guards**, proven with one minimal
**example** contract. Authoring the real per-service contracts is implementation
work (§10).

**Source of truth (target convention):** OpenAPI for REST boundaries, JSON Schema
for internal events. Each service owns the contract it produces, stored as
`packages/contracts/<service>/openapi.yaml`; consumers import generated artifacts
only and never redefine request/response types.

**Codegen, wired into the build graph (not run by hand):**

- **Go producer** → strict server interface (oapi-codegen `StrictServerInterface`).
  The handler implements it, so any drift is a compile error in the producing
  service. Request/response validation middleware (kin-openapi) runs in dev/test.
- **TS consumer** → typed client (`openapi-typescript`/orval); using a
  removed/renamed field is a typecheck error.
- **Go consumer** (service-to-service) → typed Go client, same idea.
- zod, where a TS service wants runtime validation, is derived from the OpenAPI
  (`openapi-zod-client`), never authored independently.

**Mismatch is caught by:**

1. Compile-time at the producer (strict server interface).
2. Compile-time at consumers (generated clients).
3. Build-graph freshness — every consumer's `build`/`dev`/`typecheck` depends on
   `contracts#gen` (Turbo dep edge / Go `go generate` prestep), so a contract
   change forces consumers to regenerate and fail if now wrong.
4. CI runs `gen` then `git diff --exit-code`. Because generated code is gitignored,
   a hand-edit to a generated file cannot persist in VCS — `gen` overwrites it on
   the next run (a stronger guarantee than a diff). The `git diff` then catches any
   drift `gen` introduces in *tracked* files (a touched source, lockfile churn).
5. An end-to-end contract test runs the real server against its own OpenAPI
   (schemathesis/dredd) to catch off-spec runtime behavior.

Generated code is gitignored and produced as a build/dev prestep. Generated dirs
are clearly marked (`*.gen.go`, `generated/`) and never hand-edited.

---

## 6. Feedback loops (uniform verbs)

Every package exposes the same verbs via `package.json` scripts or `Makefile`; the
root tool fans out. In this plan they resolve to green no-ops over empty buckets.

| Verb | TS | Go | Root |
|---|---|---|---|
| `dev` | `vite` / `tsx watch` | `go run ./cmd/...` | `make dev` / `turbo dev` |
| `build` | `tsc -b` / bundler | `go build` | `make build` |
| `test` | `vitest` | `go test ./...` | `make test` (filter: `turbo test --filter <pkg>`) |
| `lint` | eslint | golangci-lint | `make lint` |
| `typecheck` | `tsc --noEmit` | `go vet` / build | `make typecheck` |
| `gen` | codegen | `go generate` | `make gen` |

Strict typing + linting everywhere — type errors are the agent's self-correction
signal.

---

## 7. Code organization (conventions)

Documented here as the rules migrated code follows; this plan does not refactor any
existing code to match.

1. Small, focused, descriptively-named files — no giant `utils` files.
2. Clear layering, no skipping: **routes → domain → repositories**. Routes are
   thin (parse request, call domain, map errors — no logic).
3. **Feature folders in the webapp:** `features/<feature>/{components,hooks,api,routes}`
   with a small shared `ui/`. (The console's type-folder → feature-folder migration
   is implementation work, §10.)
4. One public entry point per package (`src/index.ts` / `cmd/<bin>`).
5. Config/env parsing in one place per service (`config.ts` / `config/`); add
   every new var to `.env.example`. Domain code never reads env directly.
6. Request/response types come from `@aep/contracts` — never redefined locally.
7. `packages/ui` is multiple packages — one per component — not a single bundle.

---

## 8. Guardrails / CI

The scaffold establishes these as green no-ops; they bite once real code arrives.

1. **ADRs** in `docs/decisions/` for every non-obvious choice.
2. **Strict CI:** typecheck, lint, tests, contract validation (`gen` +
   `git diff --exit-code` + the schemathesis/dredd contract test), and the
   license-header check (`make license-check`).
3. **Affected-only CI** via Turbo / `go list`, so PRs rebuild/test only what
   changed.
4. **Platform-touching changes** (OC primitives, OC client, deployments, secrets,
   ingress, auth) go through `platform-design-expert` review.

---

## 9. Execution — Phase 1: scaffold the tree + tooling (THIS plan)

This is the entirety of what this plan executes. Built on a **fresh orphan branch**
(empty initial commit, see "Branch & layout strategy") so the root starts empty —
keep the workspace green throughout. **No code is ported, no behavior changes.**
Existing code stays on `main`/`rewrite`, untouched.

> **Phase 1 status: ✅ COMPLETE** (branch `aep-rewrite`). All six verbs pass on a
> cold run (`make gen build typecheck test lint license-check`); `pnpm install
> --frozen-lockfile` and `go work sync` are clean. The full acceptance suite below
> was run and passes: workspace integrity, build-graph (cache hit, `--filter`
> scoping, the contracts→consumer dep edge), the drift guards (#1 producer build,
> #2 consumer typecheck, #4 staleness), and the extensibility smoke. Deferred to
> §10 (need real code): guard #5 (schemathesis/dredd runtime test) and real
> per-service contracts.
>
> **Implementation decisions recorded** (ADR-0001/0002, `docs/decisions/`):
> - `go 1.26` throughout; oapi-codegen pinned via the go.mod **`tool`** directive.
> - **golangci-lint v2.12.2 built with the go1.26 toolchain** (`make tools`) — a
>   binary built with an older Go refuses to analyze a `go 1.26` module.
> - TS client generated under **`src/generated/`** (not a sibling `generated/`), so
>   `tsc`'s rootDir stays `src` and `dist/index.d.ts` resolves for consumers.
> - **`go.work.sum` committed** for workspace reproducibility.
> - `deployments/` + `.claude/` are preserved **untracked** on the branch (local
>   secrets/settings); they are ported/decided in §10.

**Root files:**

- [x] Orphan branch seeded with an empty commit; `plan.md` authored **at the repo
      root** (moved out of `rewrite/`).
- [x] `pnpm-workspace.yaml` — globs `apps/*`, `packages/*`, `packages/ui/*`,
      `services/*`, `runners/*`. No legacy paths — the old TS packages aren't on
      this branch.
- [x] `package.json` (root, `private: true`) — `packageManager: pnpm@10`,
      `engines.node >=22`, `devDependencies: { turbo }`; no app deps.
- [x] `turbo.json` — pipeline for `build`, `dev`, `test`, `lint`, `typecheck`,
      `gen`; `build`/`typecheck` depend on `^build` and on `gen` (the contracts
      edge, §5).
- [x] `go.work` — `go 1.26`; starts with **only the example contract's Go module**
      (plus any Go `packages/*` seeded here). Real service modules are added by their
      §10 port, not now.
- [x] `Makefile` — root verbs (§6) fanning out to `turbo run <task>` (TS) and a
      `go` loop over `go.work` members.
- [x] `tsconfig.base.json` — shared strict compiler options; per-package
      `tsconfig.json` extends it. Cross-package types resolve via package `exports`
      + Turbo `^build` ordering (no TS project references).
- [x] root eslint (flat) + golangci-lint config.
- [x] `.gitignore` — generated dirs (`*.gen.go`, `generated/`, `dist/`,
      `node_modules/`).
- [x] `.env.example` — placeholder; grows as services move.
- [x] root `AGENTS.md` + `CLAUDE.md` (one line: `@AGENTS.md`) (system overview +
      uniform commands + links into `docs/`).

**Directory skeleton** (empty buckets, each seeded with its own `AGENTS.md`):

- [x] `apps/`, `services/`, `packages/{contracts,core,ui,clients,agent}/`,
      `runners/`, `scripts/`, `tests/{e2e,integration}/`.
- [x] `docs/{architecture.md,glossary.md,decisions/,design/,developer-guide/,operations/,user-guide/}`
      — move `CONTEXT.md` → `docs/glossary.md`; seed `docs/decisions/ADR-0001`
      recording the tooling + naming decisions from §2.

**Contract rails (machinery only, §5):**

- [x] Wire `contracts#gen` into the Turbo graph + a Go `go generate` prestep, and
      the CI `gen` + `git diff --exit-code` guard.
- [x] Prove the rails with **one minimal example contract** in
      `packages/contracts/` that generates a Go server interface (**+ a trivial
      handler implementing it**) and a TS client, all compiling green — enough to
      exercise every compile-time guard in the acceptance checks below. (Not a real
      service API — that's §10.)

**Exit criteria:**

- [x] `pnpm install` clean; `go work sync` clean.
- [x] `make build && make lint && make test && make typecheck && make gen` all pass
      as green no-ops (nothing moved yet).
- [x] The old code on `main`/`rewrite` is untouched (this branch never modified it).

### Acceptance — flows to verify after implementation

These expand the exit criteria into concrete, runnable checks. All are
tooling / wiring / regression flows — no product behavior changed, so existing app
flows stay verified by their existing suites, unchanged.

**Toolchain fan-out & workspace integrity**

- [x] Fresh clone → `pnpm install` clean and `go work sync` clean; lockfile
      unchanged afterward.
- [x] `make build`, `make test`, `make lint`, `make typecheck`, `make gen` each
      exit 0 as green no-ops; `make dev` starts without error.
- [x] `make license-check` passes.
- [x] Root + every bucket has an `AGENTS.md` with a `CLAUDE.md` that imports it
      via `@AGENTS.md`.

**Build-graph behavior**

- [x] `turbo run build` twice → the second run is a full cache hit.
- [x] `turbo run test --filter <pkg>` scopes to that package only.
- [x] Touching `packages/contracts` forces consumers to re-run `gen` before
      `build`/`typecheck` (the dep edge fires).
- [x] With `go.work` present, each existing Go module still `go build`s and
      `go work sync` doesn't alter any module's behavior.

**Contract drift guards (the headline — proves the self-correction thesis)**

Using the example contract + trivial handler from §9:

- [x] `make gen` regenerates the Go server interface + TS client; both compile green.
- [x] Rename/remove a field in the example OpenAPI → consumer `typecheck` fails
      (guard #2, compile-time at consumers).
- [x] Change the handler off the `StrictServerInterface` → producer build fails
      (guard #1, compile-time at producer).
- [x] Staleness (guard #4): a hand-edit to a generated file is overwritten by the
      next `make gen` (generated code is gitignored, so it can't persist in VCS);
      `make gen` then `git diff --exit-code` stays clean over tracked files.

**Extensibility smoke (rails ready for the real moves)**

- [x] Drop a throwaway package into `packages/core` (and a throwaway Go module into
      `go.work`) → adopted by pnpm/turbo/go.work with **zero tooling edits** and
      passing all verbs. Remove afterward.

**Regression — old code untouched (the safety claim)**

- [x] `main`/`rewrite` still build and run the full stack exactly as before — this
      orphan branch shares no files with them, so there is nothing to regress. The
      old code is the rollback target until the §10 ports complete and the branch is
      promoted to default.

**Not yet verifiable (needs real code — §10):** real API contract against a real
handler; the schemathesis/dredd runtime contract test (guard #5); generated clients
replacing hand-written types; the console feature-folder structure.

---

## 10. Out of scope — later implementation phases (outline only)

Listed so the target is visible. **Not part of this plan** — each needs its own
detailed spec (per-item checklists, exit criteria, cutover/rollback) before it runs,
and must first resolve the deferred decisions in §0. On the clean branch these are
**ports from `main`/`rewrite`** (`git checkout main -- <path>`, then reshape into the
new tree), not in-place moves. The final phase **promotes this branch to the default
branch** and retires old `main`.

- **Deployments early.** Port `deployments/` (and `scripts/`) first if you want a
  runnable stack on this branch before the services land.
- **Contracts first.** Author the real `aep-api` OpenAPI end-to-end and prove the
  compile-time mismatch guards against actual handlers + the console client.
- **Leaf packages.** Port low-blast-radius libs: `packages/ui/*`, `core`,
  `clients`. Rename `@asdlc/*` → `@aep/ui-*`; add each Go module to `go.work`.
- **Services.** Port one at a time (`aep-api`, `database`, `agents`, `collab`),
  adding the `go.work` `use` path and wiring `deployments/docker-compose.yml` per
  service. Keep `main` deployable as the parallel-run rollback target.
- **Console.** Last (also the type-folder → feature-folder refactor, §7).
- **Cleanup.** Don't carry over the committed `local-dispatcher` binary; replace
  with a build/fetch step in `scripts/`.
- **Cutover.** Once everything is ported and green, make the rewrite branch the
  default branch and archive old `main`.
