# services/aep-api — Target directory & file structure

> The end-state layout (assuming refactors) and its test-tier mapping — self-contained, no need to read the improvement-plan history to follow it. Test-tier detail defers to [`bff-component-testing.md`](./bff-component-testing.md) (in-process tiers) and [`backend-testing.md`](./backend-testing.md) (integration). Historical rationale for *why* each change matters lives in [`aep-api-readability-maintainability.md`](./aep-api-readability-maintainability.md) (now mostly shipped) — not required reading here.

## Overview

This is the target layout for `services/aep-api`. It is **not a rewrite** — it's the current tree with the half-finished flat→vertical migration finished. Two rules generate the whole thing:

1. **Nothing outside `cmd/` is importable by another module** → every package lives under `internal/`. On a service binary (never consumed as a library) the top-level `models/`, `repositories/`, `middleware/`, `clients/`, `config/`, `database/`, `api/`, `utils/` are all needlessly public. Moving them under `internal/` is what lets `internal/arch` police the whole graph instead of half of it.
2. **A feature owns its whole vertical** — transport → logic → persistence → errors live in *one* folder, so a change touches one directory. No horizontal `models/`/`repositories/` layer that every slice reaches across.

## Target tree

```
services/aep-api/
├── cmd/
│   ├── aep-api/main.go          # ~30 lines: load+validate cfg, open db, app.Bootstrap(ctx), app.Build(), serve, shutdown. NO wiring.
│   └── openapigen/main.go       # `make openapi`: dumps the code-first spec to build/ (gitignored) for offline tooling.
│                                #   NOT a source of truth — Huma serves the live spec at /openapi.yaml, no drift guard.
│
├── internal/
│   ├── app/                     # THE composition root. Two entry points, not one constructor:
│   │                            #   Build(cfg, db) (*App, error) → {Handler, Watchers []Watcher, Shutdown} = pure assembly.
│   │                            #   Bootstrap(ctx) = the imperative first-boot steps main does before serving: migrations,
│   │                            #   RunBootstrapGrants, the seed dance (seed → RELOAD github app), credValidator start.
│   │                            #   Don't bury those state mutations in Build(). Shutdown owns the shared watcherCtx cancel.
│   │                            #   NOTE: buildApp shipped in cmd/aep-api/app.go (package main); it MUST move here —
│   │                            #   componenttest can't import package main, and reusing this graph IS the component tier.
│   │
│   ├── api/                     # HTTP boundary (was top-level api/). Huma surface + route mounting only, no business logic.
│   │   ├── surfaces.go          #   mountSurfaces: the single mount site — public /api (jwt+ensureOrg) vs internal
│   │   │                        #   /internal/v1 (S2S) vs raw webhook/connect-callback/dev/task-bearer. Whole boundary, one screen.
│   │   ├── huma_register.go     #   one RegisterAllHuma list, reused for handler mount + a nil-deps registration/spec
│   │   │                        #   guard test (drift-guard + committed specs removed; Huma serves the spec live).
│   │   ├── internal.go          #   the internal (S2S) Huma API surface — distinct from the public one.
│   │   ├── webhook_routes.go    #   raw (non-Huma) webhook receiver mount.
│   │   ├── org_github_routes.go #   GitHub App connect-callback mount.
│   │   ├── dev.go               #   dev-only surfaces (compiled/mounted only in dev).
│   │   ├── response_helpers.go  #   shared response/error writers.
│   │   └── *_test.go            #   gate/guard/invariant tests that protect the boundary (drop the dead ones once the arch-lock DFS check lands)
│   │
│   ├── feature/<feature>/       # vertical slices — the unit of change. One package per feature, no subpackages
│   │   │                        #   (keeps arch test's exact-path import checks un-evadable).
│   │   │                        #   REQUIRED spine: *_huma.go + *_service.go. Everything below is add-when-needed.
│   │   ├── <feature>_huma.go    #   TRANSPORT: Huma register + request/response structs + input→domain mapping.
│   │   │                        #   Only *_huma.go files import huma (a feature may have several: board_huma.go,
│   │   │                        #   task_internal_huma.go for a sub-surface or S2S surface). Org from OrgScopedInput, never body.
│   │   ├── <feature>_service.go #   DOMAIN LOGIC: pure-ish, takes a *gorm.DB / client ports, zero huma import.
│   │   │                        #   Constructor returns the CONCRETE type, not a re-widenable interface.
│   │   ├── store.go             #   OPTIONAL persistence: name a feature's gorm queries store.go WHEN you fold in an
│   │   │                        #   existing repository — gated on friction, not now. Most features keep gorm inline.
│   │   ├── ports.go             #   OPTIONAL: the collection file for the interfaces THIS feature needs from others, WHEN it
│   │   │                        #   has several (task/codingagent already do). A single local port stays inline in its
│   │   │                        #   consumer file — that's idiomatic Go and how OrgPublisher/taskTokenIssuer live today.
│   │   ├── errors.go            #   OPTIONAL sentinel errors (4/15 features have them). Map to HTTP via one shared helper (dedupe the 4 duplicate OC-error mappers).
│   │   ├── ...                  #   big features add sub-surfaces, projector.go, *_stream.go (SSE), watchers — no canonical slot.
│   │   └── *_test.go            #   unit + component + dbtest (the DB ones skip under -short) against the real constructor.
│   │
│   ├── contracts/               # stdlib-only cross-feature leaf (unchanged). Breaks task↔codingagent, design↔task.
│   │                            #   Imports only context/errors. This is the seam that keeps slices acyclic — protect it.
│   │
│   ├── domain/                  # shared entities ONLY (was top-level models/; the "domain" rename is OPTIONAL — see below).
│   │                            #   The ~10 types that genuinely cross slices STAY here (GitRepository, ComponentTask,
│   │                            #   DesignComponent — the last is used by 6 features). Single-feature types move INTO their
│   │                            #   slice — but note models/design.go mixes Design (moves) with DesignComponent (stays), so
│   │                            #   it's a file SPLIT, not a clean move, and design/ still imports domain. Free funcs move
│   │                            #   out (wp_naming→k8sname). Do NOT shatter the shared core — that re-creates broken cycles.
│   │
│   ├── platform/                # shared infra leaves. Each has ONE clear job and a real reason to be shared.
│   │   ├── auth/                #   THE single auth home. Folds middleware/{jwt,jwtassertion,task_bearer,
│   │   │                        #   auth_token}, internal/auth/scope, internal/platform/tenant. One S2S verifier,
│   │   │                        #   one Caller output type. No second package also named "auth".
│   │   ├── httpkit/             #   HTTP error writers + slug/uuid validators (fold utils/validate here or keep as validate/).
│   │   ├── humakit/             #   Huma building blocks: OrgScopedInput, ErrorFromStatus. The by-construction org-scope guard.
│   │   ├── obs/                 #   logging + correlation-id (folds middleware/correlation_id — one home, not a wrapper).
│   │   ├── k8sname/             #   k8s naming helpers (absorbs models/wp_naming).
│   │   ├── dbtest/              #   DB harness redesigned: dbtest.New(t) → testcontainers Postgres + pgtestdb template-clone
│   │   │                        #   (one migrated template per run, ms-cheap clone per test). Skips under -short. See DB testing below.
│   │   ├── componenttest/       #   NEW in-process harness (per bff-component-testing.md): assembles the REAL /api handler
│   │   │                        #   via app.Build with faked-auth middleware + gate in ENFORCE; drives it with httptest.
│   │   └── gittest/             #   NEW real-git harness: bare-repo origin in t.TempDir() (file:// remote) + a Git-Data-API
│   │                            #   httptest server backed by the same bare repo. No Docker — fast lane. See Git testing below.
│   │
│   ├── credentials/             # deep module (unchanged). Polymorphic Credential; OpenBao confined by import_fence_test.go.
│   ├── clients/                 # external integrations (moved under internal/). ONE house style — see below.
│   ├── database/                # connection + migrations/ registry: RunAll(ctx,db,tier) over an ordered {name,fn} slice
│   │                            #   instead of 19 copy-pasted blocks in main.
│   ├── config/                  # config load + Config.Validate() at the boundary. One table-driven config_test.go.
│   ├── seed/                    # first-boot seeding (unchanged).
│   └── arch/                    # the boundary lock, made honest: DFS-acyclic feature graph, os.ReadDir the
│                                #   feature list, and actually wired into `make test` via go.work.
│
├── clients/  → internal/clients # (see above) house style: Config in, interface out, (T,error), no panic, no (nil,nil).
│   ├── openchoreo/              #   the TEMPLATE: shared transport + sentinel errors + sealed gen/ (fence-tested) + moq mocks.
│   ├── github/                  #   git-host provider impl (REST + Projects-v2 GraphQL folded inside) behind gitrepo's
│   │                            #   provider ports; selected by GIT_PROVIDER. See "Git testing + the git-provider seam" below.
│   └── <svc>/                   #   each client mirrors openchoreo's shape; route HTTP through httpkit+RetryableHTTPClient.
│
├── skills/                      # go:embed'd builtin skills — STAYS top-level (embed paths are relative to the source file).
├── design/                      # per-package design notes / ADRs written after a feature ships (per AGENTS.md).
├── AGENTS.md · Makefile · Dockerfile · go.mod
```

## Shared module reference

> Grep- and read-verified snapshot of each shared/kernel directory, as of 2026-07-01. "Target vs today" only claims a change is shipped when it's confirmed absent/present on disk — everything else below is still a plan, not a fact about the current tree. File:line citations are checkpoints for a reviewer, not a promise they won't drift.

### Composition root (`cmd/` — target `internal/app`)

- **Purpose**: the single assembly site — builds the app graph (handler + watchers) and drives process lifecycle; no business logic.
- **Lives here today**: `cmd/aep-api/main.go` (140 lines) — load/validate `config`, open DB, run `migrations.RunBootstrapGrants`+`RunAll`, call `buildApp`, serve, start watchers, handle shutdown signals; `cmd/aep-api/app.go` (798 lines, `package main`) — `buildApp(cfg, db) (*App, error)` (app.go:88) wires all 14 features + clients + repositories into one `http.Handler` + `[]watcher`; `cmd/openapigen/main.go` (57 lines) — dumps the live Huma spec to `build/` for offline tooling, no drift guard.
- **Boundary**: `package main` is unimportable, so nothing consumes `cmd/aep-api`; it imports `api`, all 14 `internal/feature/*` packages, `models`/`repositories` (the flat kernel), `middleware`, `clients/*`. Arch-locked: `arch_test.go:101-111`, part of `TestNoFlatServicesOrControllers` (arch_test.go:74), fails if `/cmd/aep-api` imports the deleted `controllers`/`services` packages.
- **Interactions**: `main.go:79` calls `buildApp`; sole caller (only two references to `buildApp(` in the service: its definition and this call). `app.go` calls into every feature's constructor and `repositories.New*Repository(db)` (app.go:101-103).
- **Tests**: none in `cmd/aep-api/` today — no `*_test.go` present. `buildApp` is unexported in `package main`, so nothing outside `main` can call it either; it currently has zero direct or transitive test coverage.
- **Target vs today**: the composition-root extraction shipped 2026-07-01 — `buildApp` extraction, `migrations.RunAll`, `Config.Validate()` are DONE, shrinking `func main`'s body from ~960 to ~86 lines (today's `main.go` file is 140 lines total once imports/license header/`setupLogger` are counted back in). The `internal/app` package with a `Build`/`Bootstrap` split (this doc's target) is an explicit **gated deviation, not yet built** — `buildApp` still lives in `package main`, blocking `componenttest` (which can't import `main`).

### HTTP boundary (`api/` — target `internal/api`)

- **Purpose** — mounts every HTTP surface (public Huma, internal S2S Huma, raw webhook/connect-callback/dev/JWKS) onto one handler graph; the single screen answering "what's exposed, who guards it."
- **Lives here today** — top-level `api/` (not yet under `internal/`), 1306 LOC incl. tests: `app.go` (128) `AppParams`+`NewHandler`, global middleware stack; `surfaces.go` (139) `mountSurfaces` — the mount-site table (surfaces.go:57); `huma.go` (96) `newHumaAPI`/`registerHumaDocs`, OpenAPI+docs; `huma_register.go` (100) `HumaDeps`+`RegisterAllHuma`, public-feature registration list; `internal.go` (77) `InternalDeps`+`RegisterAllInternal` — the S2S surface (task skills, credentials refresh); `webhook_routes.go`/`org_github_routes.go` (37 each) GitHub HMAC + connect-callback mounts; `dev.go` (139) `/_dev/v1` SM-API resync, dev-tier gated; `response_helpers.go` (56) shared JSON/error writers.
- **Boundary** — imports `internal/feature/*`, `internal/platform/{auth,humakit,tenant}`, `middleware/*`, `config`, `repositories`, `clients/openchoreo`; imported only by `cmd/aep-api/app.go:29` and `cmd/openapigen/main.go:28` (grep-confirmed, nothing in `internal/`/`clients/`/`config/` imports it back). `internal/arch/arch_test.go:103` locks the `/api` half against re-importing deleted `controllers`/`services`; no lock yet for the still-pending `internal/`-only move.
- **Interactions** — `cmd/aep-api/app.go:668-722` builds `AppParams`/`HumaDeps`/`InternalDeps`, calls `api.NewHandler`; `cmd/openapigen/main.go:41-42` calls `GenerateOpenAPIYAML`/`GenerateInternalOpenAPIYAML` for `make openapi`.
- **Tests** — `huma_guard_test.go` (`TestNoClientSuppliedOrg`, IDOR lock over `_huma.go`); `huma_registration_test.go`/`internal_test.go` (both specs register without dup-op panics, right ops/schemes); `jwks_routes_test.go` (JWKS reachable, ungated); `gate_invariant_test.go` scans `*_routes.go` for raw gated registrations — passes vacuously today, no gated prefix appears there; `test_helpers_test.go` is a bare PEM-encode helper.
- **Target vs today** — `gate_invariant_test.go` is flagged for deletion as part of the arch-lock honesty work (unshipped); the `api/`→`internal/api` move is listed under "what moves" below (Low-Medium ROI, do when touching arch) — unshipped, still top-level.

### `internal/contracts` — cross-feature cycle-breaking leaf

- **Purpose** — owns the canonical task-lifecycle algebra plus the DTOs/hook interfaces two mutually-suspicious features need to talk without importing each other's concrete package.
- **Lives here today** — 5 files, 401 LOC (332 non-test): `task_state.go` (180) — `TaskStatus`/`TaskEvent` enums, `allowedTransitions` table, `ApplyTaskEvent`, `EventCause`; `hooks.go` (33) — `TaskTransitions` interface; `progress.go` (86) — `ProgressEvent`/`ProgressResponse` + `ErrProgressUnavailable`; `dispatch.go` (33) — `DispatchResult`.
- **Boundary** — imports only `context` (hooks.go:19) and `errors` (progress.go:19, task_state.go:24); `dispatch.go` imports nothing, and `task_state_test.go` adds only stdlib `testing` (test files sit outside `go list -deps`, so they don't factor into the leaf check anyway). Enforced by `arch_test.go:145-156` (`TestContractsIsLeaf`, via `go list -deps`), which also whitelists an unused `models` import — a dead branch flagged for deletion as part of the arch-lock honesty work, unshipped. Any feature (or `models`) may import contracts (`models/component_task.go:53`: `TaskStatus = contracts.TaskStatus`); contracts imports nothing internal.
- **Interactions** — real edge is task↔codingagent: task side (`ports.go:37-45` `TaskDispatcher`/`ProgressReader`, `task_huma.go:75-77,363`, `handlers.go`, `projector.go:57` `var _ contracts.TaskTransitions = (*Projector)(nil)`) vs codingagent side (`dispatch_service.go`, `progress_service.go`, `build_watcher.go`, `coding_agent_watcher.go:50`, `workflowrun_service.go:98`) — 9 files, zero direct import either way (`arch_test.go:128-134`). `webhook/installation_handlers.go:62,320` also calls `ApplyTaskEvent` for org-disconnect/repo-unselect cascades. design↔task (also named as a contracts-cut edge in the target tree above) shows **zero** contracts usage under `internal/feature/design/` — that edge is actually cut by a local `taskReconciler` port (`design_service.go:116`), a separate interface from the `traitSyncReconciler` (design_service.go:99) that cuts the sibling design↔component edge.
- **Tests** — only `task_state_test.go` (69 LOC): 3 tests — a table-driven happy-path set (9 cases), a loop over the 3 terminal states, and one unknown-transition check. Gap: `dispatch.go`/`hooks.go`/`progress.go` untested here; `TaskTransitions` satisfaction is checked in the consumer (`projector.go:57`), not here.
- **Target vs today** — the target tree above marks this leaf itself "unchanged" target-state — already shipped as designed. Open (not done): swap the 4-edge denylist for a DFS acyclic check, and delete the dead `models` whitelist branch in `TestContractsIsLeaf`.

### Domain models (`models/` — target `internal/domain`)

- **Purpose** — the one shared kernel every feature may depend on without creating a slice-to-slice import cycle: 18 non-test files holding 56 exported types, of which only **11 are actual GORM-tagged table structs** (`CodingAgentLog`, `ComponentConfig`, `ComponentTask`, `OrganizationIDPProfile`, `IDPAuditEvent`, `OrgAnthropicCredential`, `OrgCredential`, `Organization`, `GitRepository`, `WebhookDelivery`, `WebhookPayload`) — the rest are plain API/DTO value types (`Component`, `Design`, `Project`, `Tasks`, `Skill`, etc.) — plus 2 pure free-function files (`api_security.go`, `wp_naming.go`).
- **Lives here today** — 20 files, 1349 non-test LOC / 1469 incl. tests (`wc -l` today, matches the review doc exactly). Notable: `component.go` (201, biggest — `Component`/`WorkflowRun`/`Deployment`/`BuildLogs`), `component_task.go` (171 — `ComponentTask` + `TaskStatus` re-export), `org_credential.go` (154 — `OrgCredential` + `JSONStringList`/`WebhookSecrets` GORM Valuer/Scanner), `repository.go` (93 — `GitRepository` + `SlugForURL`), `wp_naming.go` (84 — pure `WorkflowPlaneNamespace` naming funcs, no state), `design.go` (80 — mixes `Design` with `DesignComponent`).
- **Boundary** — imports only `internal/contracts` (`component_task.go:22`), nothing else internal (grep-confirmed). 79 files import `models` today (`grep -rl`; doc's "77" from 2026-06-30, two days of drift). `internal/arch/arch_test.go:147-156` (`TestContractsIsLeaf`) checks the mirror edge but its `d != mod+"/models"` whitelist branch is dead (contracts never imports models back) — flagged as part of the arch-lock honesty work, not yet deleted.
- **Interactions** — `DesignComponent` used by 6 features (artifacts, component, design, gitrepo, runtimeconfig, task); `GitRepository` by 7 (artifacts, codingagent, gitrepo, orgcreds, project, requirements, skills); `ComponentTask` by 5 (artifacts, codingagent, gitrepo, task, webhook) — the load-bearing cross-slice types. `component_task.go:53-65` aliases `contracts.TaskStatus` so every consumer reuses the contracts state machine.
- **Tests** — `api_security_test.go` (pure `DesignComponent` flag resolution via `ResolveAPISecurityEnabled`/`ResolveAPISecurityCallerKind`) and `repository_test.go` (`SlugForURL`, `WorkflowPlaneNamespace`). Gap: no test on the `JSONStringList`/`WebhookSecrets` Scan/Value round-trips.
- **Target vs today** — the "models/ surgical relocation" bet (see "What moves, and is it worth it" below): move ~12 single-feature types (`Design`, `ProjectStatus`, `RequirementsBundle`, `Component`, `Tasks`) into their slice, keep the ~10 shared ones, optionally rename to `internal/domain`. **Not shipped** — `internal/domain` doesn't exist yet and `design.go` still mixes `Design` with `DesignComponent`; explicitly gated "later, opportunistically," and wholesale shattering is explicitly rejected.

### `internal/credentials` — deep module

- **Purpose** — single seam for GitHub auth: resolves an org's connection record into a polymorphic `Credential` and hands out token/identity/repo-owner/webhook-strategy without callers branching on kind (`credential.go:17-25`).
- **Lives here today** — 14 files, 1645 non-test LOC (2431 incl. tests): `credential.go` (Credential/Resolver interfaces), `org_resolver.go` (DB-backed `orgResolver`, singleflight per org), `app_installation.go`/`user_pat.go` (the two Credential impls), `app_token_minter.go` (455 LOC: App JWT signing + install-token minting + `LoadAppKeyFromOpenBao`), `token_cache.go` (in-proc App-token cache), `openbao_store.go`/`db_store.go` (two `OpenBaoStore` backends — Vault and AES-256-GCM-over-Postgres), `validator.go` (24h drift/revocation probe).
- **Boundary** — imports zero other `internal/...` packages (grep-confirmed leaf); `import_fence_test.go:47-53` confines `github.com/openbao/*`/hashicorp-vault imports to this dir. No arch test polices *inbound* imports of credentials (unlike `contracts`/`platform/{tenant,auth}`, `arch_test.go:90`) — 6 packages import it directly and freely (`cmd/aep-api`, `feature/{artifacts,gitrepo,orgcreds,skills}`, `internal/seed`).
- **Interactions** — `feature/gitrepo` (repo/issue/webhook/board services), `feature/orgcreds` (connect/refresh/validator probes; its `CredentialService` also backs `feature/webhook`'s `SecretFetcher` port, so webhook itself never imports credentials directly), `feature/artifacts`, `feature/skills/repo_store.go`, `internal/seed/app_platform.go:46,83`, `cmd/aep-api/app.go:263-333` (wires `NewDBStore`→`NewAppTokenMinter`→`NewOrgResolver`).
- **Tests** — `validator_test.go` (9 drift/cascade cases), `app_token_minter_test.go` (JWT shape, cache hit, singleflight), `openbao_store_test.go` (orgID/path validation, redaction), `import_fence_test.go`. Gap: `db_store.go` (AES-GCM) and `org_resolver.go` have no dedicated test file.
- **Target vs today** — already a real deep module; this doc marks the dir "unchanged" (see the target tree above) — nothing pending here. `bearer.go`/`TaskBearerClaims` removal (part of the auth consolidation, done 2026-07-01) verified: file absent, zero `TaskBearerClaims` hits repo-wide.

### Auth home (`internal/platform/auth` + legacy `middleware/{jwt,jwtassertion,auth_token,orgensure}`)

- **Purpose** — verify inbound identity (public user-JWT, internal-S2S runner bearer) and derive the org handle every downstream handler/query trusts, so a request can never name an org it doesn't own.
- **Lives here today** — `internal/platform/auth/`: `runner.go` (`RunnerAuthorizer`, `RunnerScopedInput`, `SecurityRunner` — the internal-S2S org gate), `task_token_manager.go` (BFF-signed per-task JWT), `publisher_token_verifier.go` (Thunder publisher client-credentials). `middleware/jwt/jwt.go` — `Claims`/`ResolveOuHandle` over `jwtassertion`. `middleware/jwtassertion/{auth.go,jwks_cache.go}` — JWKS RS256 verifier. `middleware/auth_token.go` — legacy `ExtractAuthToken` ctx-stash (`package middleware`, no subdir). `middleware/orgensure/orgensure.go` — post-JWT namespace-ensure/cache. `internal/platform/tenant/{tenant.go,gate.go}` — `Caller`/`OrgHandle`/`Source`. ~2300 LOC total (impl + tests) across these files.
- **Boundary** — `internal/arch/arch_test.go:90` fences `platform/auth`+`platform/tenant` (and `contracts`) as leaves (no `internal/feature/*`, no flat `services`/`controllers`); `middleware/{jwt,jwtassertion,orgensure,auth_token.go}` sit outside that fence, unenforced. Importers of `platform/auth`: `cmd/aep-api/app.go`, `api/huma_register.go`, `feature/task/task_internal_huma.go:46`, `feature/orgcreds/credentials_internal_huma.go:46` (both embedding `auth.RunnerScopedInput`).
- **Interactions** — `humakit.OrgScopedInput` (public `/api`, `internal/platform/humakit/humakit.go:70`) binds org from `jwt.ResolveOuHandle` directly and never touches `tenant.Caller` (only the unrelated `tenant.GateMode`). `auth.RunnerScopedInput.Resolve` (`runner.go:151`) is the internal-S2S twin, embedded by both `_internal_huma.go` ops above: it delegates to `RunnerAuthorizer.Authorize`, which does return a `tenant.Caller`, and copies its `Org` onto `OrgHandle`. Wired once via `SetRunnerAuthorizer` at `cmd/aep-api/app.go:658`.
- **Tests** — `runner_test.go` (4 funcs, incl. `TestRunnerAuthorizer_PublisherCC`), `task_token_manager_test.go`+`task_token_roundtrip_test.go` (9, PKCS1/8/JWKS/kid-rotation/expiry), `jwtassertion/auth_test.go` (5). Gaps: no test file for `middleware/jwt`, `orgensure`, or `auth_token.go`. The real IDOR proof, `TestNoClientSuppliedOrg` (`api/huma_guard_test.go:41`), scans `humakit.go`+`auth/runner.go` plus every feature `*_huma.go` file for banned client-supplied-org struct tags.
- **Target vs today** — the auth-consolidation work done 2026-07-01: confirmed `middleware/task_bearer.go`, `credentials_refresh_controller.go`, `internal/credentials/bearer.go`, `internal/auth/scope/` are all gone from disk; `scope` folded into `runner.go`. This doc's fuller "one auth home" target (folding `jwt`/`jwtassertion`/`auth_token` and `platform/tenant` by name, plus the rest of `middleware/` — including `orgensure` — per the `middleware/` → `internal/platform/{auth,obs}` migration row below) is **not** shipped — those remain top-level, unfenced.

### Other platform leaves (`httpkit`, `humakit`, `obs`, `k8sname`, `dbtest`) + `internal/arch`

- **Purpose**: `httpkit` = shared HTTP error writers + actor/UUID helpers; `humakit` = the by-construction org-scope Huma gate + status→error mapper; `obs` = correlation-ID context plumbing; `k8sname` = name→RFC1123 slug; `dbtest` = DB-backed test harness; `internal/arch` = the import-boundary CI lock; these `middleware/*` items are thin request-scoped wrappers.
- **Lives here today**: `humakit.go` (120 LOC, biggest — `OrgScopedInput.Resolve`, `ErrorFromStatus`); `httpkit.go` (72, `Write400`/`Write401`/`Write404`/`Write500`, `ActorFromContext`, `RequireUUID`); `obs/correlation.go` (67); `k8sname.go` (40); `dbtest.go` (103, `//go:build dbtest`); `arch_test.go` (156, itself both impl+test); `middleware/correlation_id.go` (46, pure delegate to `obs`), `panic_recover.go` (44), `logger/{context_handler,request_logger}.go` (54+57).
- **Boundary**: `obs`/`k8sname`/`dbtest` import nothing internal (grep-confirmed); `httpkit` imports `middleware/jwt`+`utils`+`utils/validate` (pre-hygiene flat `utils`); `humakit` imports `platform/tenant`+`middleware/jwt`. No arch test enforces any of these 5 as leaves — `arch_test.go:90-100` only checks `contracts`/`platform/tenant`/`platform/auth`.
- **Interactions**: `humakit.OrgScopedInput` is embedded by 13 feature `*_huma.go` files (grep-confirmed on the actual embed line, not comment mentions — `organization_huma.go` only *references* it in a comment explaining why its `listOrganizations` input does **not** embed it, so it doesn't count); `httpkit.ActorFromContext` used only in `idp_huma.go:116,136` + `orggithub_huma.go:135` — `Write400`/`401`/`404`/`500` and `RequireUUID` are currently uncalled anywhere in the tree; `logger.RequestLogger`+`middleware.AddCorrelationID`+`RecovererOnPanic` chained in `api/app.go:100-102`; `dbtest.Open` used only by the 2 `repositories/*_dbtest_test.go` files.
- **Tests**: `humakit_test.go` covers `Resolve` enforce/log modes; `httpkit_test.go` covers only `ActorFromContext`; `ErrorFromStatus`, the `Write4xx` writers, `RequireUUID`, `obs`, `k8sname`, `logger` have zero tests. `arch_test.go` today checks: no flat `services`/`controllers` imports, those packages deleted-on-disk, a **4-edge hardcoded denylist** (`TestTaskCodingagentCycleBroken`), and `TestContractsIsLeaf`'s models exception.
- **Target vs today**: the `obs`/`correlation_id` one-home collapse is still open (wrapper remains). Arch-lock gaps unshipped: denylist→DFS-acyclic over `go list -deps`, hardcoded 14-feature/3-leaf slices→`os.ReadDir`, dead `models` exception, delete `TestGateInvariant_NoRawGatedRouteRegistration`. `dbtest`'s testcontainers+pgtestdb template-clone target is design-only — today's file is unchanged shared-`:5433`+`AutoMigrate` harness.
### clients/ — external integrations (target `internal/clients`)

- **Purpose** — one house for every out-of-process integration (OpenChoreo, K8s, Thunder IdP, secrets, agents, log planes) so features never hold raw HTTP/K8s clients themselves.
- **Lives here today** — 12 dirs, ~7.5k hand-written LOC (incl. tests, excl. generated/mocked code) + `openchoreo/gen`'s ~33k generated: `openchoreo/` OC API (component/project/namespace/git-secret/secret-reference + sealed `gen/` + `mocks/`); `clustergatewayproxy/client.go` (572) k8s-gateway dispatch/watch/log-tail; `thundersvc/client.go` (1036) Thunder IdP + org OU mgmt; `secretmanagersvc/` (1164) secret-store provider registry; `agents/client.go` (420) agents-service HTTP+signed-JWT; `observer/` runlogs query; `observability/client.go` (136) build-log client; `k8s/client.go` (71) in-cluster builder; `oauth/token_provider.go` shared `TokenProvider` (used by openchoreo + observer + task); `oidc/discovery.go` OIDC metadata; `httpx/correlation.go` correlation-ID transport wrapper; `requests/` `RetryableHTTPClient`.
- **Boundary** — 10 of the 14 features import `clients/*` (codingagent, component, design, idp, organization, orgcreds, project, requirements, runtimeconfig, task); no arch test polices this edge — `internal/arch/arch_test.go` only checks the feature import graph (no flat layers, the task↔codingagent cycle) + that `contracts` stays a leaf.
- **Interactions** — `codingagent/dispatcher.go:89,98,138` (dispatch), `watcher.go:60,81,162` (poll), and `progress_service.go:83,129,546` (log-tail) each hold a concrete `*clustergatewayproxy.Client` directly, with zero mocks or tests anywhere in the package; `openchoreo/transport.go:96-97` wires both `httpx.WrapTransport` + `requests.RetryableHTTPClient` — the only client doing so (`agents/client.go:261` uses `httpx.WrapTransport` alone, no retry layer).
- **Tests** — `httpx/correlation_test.go`, `observer/{client,schema}_test.go`, `openchoreo/transport_test.go`, `thundersvc/client_test.go`; nothing for clustergatewayproxy, k8s, oidc, agents, observability, secretmanagersvc.
- **Target vs today** — open: one shape (Config in, interface out, `(T,error)`, no panic, no nil-nil) in `clients/AGENTS.md` (doesn't exist); deviants — panic in `clustergatewayproxy/client.go:106` + 5 openchoreo ctors (`component_client.go:164`, `git_secret_client.go:86`, `namespace_client.go:45`, `project_client.go:45`, `secret_reference_client.go:59`); `(nil,nil)` in `observer/client.go:76-79`; thundersvc hand-rolls a token cache (`client.go:146,184-205`, no `oauth.TokenProvider`) and observer hand-rolls 401-retry (`client.go:202-203`) instead of `RetryableHTTPClient`. The `requests` fluent-builder deletion already shipped. `clients/`→`internal/clients` is target-doc-only, not done.

### `database/`, `config/`, `internal/seed` + legacy `repositories/`, `utils/`

- **Purpose** — the shared infra kernel: DB connection/migration registry, env config + validation, first-boot seeding, and the 3 flat data-access repos + 2 leftover cross-feature helper files.
- **Lives here today** — `database/database.go` (46 LOC, `Open` connects+AutoMigrates); `database/migrations/run_all.go` (93 LOC, `RunAll(ctx, db, tier)` — 19-step ordered `{name,fn}` list over 18 phase files, called from `cmd/aep-api/main.go:74`); `config/config.go` (248 LOC, `Config.Validate()` at :182) + `config_loader.go` (`Load()` calls `Validate()` at :139); `internal/seed/app_platform.go` (133 LOC, `AppPlatformFromEnv`, dev-tier only); `repositories/` — exactly 3 repos: `task_repository.go` (221 LOC, 12 methods), `repo_repository.go` (144 LOC), `config_repository.go` (70 LOC), all `*gorm.DB`-backed with concrete constructors; `utils/response.go` (JSON writers) + `utils/validate/identifier.go` (`Slug`/`UUID`).
- **Boundary** — no `internal/arch` check targets these packages (`arch_test.go` polices only features/platform-leaves/contracts/wiring); repos import only `models`+`gorm`, `utils` has zero internal deps. No enforcement today.
- **Interactions** — `repositories` imported by 18 files across task, gitrepo, orgcreds, codingagent, component, project, artifacts, webhook features plus `cmd/aep-api/app.go:63`/`api/app.go:32`; `utils` imported by `middleware/{jwtassertion,panic_recover}.go`, `httpkit`, and 2 features (component, skills); `seed` imported only by `cmd/aep-api/app.go:295`.
- **Tests** — `config_test.go` (5-case table-driven `Validate` test); `repositories/{task,repo}_repository_dbtest_test.go` (real-Postgres org-isolation/IDOR regression tests, not full CRUD). Gaps: `config_repository.go` untested, nothing covers `RunAll`, `database.Open`, or `seed`.
- **Target vs today** — the composition-root work (`RunAll`+`Config.Validate`+test) is shipped. Still open: moving `database/`+`config/` under `internal/` (not started — `internal/seed` already lives there); folding `repositories/*` into `feature/<f>/store.go` (explicitly gated — the 3 repos are fine, the untested `*gorm.DB`-embedding services need `dbtest`, not restructuring); `utils/validate` → `platform/validate`/`httpkit` (opportunistic, not done).

## Per-feature file set: spine + optional extras

Only two files are a **required spine**; the rest are added when the feature actually has the thing. Today only 3–4 of ~15 features carry `store.go`/`ports.go`/`errors.go`, and the biggest (task 13, orgcreds 14, codingagent 12 files) add sub-surfaces, projectors and streams with no canonical slot — so this is a spine to grow, **not** a 6-slot skeleton to fill. The one naming rule worth enforcing is the `*_huma.go` suffix (kills the `handlers.go` vs `_huma.go` split) and folding `oc_error.go` into `errors.go` (dedupe the 4 duplicate OC-error mappers).

| File | Required? | Holds | Rule |
|---|---|---|---|
| `*_huma.go` | **yes** (≥1) | Huma registration, request/response DTOs, DTO↔domain mapping | **only** `*_huma.go` files import `huma`; a feature may have several (main + sub-surface + S2S); org from `OrgScopedInput` |
| `*_service.go` | **yes** | domain logic | no `huma`, no raw `http`; constructor returns concrete type, not a re-widenable interface |
| `store.go` | when folding a repo | this feature's gorm queries | takes `*gorm.DB` (that's the seam); create only when folding an existing repo — gated on friction |
| `ports.go` | when it has several | interfaces this feature needs from others | collection file when ≥2 cross-feature ports; a single local one stays **inline in its consumer file** (idiomatic Go) |
| `errors.go` | when it has sentinels | sentinel errors | one file (not `oc_error.go`); map to HTTP via shared helper (dedupe the 4 duplicate OC-error mappers) |
| `*_service_test.go` | when logic warrants | **unit** — real service, mocked ports, no HTTP/DB | fast; the default `go test` loop |
| `*_component_test.go` | per handler surface | **component** — real Huma handler+gate in ENFORCE, faked auth, mocked clients | proves validation + IDOR gate + error mapping in-process |
| `*_dbtest_test.go` | for SQL-shaped behavior | **store/integration-lite** — real Postgres via `dbtest.New` (template-clone) | skips under `-short`; `make test-db` runs it |

> The file **suffix is the tier signal** — see the Testing strategy below and `docs/design/bff-component-testing.md` for the exact conventions.

## Feature reference

> One section per `internal/feature/<name>` vertical slice, same grounding rules as the shared reference above. "Refactor fit" checks each feature against the required spine + optional extras from the previous section — a feature with no `*_huma.go` because it's transport-less (e.g. `artifacts`, `codingagent`, `gitrepo`, `runtimeconfig`, `webhook`) is a correct exception, not a gap.

### internal/feature/artifacts

- **Purpose** — git-backed persistence, versioning, and save/discard for a project's requirements + design spec files (the artifact store).
- **Lives here today** — 11 files, 4059 LOC: `artifact_service.go` (1355, core `ArtifactService` + git plumbing), `save_via_api.go` (661, GitHub Contents/Git-Data/Refs save flow), `artifact_store.go` (628, decorator adding external-API catalog + `DesignFile` split/assemble — not a gorm store despite the name), `artifact_versioning.go` (216, tag-scheme parsing), `conflict_retry.go` (181, CAS + tag-collision retry policies), `openapi_normalize.go` (176, canonical YAML for LLM-diff dedup), `external_api_catalog.go`/`design_component.go` (64/61, sentinel err + catalog map).
- **Boundary** — wired once at `cmd/aep-api/app.go:338,413`; imported by 20 non-test files across 8 features (design, requirements, task, codingagent, component, project, skills, runtimeconfig) — wide fan-in, on par with only `gitrepo` among the ~14 features. Imports feature `gitrepo` (`artifact_service.go:37`) via consumer port `GitWorkspace` (`artifact_service.go:205`), plus flat `repositories`/`models`. No arch test targets this edge specifically — it's outside the 4-edge cycle denylist (arch-lock gap: 21 real edges, 4 checked).
- **Interactions** — `NewArtifactService` returns the `ArtifactService` interface (`artifact_service.go:223`, not concrete — unlike the concrete-constructor convention most services follow); `NewArtifactStore` wraps it (`artifact_store.go:40`). Consumers hold `*artifacts.ArtifactStore`/`ArtifactService` fields, e.g. `codingagent/dispatch_service.go:97`.
- **Tests** — `artifact_store_api_test.go` (frontmatter round-trip), `artifact_versioning_test.go` (tag parsing), `openapi_normalize_test.go` (canonical-form cases incl. key order). Gap: zero coverage of `exec.CommandContext` git paths or save/conflict-retry flow — the doc's "bigger bet" (add `gittest`, don't mock git) — now designed: see "Git testing (the `gittest` tier) + the git-provider seam" below. The save flow drives the provider-neutral `GitData` port, so its tests double as the provider contract suite.
- **Refactor fit** — no `*_huma.go` (zero huma imports; transport-less, consumed by others' surfaces). No `errors.go` (sentinels inline, e.g. `ErrArtifactNotFound` at `artifact_service.go:47`); no `store.go` (no gorm usage anywhere in the package — git is the persistence); `GitWorkspace` is a legit single consumer port, correctly inline.

### internal/feature/codingagent

- **Purpose** — owns dispatching, running, and watching coding-agent/build workflows for a task: job manifests, OC WorkflowRun triggering, progress reads, terminal-state reconciliation.
- **Lives here today** — 15 files, 4201 LOC (`wc -l`), no `*_huma.go`. `dispatch_service.go` (986 LOC) orchestrates dispatch; `progress_service.go` (716 LOC) serves `/progress/*` reads; `workflowrun_service.go` triggers per-SHA WorkflowRuns; `build_watcher.go`/`coding_agent_watcher.go`/`on_hold_watcher.go` are `FOR UPDATE SKIP LOCKED` polling reconcilers, `watcher.go` (`JobWatcher`) polls the proxy path without row-locking; `dispatcher.go`+`job_template.go`+`externalsecret_template.go` build Job/ExternalSecret manifests; `dispatch_cascade_hook.go` is the post-commit cascade; `ports.go` (38 LOC) holds `BuildOps`/`OnHoldDispatcher`.
- **Boundary** — imports `contracts`, `artifacts`, `component`, `gitrepo`, `orgcreds`, `platform/{k8sname,tenant}`, `models`, `repositories`, `clients/{openchoreo,observer,clustergatewayproxy}`; grep-confirmed only `cmd/aep-api/app.go` imports it back, zero sibling features. Arch-locked: `arch_test.go:129-133` denies `task↔codingagent` both ways (denylist, ahead of the planned DFS-acyclic rewrite).
- **Interactions** — `task/ports.go:34-45` (`TaskDispatcher`/`ProgressReader`) is structurally satisfied by `DispatchService`/`ProgressService`, driven from `task_huma.go` without importing this package; `app.go:558-792` wires eight of its constructors (`WorkflowRunService` through `ProgressService`) plus the `OnHoldDispatcher` closure.
- **Tests** — `build_watcher_test.go` (`classifyRun` branch table), `job_template_test.go` (builder field cases), `progress_service_test.go` (sort/dedup/cursor helpers) — pure-unit only; no service/dbtest coverage of `dispatch_service.go`, `workflowrun_service.go`, or the watcher DB loops.
- **Refactor fit** — no `*_huma.go`: backend-only, HTTP lives in `task` via consumer ports, so the required spine doesn't literally apply. Has `ports.go`, no `store.go`/`errors.go`; gorm inline. Exposes `BuildOps`/`OnHoldDispatcher`, satisfies `task`'s ports — one of the target doc's three biggest-file-count features alongside `task` and `orgcreds` (12 vs 13/13 non-test files today), the group it calls out as growing sub-surfaces/watchers instead of converging on the two-file spine.

### internal/feature/component

- **Purpose** — owns OC-Component CRUD/build/deploy reads, per-component config (env vars), and the `api-configuration` trait emitter/watcher that keeps Component CRs + ReleaseBindings in sync.
- **Lives here today** — `component_huma.go` (259 LOC, list/get/trigger-build/build-logs/deployments/OpenAPI transport), `component_service.go` (233, `ComponentService` over `openchoreo.ComponentClient` + `ArtifactStore`, plus `observability.Client`/`gitrepo.RepoService`/`BuildSecretStager`), `config_huma.go`/`config_service.go` (97/113, env-var get/update, mirrors onto OC via `ComponentService`), `trait_sync.go` (492, `TraitSyncService` — per-component-mutex emitter, explicitly flagged "don't split for size"), `trait_sync_watcher.go` (210, 10s convergence poller with per-tuple failure-budget pause), `errors.go` (30, 4 sentinels). ~1809 LOC/10 files (incl. 3 test files).
- **Boundary** — imported by `codingagent/dispatch_service.go:95-96,108`, `dispatch_cascade_hook.go:48`, `task/task_service.go:70,72`, `api/huma_register.go:47-48`, `cmd/aep-api/app.go:432-465,619` — no other importers. `arch_test.go:140` enforces `design` must not import it concretely (consumer port only); the feature list at `arch_test.go:76` is still a hardcoded slice, not `os.ReadDir` (still open).
- **Interactions** — task/codingagent consume `ComponentService`/`ConfigService`/`TraitSyncService` concretely; component itself declares consumer-side ports `OrgPublisher` (idp, `trait_sync.go:37`) and `BuildSecretStager` (orgcreds, `component_service.go:68`).
- **Tests** — `trait_sync_*_test.go` (3 files, all 10 test funcs) cover only `TraitSyncService`; zero tests for `component_huma.go`/`component_service.go` or `config_huma.go`/`config_service.go` (no unit or component tier).
- **Refactor fit** — two full `*_huma.go`+`*_service.go` spines in one package, plus `errors.go`; no `store.go` (still flat `repositories.ConfigRepository`); ports stay inline, not a `ports.go`.

Key files: `services/aep-api/internal/feature/component/{component_huma.go,component_service.go,config_huma.go,config_service.go,trait_sync.go,trait_sync_watcher.go,errors.go}`; cross-refs at `services/aep-api/internal/arch/arch_test.go:76,140`, `services/aep-api/cmd/aep-api/app.go:432-465,619`.

### internal/feature/design

- **Purpose**: owns the architecture-design vertical — AI-generated design docs/bundles, versioning, and file/component edits — as one Huma+service slice.
- **Lives here today** (1,103 LOC total, confirmed `ls`): `design_huma.go` (283) — Huma transport, `RegisterDesign` wires 10 ops + `mapDesignError`; `design_service.go` (720) — `DesignService` interface/`designService`, `StreamGenerateDesign` (AI streaming via `clients/agents`), bundle/file/component CRUD, git-backed persistence through `feature/artifacts`; `versioning.go` (54) — tag-lineage mapping (`mapDesignVersions`); `design_service_test.go` (46) — one table test.
- **Boundary**: `design_service.go` imports only `clients/agents`, `feature/artifacts`, `platform/k8sname`, `models` (design_service.go:32-35) — no `huma`, no `task`/`component`. Arch-locked: `arch_test.go:137,140` denylist-asserts design must not import `task` or `component` directly.
- **Interactions**: registered/consumed in `cmd/aep-api/app.go:441,446,450,466` and `api/huma_register.go:28,52`; cross-feature edges are inline consumer ports — `taskReconciler`, `traitSyncReconciler`, `skillCatalog` (design_service.go:99-118), wired via `Set*` setters, not concrete imports.
- **Tests**: only `componentNameFromDesignPath` table test; no service/component/dbtest coverage of `StreamGenerateDesign` or the CRUD paths — a real gap (design has "1 helper test" and is untestable above the git layer without a real-git test harness).
- **Refactor fit**: matches the required spine (`design_huma.go`+`design_service.go`); has `errors.go`-shaped content (sentinel `ErrSpecNotApproved`, design_service.go:42) but no dedicated `errors.go` file; 3 inline ports, no `ports.go` collection yet; no `store.go` (persistence delegates to `artifacts`).

### internal/feature/gitrepo

- **Purpose** — owns GitHub-repo lifecycle for a project: repo provisioning/clone, on-disk git ops, GitHub REST+GraphQL clients, issue CRUD, project-board sync, webhook registration.
- **Lives here today** — 10 files, 3567 LOC, no subpackages: `github_client.go` (936, `GitHubClient` REST iface), `github_v2_client.go` (624, GraphQL Projects-v2 client), `github_artifacts.go` (568, git-data blob/tree/commit/tag calls), `git_ops_service.go` (455, `GitOpsService` clone/pull/pre-warm), `repo_service.go` (392, `RepoService` CRUD), `issue_service.go` (245, `IssueService`), `issue_body.go` (122, pure templating), `webhook_service.go` (107, `WebhookService`), `repo_board_service.go` (93, `RepoBoardService`), `errors.go` (25, 3 sentinels).
- **Boundary** — imports only `internal/credentials` + top-level `models`/`repositories` (grep-confirmed, zero `internal/feature/*` imports — a leaf). Imported by 8 features (artifacts, codingagent, component, orgcreds, project, skills, task, webhook) plus `api/huma_register.go:51` and `cmd/aep-api/app.go:335-408` (wiring). No arch test scopes *who* may import it; `internal/arch/arch_test.go:74-88` (`TestNoFlatServicesOrControllers`) only checks gitrepo, alongside the other 13 features, avoids the flat `services`/`controllers` packages.
- **Interactions** — `task/task_service.go:73,75` holds `gitrepo.IssueService`/`RepoService`; `orgcreds/credential_service.go:103` holds `gitrepo.GitHubClient`; `webhook/installation_handlers.go:52` takes `gitrepo.IssueService`.
- **Tests** — none; zero `*_test.go` in this dir despite tying `artifacts` for the highest feature fan-in in the tree (8 consuming features each).
- **Refactor fit** — no `*_huma.go`; transport-less, consumers' huma layers call it directly — doesn't fit the required spine as a self-contained slice. Has `errors.go`; lacks `store.go`/`ports.go` (still uses flat `repositories.RepoRepository` directly); its 7 exported interfaces double as the cross-feature ports the 8 consuming features rely on.
- **Target — the git-provider seam**: the GitHub HTTP clients (`github_client.go` + `github_v2_client.go` + `github_artifacts.go`, ~2128 LOC) move to `clients/github/`, implementing provider-neutral capability ports defined *here* (`GitData` / `RepoAdmin` / `IssueOps` / `WebhookOps` / `BoardOps`); gitrepo keeps the domain services, the port definitions, and the sentinel contract. `git_ops_service.go` needs **zero** change — pure git exec against a clone URL is already provider-neutral. Selection via `GIT_PROVIDER` (default and only value: `github`). Full design + test net: "Git testing (the `gittest` tier) + the git-provider seam" below.

### internal/feature/idp

- **Purpose** — owns per-org IDP profiles plus the matching Thunder publisher OAuth-app lifecycle (create/revoke/rotate) and its audit trail.
- **Lives here today** — `idp_huma.go` (169 LOC): 4 Huma ops (get/update profile, rotate secret, OIDC discovery), all `OrgScopedInput`-gated; `idp_service.go` (535 LOC): `IDPService` interface + `idpService{db, thunder, platform, smAPI}`, Thunder provisioning, `idp_audit_events` writes. 704 LOC total — right-sized, leave it.
- **Boundary** — imports `clients/{thundersvc,oidc}`, `platform/{httpkit,humakit}`, `models`, and cross-feature `feature/orgcreds` (`SMAPIWriter`, `idp_service.go:30`); only `idp_huma.go` imports `huma`. Nothing imports `feature/idp` directly outside `cmd/`/`api/` — consumers use local structural ports instead. Only enforced generically via `TestNoFlatServicesOrControllers`'s hardcoded feature list (`internal/arch/arch_test.go:77`), not a per-edge cycle check.
- **Interactions** — mounted `idp.RegisterIDP(api, d.IDPSvc)` (`api/huma_register.go:86`), wired in `cmd/aep-api/app.go:513`; consumed cross-feature via consumer-side ports calling `EnsureOrgPublisher`: `component/trait_sync.go:37-40` (`OrgPublisher`) and `codingagent/dispatch_service.go:80-82` (`OrgPublisherProvisioner`), invoked at `trait_sync.go:166` / `dispatch_service.go:531`.
- **Tests** — none exist (`find internal/feature/idp -name "*_test.go"` empty) — untested not untestable (`*gorm.DB` is already the seam).
- **Refactor fit** — matches the required spine exactly, no extras: no `store.go`/`ports.go`/`errors.go`; the one sentinel `ErrIDPThunderUnavailable` sits inline in `idp_service.go:139`. Exposes no port itself; is the callee side of two consumer-defined ports above.

### internal/feature/organization

- **Purpose** — read/cache view of OC namespaces-as-organizations: lists them and JIT-verifies+backfills the local `organizations` row the auth middleware needs per request.
- **Lives here today** — `organization_huma.go` (73 LOC): single `list-organizations` GET, deliberately skips `OrgScopedInput` (enumerated gate carve-out, L32-35); `organization_service.go` (369 LOC): `List` + `EnsureForOuHandle` (singleflight + 5m TTL cache, L68, L131-134) + OU-trust guard vs. phantom Thunder OUs; `ou_validation_test.go` (60 LOC).
- **Boundary** — imports only `platform/humakit`, `models`, `clients/openchoreo` (grep-confirmed, zero cross-feature imports); only the composition/wiring layer imports it back (`cmd/aep-api/app.go:427,506,682`, `api/app.go:26,73`, `api/huma_register.go:46,77`) — no feature-to-feature edge exists. `middleware/orgensure/orgensure.go:47` duck-types its own `OrgEnsurer` interface rather than importing the package. `arch_test.go:77` covers it only in the generic no-flat-services check, no dedicated edge assertion.
- **Interactions** — `orgensure.Middleware` (orgensure.go:73) calls `EnsureForOuHandle` per org-scoped request; `models.Organization` is also read by `codingagent` (watcher.go, dispatch_service.go) and `idp_service.go` — shared type correctly left in `models/`, not here.
- **Tests** — only `TestOUIsTrustworthy`; `List`/`EnsureForOuHandle`/backfill races are untested — untested, not untestable.
- **Refactor fit** — spine-complete (`_huma.go`+`_service.go`); no `store.go`/`ports.go` (gorm inline); 4 sentinels stay inline, no `errors.go`; `translateHTTPError` (organization_service.go:49) is 1 of 4 duplicate OC-error mappers that should collapse into one shared helper.
### internal/feature/orgcreds

- **Purpose** — owns org-scoped credentials end-to-end: GitHub PAT/App connect + webhook secrets + installation lifecycle, per-org Anthropic keys, and the runner-facing git-credential refresh/build-secret staging that feeds `codingagent`.
- **Lives here today** — 13 non-test files, 4164 LOC total (incl. 2 test files); confirmed via `ls`/`wc -l`. `credential_service.go` (1466 LOC) — GitHub connect/status/disconnect/webhook-secrets/installation god-file; `anthropic_credential_service.go` (526) — Anthropic key connect/status/effective-key; `sm_api_writer.go` (362) — writes creds to Secret Manager API; `build_credentials_service.go` (256) — stages git build secrets into k8s; `org_github_controller.go` (240) — trimmed legacy handler, now only a raw `HandleConnectCallback` behind the `OrgGitHubController` interface (org_github_controller.go:51-53); `orggithub_huma.go` (213); `org_disconnect_service.go` (182) — cascade disconnect; `organthropic_huma.go` (141); `validator_probes.go` (128) — prod `credentials.ValidatorProbes` impl; `bearer_service.go` (153) — connect-state JWT; `credentials_refresh_service.go`/`credentials_internal_huma.go` — S2S refresh surface; `credential_huma_errors.go` (69).
- **Boundary** — imports `internal/credentials`, `internal/feature/gitrepo`, `internal/platform/{auth,httpkit,humakit,tenant}`, `clients/{k8s,openchoreo,secretmanagersvc}`, plus still-flat `models`/`repositories`/`middleware/jwtassertion` (target-structure's `internal/domain` move hasn't landed here) — all confirmed by grepping the package's imports. Consumed by `codingagent` (dispatch_service.go:92-93,182-183; workflowrun_service.go:105,122), `idp` (idp_service.go:30,110,129), `webhook` (installation_handlers.go:51,60,78; webhook_controller.go:34), and `api/*` (app.go, dev.go, org_github_routes.go). Only `internal/arch/arch_test.go`'s `TestNoFlatServicesOrControllers` (no flat services/controllers import, orgcreds included in its feature list) and the leaf checks cover it — no orgcreds-specific acyclic-edge test like task↔codingagent's `TestTaskCodingagentCycleBroken`.
- **Interactions** — `webhook/installation_handlers.go:51,60,78` builds `OrgDisconnectService` from `*CredentialService`; `codingagent/dispatch_service.go:92-93,182-183` and `workflowrun_service.go:105,122` hold `*CredentialService`/`*AnthropicCredentialService`/`*BuildCredentialsService`; `api/huma_register.go:59-62` declares the `HumaDeps` fields and `:87-88` wires `RegisterOrgGitHub`/`RegisterOrgAnthropic`; `api/internal.go:66` wires `RegisterInternalCredentials`; `api/response_helpers.go:43-45` dispatches on `*orgcreds.ValidationError`/`ConflictError`/`NotFoundError` via `errors.As`.
- **Tests** — `build_credentials_service_test.go` (8 test funcs, one table-driven over 3 missing-arg cases, against a faked `openchoreo.GitSecretClient`) and `credentials_refresh_service_test.go` (1 test, faked `credentials.Resolver`) prove only those two thin services; `credential_service.go`, `anthropic_credential_service.go`, `org_disconnect_service.go`, `sm_api_writer.go` (all embedding `*gorm.DB`, confirmed) have **zero** tests — no test file references their constructors; a real coverage gap.
- **Refactor fit** — spine present (`*_huma.go` + `*_service.go`), plus a local `ports.go`-style pair of inline interfaces (`BuildSecretCleaner`/`AnthropicSecretCleaner`, credential_service.go:59-61,65-67) that let sibling services satisfy `CredentialService`'s cleanup calls without an import cycle. `credential_huma_errors.go` isn't a sentinel-collection `errors.go` (the `ValidationError`/`ConflictError`/`NotFoundError` types themselves live inline in `credential_service.go`) — it's the Huma-side `mapCredentialError` HTTP mapper, the shared-error-mapper pattern this feature already follows. No `store.go` (gorm inline, per the persistence convention above). This is exactly the "Split orgcreds" bigger bet below — not yet done.

### internal/feature/project

- **Purpose** — owns project CRUD (list/create/get/delete) plus the aggregate SDLC-phase status (`GetProjectStatus`) behind the org-scoped `/projects` Huma surface.
- **Lives here today** — `project_huma.go` (156 LOC): Huma registration, request/response DTOs, `mapProjectError`; `project_service.go` (288 LOC): `projectService` struct, inline `skillsProvisioner` port (project_service.go:64), `translateHTTPError`; `oc_error.go` (42 LOC): `openchoreoErrorStatus`, an OC-sentinel→HTTP map — 646 LOC / 5 files total (incl. the 2 test files).
- **Boundary** — imports `clients/openchoreo`, `feature/artifacts`, `feature/gitrepo`, flat `repositories` (TaskRepository) and `models`; grep confirms only `cmd/aep-api/app.go` and `api/huma_register.go` import `project` back — no other feature does (leaf consumer). `arch_test.go:77` lists `project` in `TestNoFlatServicesOrControllers`'s no-flat-services/controllers check; the separate cycle-break test (`TestTaskCodingagentCycleBroken`, arch_test.go:128) only wires task↔codingagent and design→task/component — `project` isn't named there.
- **Interactions** — wired once at `cmd/aep-api/app.go:426` (`NewProjectService`) / `:453` (`SetSkillsProvisioner`); mounted via `api/huma_register.go:76` (`RegisterProject`).
- **Tests** — `project_huma_test.go`: the only feature-level handler test in the repo (`humatest.New` shows up nowhere else outside `humakit`'s own test) — spec+wiring, gate forced to log mode; `project_status_test.go`: table test of `applyRepoToProjectStatus`. Gap: no service-level unit/dbtest coverage for `CreateProject`/`DeleteProject`/store branches of `GetProjectStatus`.
- **Refactor fit** — already matches the required spine; its "4-file shape" is right-sized, leave-as-is. `oc_error.go` is the lone debt item — a shared OC-sentinel error mapper folds it in alongside `organization.translateHTTPError` and two other duplicate OC-error translations. No `store.go`/`ports.go`; `skillsProvisioner` stays inline per target-doc convention.

### internal/feature/requirements

- **Purpose** — owns the requirements-bundle vertical: CRUD/versioning/skill-driven generation of `specs/requirements/*.md`, plus the human-collab sub-surface for that page.
- **Lives here today** — 8 files, 1824 LOC: `requirements_service.go` (427, CRUD/version/generate), `requirements_chat_service.go` (537, chat-driven generation/undo), `requirements_huma.go` (254, `RegisterRequirements`), `requirements_chat_huma.go` (194, `RegisterRequirementsChat`), `collab_huma.go` (138, `RegisterCollab`), `requirements_lock.go` (155, Postgres advisory `RequirementsDirLocker` + sentinel `RequirementsDirLockBusy`), `collab_identity.go` (75, `repoOracle` port + JWT display-claims), `versioning.go` (44, artifact→BFF version mapper).
- **Boundary** — imports `internal/feature/artifacts` (cross-feature), `clients/agents`, `models`, `middleware/jwt`, `internal/platform/humakit`, `gorm.io/gorm`; only `cmd/aep-api/app.go:438-440` and `api/huma_register.go:49-82` import it back. Enforced by `internal/arch/arch_test.go:77`'s hardcoded feature list (the `os.ReadDir` fix is still pending).
- **Interactions** — `app.go:439-440` wires `NewRequirementsService(...).WithLocker(...)`; `huma_register.go:80-82` mounts all three `Register*` funcs.
- **Tests** — none in this dir; full gap (persistence-testing territory).
- **Refactor fit** — spine present (3× `*_huma.go`, 2× `*_service.go`); no `store.go` despite raw `gorm.DB` in `requirements_lock.go`, no `ports.go` (single `repoOracle` stays inline, per convention), no `errors.go` (sentinel lives loose in `requirements_lock.go`). Consumes `artifacts` as a cross-feature port; exposes none.
### internal/feature/runtimeconfig

- **Purpose**: emits per-web-app `env-config.js` (`window._env_`: sibling API URLs + THUNDER_* OIDC config) onto a component's ReleaseBindings so one SPA image runs unchanged across environments.
- **Lives here today**: `runtime_config_service.go` (448 LOC) — `RuntimeConfigService` + `EmitForComponent`/`EmitForProjectSPAs`/`buildEnvValues`/`layerThunderKeys`; `external_url.go` (37 LOC) — `NormalizeExternalURL` helper. 4 files, 610 LOC incl. tests.
- **Boundary**: imports `clients/openchoreo`, `clients/thundersvc`, `internal/feature/artifacts` (concrete cross-feature import, not a port — same pattern design/dispatch use), `platform/k8sname`, `models`. No feature-specific arch test; only the generic `TestNoFlatServicesOrControllers` (arch_test.go:74-88) touches it, hardcoded into its 14-feature list.
- **Interactions**: zero HTTP surface — pulled entirely by `codingagent` via two locally-defined consumer ports: `RuntimeConfigEmitter.EmitForComponent` (dispatch_service.go:85,975) and `projectSPARuntimeConfigEmitter.EmitForProjectSPAs` (dispatch_cascade_hook.go:37,137); constructed in `cmd/aep-api/app.go:579`.
- **Tests**: `runtime_config_service_test.go` covers only pure helpers `renderEnvConfigJS`/`upperSnakeKey` — zero coverage of `EmitForComponent`/`layerThunderKeys` (needs mocked `ComponentClient`/`thundersvc.Client`). `external_url_test.go` table-tests `NormalizeExternalURL`, which is otherwise dead: no caller anywhere despite its own comment mandating universal use.
- **Refactor fit**: matches the spine minus transport by design (no `*_huma.go` — correctly, it's a pure backend service); has `*_service.go`, no `store.go`/`ports.go`/`errors.go` (cross-feature ports live consumer-side in codingagent). Right-sized house style — leave alone.

### internal/feature/skills

- **Purpose** — org-scoped skill catalogue (git-repo-backed read/reconcile/mutate/import) feeding design's architect input and task's skill resolution.
- **Lives here today** — 9 files, 2534 LOC: `skill_huma.go`(288) transport+DTOs+`mapSkillError`; `repo_store.go`(588, largest) holds the `SkillService` struct itself — the read surface (`Resolve`/`List`/`ListSummaries`/`ResolveMany`), the soft-TTL/HEAD-SHA cache, and the write primitives (`commitFiles`/`writeSkillFiles`/`deleteSkillDir`) under a bounded CAS retry (`retryCAS`); `skill_service.go`(186) is *not* the service logic — despite the name it's shared value types (`Skill` re-export, `SkillSummary`) plus pure SKILL.md frontmatter-parsing helpers (`parseSkillMD`, `versionFromMetadata`, `contentSHA`), per its own header comment ("the read/write surface itself... lives in repo_store.go + reconcile.go"); `reconcile.go`(234) builtin seed/version-reconcile; `skill_mutation_service.go`(299) create/update/delete+sentinels; `skill_import_service.go`(235) tarball extract/import; `skill_upload.go`(21) trivial size const.
- **Boundary** — only `cmd/aep-api/app.go:419-421` + `api/huma_register.go:35,89` import this package; it imports `feature/gitrepo`, `feature/artifacts`, `internal/credentials`, `models`, and the embedded `skills` FS. No feature imports back — task/design/project each declare a local consumer port (`SkillResolver`, `skillCatalog`, `skillsProvisioner`) satisfied structurally by `*SkillService` (ISP). Enforced loosely: `arch_test.go:78` only hardcodes `skills` into the fixed 14-feature list `TestNoFlatServicesOrControllers` walks for flat-services/controllers imports — there's no acyclic DFS check over the feature graph yet (still open).
- **Interactions** — `task/task_skills_service.go:94` and `task/task_stream.go:971` call `skillSvc.ResolveMany`; `design/design_service.go:660` calls `.List` via `skillCatalog`; `project/project_service.go:117` calls `.EnsureProvisioned` on project create.
- **Tests** — `repo_store_test.go`(419) covers read/write/CAS round-trips, reconcile, and the soft-TTL cache against an in-memory fake GitHub server; `skill_mutation_service_test.go`(264) unit-tests name/frontmatter validation + tarball extraction. Gap: no `*_component_test.go` for `skill_huma.go`; no dbtest (git-backed, N/A).
- **Refactor fit** — matches the required spine by filename (`*_huma.go` + `*_service.go`), but the naming is misleading: `skill_service.go` holds no `SkillService` methods — the actual service struct/logic sits in `repo_store.go` (conceptually the `store.go` extra, just unrenamed and overloaded with the service itself). Mutation/import services are extra `*_service.go` files (allowed by the spine). Sentinels live inline in `skill_mutation_service.go`, no `errors.go`. No `ports.go` — the package exposes no cross-feature port of its own, only consumes gitrepo's.

### internal/feature/task

- **Purpose**: owns the task/board vertical — CRUD, AI-driven task generation (SSE plan/detail phases), board projection, GitHub webhook→task-state sync.
- **Lives here today**: 13 non-test files, 3346 LOC. `task_huma.go`(368, public surface), `task_internal_huma.go`(59, runner S2S), `board_huma.go`(53), `task_service.go`(289, CRUD/generate), `task_stream.go`(992, largest — SSE plan/detail gen + issue sync), `projector.go`(374, webhook-driven state projector), `board_service.go`(274), `task_diff.go`(379, diff/fingerprint), `task_skills_service.go`(127), `handlers.go`(329, GitHub webhook handler), `ports.go`(46), `errors.go`(24), `task_design.go`(32, resolves the design component via `feature/artifacts` to avoid a task↔codingagent edge). Locking is per-task Postgres advisory locks (`pg_advisory_xact_lock`, `projector.go:367`), not `FOR UPDATE SKIP LOCKED` — that pattern belongs to codingagent's poll-based watchers (`internal/feature/codingagent/{build,coding_agent,on_hold}_watcher.go`).
- **Boundary**: only `*_huma.go` imports huma (grep-confirmed — `board_huma.go`, `task_huma.go`, `task_internal_huma.go`); imports `models`/`repositories` (flat legacy) + `clients/{agents,oauth,openchoreo}` + `feature/{artifacts,component,gitrepo}` + `platform/{auth,humakit}` + `contracts`. task↔codingagent kept acyclic by an arch-test denylist (`arch_test.go:129-133`); grep confirms zero import either way (only comment mentions of `codingagent`).
- **Interactions**: wired in `cmd/aep-api/app.go:443-457,556,597`; mounted via `api/huma_register.go:53-57,84-85`, `api/internal.go:57,65`; `RegisterHandlers` (`app.go:597`) feeds GitHub events into `feature/webhook`'s router via a callback (task never imports `webhook`); codingagent structurally satisfies `TaskDispatcher`/`ProgressReader` (`ports.go`), wired at root (`app.go:702`), no concrete import.
- **Tests**: `task_diff_test.go` (186 LOC, 7 tests, pure diff/fingerprint funcs) — no `*_service_test.go`/`*_component_test.go`/`*_dbtest_test.go`; `TaskRepository`'s dbtest lives in `repositories/task_repository_dbtest_test.go`, outside the feature; service/stream/projector logic untested.
- **Refactor fit**: has the spine plus 2 extra `*_huma.go` sub-surfaces; carries `ports.go` (2 cross-feature ports: `TaskDispatcher`, `ProgressReader`) + `errors.go` (1 sentinel, `ErrTaskNotFound`) per the target doc's optional-extras list; `SkillResolver` stays inline in `task_service.go` (single-port rule), not `ports.go`; no `store.go` — gorm inline via `*gorm.DB` + `repositories.TaskRepository`. `handlers.go` holds the (non-Huma) GitHub webhook transition handlers — a naming outlier next to the `*_huma.go` files, though history is squashed to one import commit so no "predates" claim can be verified from git blame.

### internal/feature/webhook

- **Purpose** — inbound GitHub webhook receiver: routing-key resolve → org lookup → HMAC verify → dedup persist → dispatch (`webhook_controller.go:82-175`).
- **Lives here today** — 9 files, 1352 LOC: `installation_handlers.go` (340) App-lifecycle handlers + two-phase repo-removal cascade; `webhook_controller.go` (183) pipeline orchestrator; `routing_key.go` (188) installation/repo→ocOrgID + 60s `RoutingCache`; `verifier.go` (124) HMAC + refetch-on-mismatch; `secrets.go` (132) `GitServiceSecretProvider`; `deliveries.go` (128) `DeliveryStore` (PK dedup); `refetch_limiter.go` (81) token bucket; `router.go` (90) event→handler map; `verifier_test.go` (86).
- **Boundary** — imports `contracts`, `orgcreds`, `gitrepo`, `models`, `repositories` (`installation_handlers.go:27-31`); wired back from `cmd/aep-api/app.go` (construction, `:549-601`) and mounted at `api/webhook_routes.go:35` — `api/app.go` also imports the package, but only for the `Deps.WebhookController` interface field, not to call into it. `task.RegisterHandlers` (`task/handlers.go:50`) registers onto its `Router` via a func callback, not an import. `arch_test.go:74-78` hardcodes it into the feature slice for the services/controllers check only — no dedicated leaf/cycle check exists for it (arch-lock gap: hardcoded feature list).
- **Interactions** — wired once, `cmd/aep-api/app.go:549-601`: `orgcreds.CredentialService` satisfies both `OcOrgIDLookup` and `SecretFetcher`; `RegisterInstallationHandlers` + `task.RegisterHandlers` share one `Router`.
- **Tests** — only `verifier_test.go` (4 HMAC cases). Gaps: no test for `router.go` dispatch, `routing_key.go` cache, `deliveries.go` dedup, or the removal cascade.
- **Refactor fit** — no `*_huma.go`/`*_service.go`: raw non-Huma receiver, spine doesn't apply; logic stays split across `webhook_controller.go`/`router.go`/`installation_handlers.go`. No `store.go` (gorm inline) or `ports.go` — `OcOrgIDLookup`/`SecretFetcher`/`EventHandler` stay inline per-consumer. Sentinels (`ErrNoRoutingKey`, `ErrSignatureMismatch`/`ErrSignatureMalformed`) aren't in an `errors.go`.

## Testing strategy (the tree already accounts for it)

Yes — unit, component, and integration tests all have a home in the tree above, and the tier is signalled by **file suffix (and `testing.Short()`), not a separate directory**. This is not new design: `docs/design/bff-component-testing.md` (in-process tiers) and `docs/design/backend-testing.md` (integration over HTTP) already specify it implementation-ready. The structure here just makes room for it.

| Tier | Lives in (ideal tree) | HTTP? | Auth | Service | Store | Externals | Run by |
|---|---|---|---|---|---|---|---|
| **Unit (service)** | `feature/<f>/<f>_service_test.go` | no | n/a | real | mocked port | mocked | `make test` |
| **Unit (pure)** | `platform/**`, `arch/`, `api/*_test.go` guards | no | n/a | — | — | — | `make test` |
| **Component** *(the missing middle)* | `feature/<f>/<f>_component_test.go` + `platform/componenttest/` harness | **real handler, in-process** | **faked at `jwt.WithClaims` seam; gate ENFORCE** | real | mocked port | **mocked (moq)** | `make test` |
| **Store / integration-lite** | `feature/<f>/<f>_dbtest_test.go` (skips under `-short`) | no | n/a | real | **real Postgres**, `dbtest.New` template-clone | mocked | `make test-db` |
| **Integration (e2e-ish)** | root suite over HTTP (real token/stack) — owned by `backend-testing.md` - later job to implement | real, real router | **real token** | real | real | real | manual/CI |

**Two things the structure buys the tests:**
- The **component tier reuses the composition-root extraction directly** — its keystone (`bff-component-testing.md` §8.1 "shared `assemble` builder") *is* `internal/app.Build(cfg, deps)`. Extract that seam once and both the binary and every component test assemble the same real handler graph. No parallel wiring.
- Externals are faked at the **edge you already own**: `moq` mocks for out-of-process clients (openchoreo is the template — its `mocks/` already exist), a hand fake at the service port, and **auth via `jwt.WithClaims`** (a verified-claims seam that unit tests in `httpkit`/`humakit` already use). Nothing about the real router or gate is bypassed.

**The anti-duplication rule:** *each behavior is proven at exactly one tier — if you assert the same branch twice, delete the higher copy.*
- Business-logic branches → **unit** (many cheap cases, no HTTP).
- Validation / error-mapping / handler wiring → **component** (one or two representative cases per op).
- SQL-shaped behavior → **dbtest**.
- "Is every route org-scoped" → **arch test** (`TestNoClientSuppliedOrg`), zero per-op cost — so auth is *not* re-tested per feature.

**Current reality (grounded) — the gaps this closes:**

| Tier | Today | Gap |
|---|---|---|
| Unit | 50 `_test.go` files | healthy — leave it |
| Component | **1** real handler test (`project_huma_test.go`) + `humakit` | almost nonexistent; needs the `componenttest` harness |
| Store/DB | **2** `dbtest` test files, both in `repositories/` (task + repo) | zero feature-**service** DB tests (the persistence-testing work below fills this) |
| Integration | root `test/` suite **absent on this branch** | owned elsewhere; out of scope here |

**One security-relevant catch:** `project_huma_test.go` calls `humakit.SetGateMode(GateModeLog)` — a **global** flip — so the org-scoping/IDOR gate (the "security floor" strength) is currently **not** proven at the component tier. The component design's §8.3 kills that global flip so the gate runs in ENFORCE and the cross-org-404 / no-claims-401 behaviors are actually tested. Do this alongside the harness; it's the whole point of the tier.

> Ponytail note: don't build a fourth test framework. `dbtest.New` gives a real-Postgres clone (see below), `moq` fakes the client edge, `httptest`+`humatest` drive the handler. The only *new* code is one `componenttest` harness and the `app.Build` seam — both already on the roadmap.

### DB testing (the `dbtest` tier) — target design

Today's harness (shared dev DB + `AutoMigrate` per test + `org_id LIKE 'dbtest-%'` namespacing + `DELETE` cleanup) works for 3 files but doesn't streamline to the ~dozens of feature-service DB tests the target below wants. The target collapses the whole thing to **one call**:

```go
func TestTaskRepo_OrgIsolation(t *testing.T) {
    t.Parallel()
    db := dbtest.New(t)                       // fresh, fully-migrated, isolated, auto-dropped
    repo := repositories.NewTaskRepository(db) // ...just write the test.
}
```

No `Migrate(...)` (test author picking models), no `CleanupRows(...)`, no `dbtest-` prefix, no "can't run parallel." `dbtest.New` hands back a pristine per-test database and drops it on `t.Cleanup`.

**How `New` works — template-clone, not truncate/transaction:**
1. **Once per run:** start **one throwaway Postgres via testcontainers-go** (`postgres:17` module), started once in a package-level `TestMain`/`sync.Once` and reused, then migrated **once** with the real `migrations.RunAll` into a **template** database. testcontainers is the pinned backing store — fully hermetic, so a test run depends on nothing but Docker (no compose stack, no `:5433`, no shared server to collide on). This is the schema-fidelity fix *and* the "migrate once" speed win in a single step.
2. **Per test:** `CREATE DATABASE … TEMPLATE <migrated-template>` inside that container — a Postgres file-copy in **single-digit ms**, so each test gets a pristine, fully-migrated, fully-isolated DB; dropped on cleanup. The container dies with the run.

This clone-per-test model is the streamlined answer because it removes work instead of adding it: **deletes** `dbtest.Migrate`, `dbtest.CleanupRows`, the namespacing convention, the no-parallel constraint, and the `AutoMigrate` fidelity gap — the harness *and* every test shrink. Don't hand-roll the template/hash bookkeeping: **`pgtestdb`** (`github.com/peterldowns/pgtestdb`) implements exactly this (template keyed by a migrations hash, clone-per-test, drop-on-pass, parallel-safe) — wrap it behind `dbtest.New`, point its DSN at the testcontainers Postgres, and give it `migrations.RunAll` as the migrator. (`dbtest.New` owns starting the container once and threading that DSN in, so tests never see either.)

**Why the "obvious" streamlines are wrong here (keep these decisions):**
- **Transaction-per-test rollback (`go-txdb`, wrap-in-tx)** — the usual fast-isolation trick — is **unusable**: production code runs `FOR UPDATE SKIP LOCKED` (`codingagent` watchers, `task/projector.go`) and manual `Begin/Commit` (`task/task_stream.go`); an outer wrapping txn silently breaks skip-locked and commit visibility. Template-clone keeps each test a *real* separate DB with real transactions, so those paths test truthfully.
- **SQLite-in-memory** is out for the same fidelity reason — no `FOR UPDATE SKIP LOCKED`, no partial/CHECK indexes. Real Postgres stays.
- **Truncate-between-tests in one shared DB** is a half-measure: still serial (parallel tests truncate each other), still needs a table list. Template-clone is strictly better and simpler.

**Fast lane:** replace the `//go:build dbtest` compile-world split with the stdlib convention — `dbtest.New` calls `t.Skip` under `testing.Short()`, so `make test` = `go test -short ./...` (no DB, no container) and `make test-db` = full. All tests then compile in one world (better IDE/refactor/rename safety) instead of a tag-gated island.

**Caveats (honest):** two focused deps (`pgtestdb` + `testcontainers-go`); **Docker must be present** wherever DB tests run (CI runners included) — that's the price of hermeticity, and it's why the fast lane is `-short` (unit/component need no Docker at all). Container start is ~1–3 s **once per package** (not per test); the superuser role in the throwaway container has `CREATEDB` by default, so template cloning just works. Net still positive — it retires more code and a whole class of cleanup-discipline bugs than it introduces, which is the right trade for a **target-state** harness.

### Git testing (the `gittest` tier) + the git-provider seam — target design

`gitrepo` (0 tests) and `artifacts` (git-exec + save paths at 0) can't be tested above the git layer without a harness — and mocking git behind a giant interface hides the thing under test. The target is one small harness plus a provider seam, designed together because they share a boundary line:

**The boundary fact that shapes both:** the git-exec layer is **already provider-neutral**. `gitOpsService` (clone/fetch/update-ref/read-tree) and artifacts' reads/discard/versions (`ls-tree`/`show`/`checkout <tag>`/`hash-object`/`status --porcelain`) run plain `git` against a clone whose origin is just `RepoURL` — GitLab/Gitea serve the same protocol over HTTPS+token. All provider coupling lives in the HTTP layer (`github_client.go`/`github_v2_client.go`, base URL hardcoded ×36) and in who constructs it.

**`internal/platform/gittest`** (sibling of `dbtest`/`componenttest`) — three pieces:

1. **`gittest.NewRemote(t)`** — a bare repo in `t.TempDir()` acting as origin (`file://` URL: `git clone`/`fetch --tags`/push work unchanged; GIT_ASKPASS simply never fires on file remotes). Seed/tag/read helpers for arrange + assert, all via git plumbing. **No Docker, no network — this tier runs in the fast `make test` lane**, unlike dbtest.
2. **`gittest.GitDataServer(r)`** — an `httptest.Server` implementing the 11 Git Data API endpoints the save flow drives (refs / commits / trees / blobs / tag objects / matching-refs), **backed by the same bare repo** via plumbing: `hash-object -w`, temp-index `read-tree` + `update-index --index-info` + `write-tree`, `commit-tree`, `mktag`, `update-ref`. CAS is **server-derived exactly like GitHub's** (the client sends no expected-old SHA — `github_artifacts.go:417` sends only `{sha, force}`): with `force=false` the current tip must be an ancestor of the new SHA (`merge-base --is-ancestor`), so a non-fast-forward is a **real** 422 → `ErrRefNotFastForward` and a taken tag ref a real 422 → `ErrTagAlreadyExists` (both sentinels are status-only in the client — body unparsed) — `conflict_retry.go`'s CAS + tag-collision paths run against genuine git semantics, not simulated errors (a `BeforeUpdateRef` hook lets a test advance main "externally" mid-save to force retries deterministically). And since the API server and the clone's origin share one object store, save→tag→post-save-pull→read-at-tag→discard runs genuinely end to end, offline, over the **real** HTTP client (whose 422→sentinel error mapping finally gets tested).
3. A route-registry **`stubGitHub`** (the orgcreds `WithGitHubAPIBase` pattern, already proven in credential tests) for the plain JSON CRUD endpoints — repo create/adopt, issues, webhook registration, Projects-v2 GraphQL. A git-backed fake would be over-engineering there.

**Fidelity caveat (honest):** GitDataServer fakes GitHub's JSON envelope; its scope is exactly the fields our client reads. Real-GitHub drift stays integration-owned (harvest goldens + the live demo are the oracle).

**The git-provider seam:** support switching git hosts (GitHub today, GitLab et al. later) without touching consumers.

- **Ports, defined in `gitrepo`, provider-neutral, capability-sliced:** `GitData` (blobs/trees/commits/refs/tags — what artifacts' save flow drives), `RepoAdmin`, `IssueOps`, `WebhookOps`, `BoardOps`. These are git/domain concepts; GitLab's Repository/Commits/Refs APIs map onto `GitData` directly. The retry sentinels (`ErrRefNotFastForward`, `ErrTagAlreadyExists`, `ErrRepoNotFound`) are part of the **port contract** — `conflict_retry.go` and consumers key off them, so any implementation must return them.
- **Implementation lives in `clients/github/`** (→ `internal/clients/github/`), **not** a `gitrepo` subpackage — features keep no subpackages (arch-lock rule above), and `clients/` is already the one house for out-of-process integrations, openchoreo-template style. The GraphQL v2 client folds inside as an implementation detail of `BoardOps` — REST-vs-GraphQL stops leaking into wiring. The base URL becomes client Config (killing the ×36 hardcode; the interim pin-phase seam is a `WithAPIBase` setter, superseded by Config at the move).
- **Selection:** `GIT_PROVIDER` env (default and only valid value `github`), one `switch` in the composition root, boot error on anything else. **Explicitly NOT a framework:** no provider registry, no capability enums, no config plumbing for providers that don't exist — `secretmanagersvc`'s dead provider framework is the documented anti-pattern here. A GitLab impl later = one new `clients/gitlab/` package + one switch case + zero consumer changes, verified by pointing the artifacts save-flow tests (the de-facto provider contract suite) at its constructor.
- **Wiring hazard to fix with the seam:** `webhook_service.go` silently type-asserts its `IssueService` param to the concrete `*issueService` (`is, _ := issueSvc.(*issueService)`) — an alternate impl or test double leaves the field nil with no compile error. Store the interface.
- **Provider-coupling map (outside this seam's scope, documented so it isn't forgotten):** the inbound `webhook` feature (X-Hub-Signature-256 + GitHub event names), `orgcreds` (PAT/App credentialing is GitHub-specific by nature), and the runner's `gh` CLI usage. Each is its own seam if/when a second provider becomes real.

**Test placement:** gitrepo/artifacts tests are ordinary suffix-tier files (`*_service_test.go` etc. per the table above) that *use* the harness — `gittest` adds no new tier, and needs no `-short` skip (local git is ms-fast).

## What moves, and is it worth it

| Move | Area | Value | Churn | Verdict |
|---|---|---|---|---|
| `middleware/` → `internal/platform/{auth,obs}` | auth | High — kills the two-auth-homes confusion + duplicate verifiers | M | **Do it** |
| Extract `internal/app` (`Build`+`Bootstrap`) + `database/migrations` registry | composition root | High — makes the whole app testable | L | **Do it** |
| `repositories/*` → `internal/feature/<f>/store.go` | persistence | Medium — the last flat layer, but only 3 repos exist; 8 features already keep gorm inline | M | **Gated** — fold when you're editing that feature; not now |
| `models/` → `internal/domain/` + relocate single-feature types | domain model | Medium — shrinks the god-kernel, honest name | M | Do the cheap half (a file *split*, not a clean move); the `domain` rename is optional |
| `api/`, `clients/`, `config/`, `database/` → under `internal/` | import hygiene | Low-Medium — lets the arch test police the *whole* graph | M (plain import-path churn — the old `api/openapi.yaml` literal + drift-guard that made `api/` special were removed) | Do it **when** you're already touching the arch-lock work; pure hygiene otherwise |
| `utils/validate` → `internal/platform/validate` (or into `httpkit`) | — | Low — cosmetic consolidation | S | Fold opportunistically |

**Not worth it:** renaming for its own sake, splitting cohesive files by line-count (`trait_sync.go` stays), or adding `store.go`/`ports.go`/interfaces to features that have no second impl and no faking test. The structure above is a target to *converge on while touching each area* (per the sequencing) — not a big-bang move-everything PR, which would be one giant reviewer-hostile diff for mostly-cosmetic gain.
