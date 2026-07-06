# services/aep-api — Architecture Improvement Plan

> Architect review of `services/aep-api` on readability, maintainability, boundaries, and testability.
> Produced 2026-06-30 (branch `aep-rewrite`). Method: 7 parallel area reviews (legacy layers, feature internals, boundaries/seams, platform layer, composition/API, clients, testability) → synthesis. Evidence is grep-confirmed against the tree at review time; verify line numbers before acting.
>
> **Update 2026-07-01:** Themes 1, 2, and 5 have shipped, along with the `ActorFromContext` bug fix and the `go.work` wiring from Theme 3. **Theme 2** (kill the `ServiceWithX` setter ceremony) removed all 12 optional interfaces + 12 compile-guard vars + 12 type-assert blocks — constructors now return concrete `*xService` and `main` calls setters directly. **Theme 5** (composition root) extracted `buildApp(cfg, db) (*App, error)` into `cmd/aep-api/app.go` (`func main` is now ~86 lines), folded the ~19 inline migration blocks into `migrations.RunAll`, and added `Config.Validate()` + a `config_test.go`. **Theme 4** (auth consolidation) is **done**: the duplicate task-JWT verifier is retired — `auth.RunnerScopedInput` is the sole path, `middleware/task_bearer` + the unscoped `/internal/v1/credentials/refresh` route + orphaned `BFF_JWKS_URL`/`TASK_JWT_*` config are deleted, gated on cutting the `runners/remote-worker` runner over to the path-scoped endpoint (done in the same change); the publisher-cc cross-org fence is now tested; and `internal/auth/scope` was folded into `internal/platform/auth` (dir deleted, one auth home). Adjacent cleanup from the earlier pass: the `example-server`/`@aep/core` playground scaffold and the OpenAPI drift-guard + committed specs were removed (Huma serves the spec live at `/openapi.yaml`). Completed items are marked ✅ below; **remaining work is Themes 6–8, the rest of Theme 3, and the bigger bets.**

## TL;DR

The codebase is **healthy**. The vertical-slice migration (14 features under `internal/feature/*`, each owning its Huma surface + service + consumer ports) is the good part and must not be churned: clean transport/domain split, a real cycle-breaking `internal/contracts` leaf, by-construction org-scoping that makes cross-org requests un-representable, and a confined OpenBao import fence. The debt is almost entirely **leftover scaffolding from a half-finished flat→vertical migration plus self-inflicted wiring ceremony** — not a deep design flaw. The single biggest structural debt is the **1124-LOC `func main` composition root and the `ServiceWithX` setter-interface pattern it forces**: the wired app cannot be assembled in a test, and every dependency-adding PR pays a 4-edit tax. Most of the rest is pure deletion. Almost nothing here calls for new abstraction.

---

## Architecture as-is

```
                 cmd/aep-api/main.go  (1124-LOC func main = the ONLY assembly site)
                          │ wires
        ┌─────────────────┼──────────────────────────────┐
   api/ (surfaces.go, public/internal Huma factories — clean)
        │
  internal/feature/* ── 14 vertical slices (<feat>_huma.go + _service.go)
        │  depend DOWN on ▼            consumer-side ports break cycles ↑ (contracts)
  ── flat shared substrate (survived the migration) ──
     models/ (1349 LOC, 77 importers)   repositories/ (3 repos)   clients/ (13 dirs)
        │
  internal/platform/* (ids,k8sname,tenant,httpkit,humakit,obs,auth,dbtest) — small leaves
  internal/contracts  — stdlib-only leaf (task lifecycle algebra); models RE-EXPORTS it
  internal/arch/arch_test.go — boundary lock via `go list -deps` (but see Theme 3)
```

Honest read: vertical slices over a **deliberately-shared flat kernel** (`models/` + `repositories/` + `clients/`). The slices are well-factored; the kernel is fine as a kernel. The migration dissolved the *stateless* flat layers (`services/`, `controllers/`) but left the *stateful* ones — and left dead copies of the old transport/validation code inside the slices.

---

## What's working — do not churn

| Strength | Evidence |
|---|---|
| Vertical slices are well-factored, none a monster | largest `orgcreds` ~3954 LOC; zero `huma` imports leak into `_service.go` |
| `internal/contracts` is a genuine stdlib-only leaf | imports only `context`/`errors`; really cuts task↔codingagent + design↔task cycles |
| Consumer-side ports for cross-feature edges | `task.BuildDispatcher`, `trait_sync.OrgPublisher`, `codingagent.taskTokenIssuer` — textbook ISP, wired at root |
| By-construction org-scoping | `humakit.OrgScopedInput`/`scope.RunnerScopedInput` → org from verified token only; locked by arch test + `TestNoClientSuppliedOrg`. **Security floor — do not touch.** |
| `internal/credentials` is a real deep module | polymorphic `Credential` (App-install + user-PAT), OpenBao confined by `import_fence_test.go` |
| `api/surfaces.go` + public/internal spec split | whole request boundary on one screen; `RegisterAllHuma` reused for handler mount + a nil-deps registration/spec guard |
| `clients/openchoreo` | shared transport + sentinel errors + sealed `gen` (fence-tested) + moq mocks — the **template** for other clients |
| `dbtest` harness + httptest client tests | build-tagged, skips without Postgres, namespaced isolation — lazy-correct for now (target streamlines it — see [target-structure](./aep-api-target-structure.md#db-testing-the-dbtest-tier--target-design)) |

---

## Prioritized improvements (ROI order)

### Theme 1 — Dead-code sweep · ✅ Done 2026-07-01
Shipped (~800 LOC net removed): the 5 `validation.go` + `organization_controller.go` + `httpkit.RequireSlug`; the `tenant` read-side (`Scope`/`MustOrg`/`FromContext`/`Resolver`/`ErrNoScope`/`ErrOrgMismatch`/`ProjectID`) + the 4 unused `Source` values; the `requests` fluent builder (`http_request`/`send_request`/`http_error`) with `translateComponentHTTPError` gutted; `internal/platform/ids` (repointed to `validate.Slug`) + `humakit.OrgFromCtx`; the duplicate `Github*`/`GitHub*` config fields + dead `GitHubWebhookSecret`/`AgentsServiceURL`; the duplicated `splitAndTrim` (now `api.SplitAndTrim`); all `[SHAKEOUT]` logs; the 4 stale orgcreds package headers. The `httpkit.ActorFromContext` "actor = `unknown`" bug was **fixed** (now reads the verified JWT subject) + covered by a test.

**Carve-outs / still open:** the 4 unused `clients/openchoreo/mocks` were **kept** — they're moq-generated build artifacts, regenerable on demand, not hand-written test code. The dead `tenant.With` write in `task_bearer.go:65` is **deferred to Theme 4** (removing it touches the task-bearer middleware). The `obs` vs `middleware/correlation_id.go` one-home collapse is **still open**.

### Theme 2 — Kill the `ServiceWithX` setter ceremony · ✅ Done 2026-07-01
Shipped exactly as recommended. All 7 setter-services (`design`, `dispatch`, `task`, `project`, `organization`, `requirements`, `progress`) now return the **concrete** `*xService` from their constructors; `main`/`buildApp` call `.SetX(...)` / `.WithX(...)` directly. **Removed: 12 `XServiceWith*` interfaces + 12 compile-guard vars + 12 type-assert blocks.** Signature drift is now a compile error at the call site instead of a silently-skipped wire. The narrow `Service` interfaces stay where a handler/consumer actually consumes them (Go auto-converts the concrete). No test consumed any `With*` interface, so nothing broke. (Doc said "14 guard vars" — actual was 12.)

### Theme 3 — Make the arch-lock honest and actually run it · Effort S–M · Risk low
The advertised "arch-locked" invariant is the migration's main safeguard, and today it's partly theater. (✅ 2026-07-01: aep-api is now a `go.work` member, so `make build`/`test`/`lint` run it — the OpenAPI drift-guard was also removed since Huma serves the spec live. The items below make the arch-test itself honest.)

| Fix | Evidence | Effort |
|---|---|---|
| Replace the 4-edge **denylist** (`TestTaskCodingagentCycleBroken`) with a **DFS acyclic check** over the feature→feature subgraph built from the `go list -deps` output you already have | actual graph has 21 edges, only 4 checked; doc *claims* an allowlist that doesn't exist | M |
| Replace hardcoded 14-feature slice with `os.ReadDir("../feature")`; same for the 3-element platform-leaf literal | a 15th feature escapes every assertion silently | S |
| Delete `&& d != mod+"/models"` from `TestContractsIsLeaf` | whitelist permits exactly the cycle the contracts doc forbids; branch is dead | S |
| Delete `TestGateInvariant` (`gate_invariant_test.go`) | scans `*_routes.go` which no longer hold gated routes; passes by inspecting an empty room. `TestNoClientSuppliedOrg` already enforces the real invariant | S |
| Fix doc comments: `models→contracts` (not the reverse `arch_test.go:152` claims); drop `depCacheMu` (no `t.Parallel()`) | — | S |

### Theme 4 — Consolidate auth into one home · ✅ Done 2026-07-01
- **Problem:** Auth/identity spread over 6 packages in 3 top-level trees: `middleware/{jwt,jwtassertion,task_bearer,auth_token}`, `internal/platform/auth`, `internal/auth/scope`, `internal/platform/tenant`. The BFF task-JWT is verified by **two independent paths** — `task_bearer.go:40` (via `jwtassertion`) and `scope/runner.go:80` (via `auth.TaskTokenManager.Verify`) — both re-implementing the INT-6 `taskId==path` fence; only one enforces the publisher fallback. **Two packages both named `auth`** at different depths. 6 claim structs.
- **✅ Done — the duplicate verifier is gone.** `scope.RunnerScopedInput` (path-scoped `/internal/v1/tasks/{taskId}/credentials/refresh`, dual-token) is now the **only** task-JWT path. The parallel `jwtassertion` route was **retired**: deleted `middleware/task_bearer.go`, the unscoped `POST /internal/v1/credentials/refresh` mount (`surfaces.go`), `credentials_refresh_controller.go`, `internal/credentials/bearer.go` (`TaskBearerClaims`), the `taskJWT` verifier wiring, and the now-dead `BFF_JWKS_URL`/`TASK_JWT_ISSUER`/`TASK_JWT_AUDIENCE` config + env (docker-compose + helm). **Prerequisite shipped in the same change:** the runner (`runners/remote-worker`) was cut over to always call the path-scoped endpoint in both auth modes (oneshot clone, credhelper.sh, gh-wrapper) — it verified the legacy AEP_BEARER Task-JWT is accepted there (Task-JWT tried first). Also **added** `TestRunnerAuthorizer_PublisherCC` covering the previously-untested publisher-cc cross-org fence. **Rollout note:** deploy the runner image before/with the aep-api that drops the legacy route, or in-flight jobs on an old runner image 404 on refresh.
- **✅ Also done — the package fold.** `internal/auth/scope` (`RunnerAuthorizer` + `RunnerScopedInput` + `SecurityRunner`) was folded into `internal/platform/auth` (now `runner.go` beside the token verifiers it drives); the `internal/auth/` directory is deleted, ending the dir-vs-package `auth` confusion. `TaskOrgLookup` is still injected as a func, so `platform/auth` stays a leaf (arch-lock's leaf check for `platform/auth` still passes). The IDOR guard `TestNoClientSuppliedOrg` was repointed to the moved `runner.go` and still enforces (no client-supplied-org struct tags). Behaviour-neutral: no route, token, or output-type change — `tenant.Caller` was already the single output. Remaining redundant claim structs: `TaskBearerClaims` was already deleted with the legacy verifier; the rest (`jwtassertion` user-JWT claims, `PublisherClaims`, task-token claims) are genuinely distinct token types and stay.

### Theme 5 — Extract a `buildApp` seam from god `main.go` · ✅ Done 2026-07-01
Shipped all three parts, done **after** Theme 2 so the wiring was already direct:
  1. **`migrations.RunAll(ctx, db, tier)`** (`database/migrations/run_all.go`) — an ordered `{name, run}` step list with a per-step timeout for the context-taking migrations, folding the ~19 copy-pasted `os.Exit` blocks (incl. the interleaved `AutoMigrate(GitRepository)` + composite-unique ordering) into one place. Fails fast, naming the step.
  2. **`Config.Validate()`** (called at end of `Load()`) + a table-driven **`config_test.go`** (none existed). Scope-correction: the doc's "~30 scattered `os.Exit` config checks" was an over-count — only the `credKey` base64/32-byte check was a genuine config-format check (the rest were migrations or operational failures), so `Validate` owns just that. No speculative tier-conditional checks added (YAGNI).
  3. **`buildApp(cfg, db) (*App, error)`** in **`cmd/aep-api/app.go`**, returning `{Handler, Watchers}`; `func main` shrank from ~960 to **~86 lines** (load+validate cfg, open db, `RunBootstrapGrants`+`RunAll`, `buildApp`, serve, start watchers, shutdown). Every `os.Exit` in the wiring became a `return nil, err`. Watchers are collected into `App.Watchers` (a local `watcher` interface = `Run(context.Context)`) and started by `main` under one cancellable context.
- **Deviation from the ideal tree:** `buildApp` lives in `package main` (`cmd/aep-api/app.go`), **not** a new `internal/app` package — that (plus the `Build`/`Bootstrap` split) is the ideal-tree end-state, explicitly gated. A component test can already call `buildApp(testCfg, dbtestDB)` for the in-process handler seam.

### Theme 6 — Persistence: test it, don't restructure it · Effort M · Risk low
- **Disagreement, resolved:** Reviewer 1 wants a uniform per-feature `store.go` rule; Reviewer 6 says the `*gorm.DB` param **is** already the seam and only tests are missing. **Side with Reviewer 6** — the lazy verdict. The 3 blessed repos (task/config/repo) are fine; the ~16 services embedding `*gorm.DB` (`idp`, `organization`, `deliveries`, `projector`, `orgcreds`) are *untested, not untestable*.
- **Recommendation:** Do **not** add repository interfaces everywhere (heavy, speculative). Write `dbtest` tests directly against the existing constructors — `dbtest.Open(t)` + real service, ~30 lines each, identical to `task_repository_dbtest_test.go`. Leave `repositories/` and the inline-gorm services exactly as they are. (Optional later: move the 3 flat repos in-feature for consistency — gated on real friction, not now.)
- **Risk:** Low — additive tests only.

### Theme 7 — Give `clients/` a house style + close one test gap · Effort M · Risk medium
- **Problem:** Every non-openchoreo client invents its own shape: return interface vs concrete; failure policy ranges from **panic** (`clustergatewayproxy.New`, openchoreo ctors) to `(nil,nil)` footgun (`observer.NewClient:77`) to `(T,error)`; Config-struct vs positional args. Token-cache + "401-invalidate-retry" are hand-rolled in `thundersvc`/`observer` instead of reusing `oauth.TokenProvider` + `requests.RetryableHTTPClient` (so correlation IDs + jittered retry silently skip 4 of 5 clients; skew drifts 30s vs 60s).
- **Recommendation:** Pick one shape (Config in, interface out, `(T,error)`, no panic, no sentinel-nil) and note it once in `clients/AGENTS.md`. Highest-value single fix: extract a **minimal consumer-side interface** for `clustergatewayproxy` (the few methods `codingagent` calls) + a moq mock — the dispatch/watch/progress paths are the most operationally critical code and have zero unit coverage. Route the hand-rolled HTTP clients through `httpx.WrapTransport` + `RetryableHTTPClient` incrementally. Rename `observer`/`observability` (one letter apart → wrong-import magnet) to `runlogs`/`buildlogs`; **do not merge** (different services/auth). Move `ProgressEvent`/`ParseProgressLine` out of `clients/observer` into the `codingagent` feature (it's domain logic, not a client).
- **Risk:** Medium — touches live integration paths; do one client at a time.

### Theme 8 — One shared OC-sentinel error mapper · Effort S · Risk low
`openchoreo.Err*→X` translation is copied 4 ways: `project/oc_error.go`, `organization_service.go:49`, `component_huma.go:237`, inline `errors.Is` in `orgcreds/build_credentials_service.go`. Add one helper next to `humakit.ErrorFromStatus`; delete `project/oc_error.go` + `organization.translateHTTPError`.

---

## Bigger bets (optional, gated on real pain)

| Bet | What | Why optional | Effort |
|---|---|---|---|
| Split `orgcreds` | 4 credential domains (github/anthropic/build) + a 1467-LOC `credential_service.go` god-file. Slice into `connect.go`/`installation_lifecycle.go`/`webhook_secrets.go`/`lookups.go` by the method groups that already exist — no new abstraction. | Highest cohesion debt, but it works today; pure readability ROI. Do it next time you're deep in a GitHub-cred change. | L |
| `models/` surgical relocation | Move the ~12 **single-feature** types (`Design`, `ProjectStatus`, `RequirementsBundle`, etc.) into their owning slice (mechanical, cycle-free, shrinks the god-package ~40%) + move free functions out (`wp_naming`→`k8sname`, `SlugForURL`→`gitrepo`). | The ~10 genuinely-shared entities (`GitRepository`, `ComponentTask`, `DesignComponent`) **stay** — they're shared because they cross slices; moving them re-creates the cycles the migration broke. Only do the cheap half. | M |
| Collapse `secretmanagersvc` | An external-secrets-style provider framework (registry + `Provider`/`SecretsClient`/`SecretManagementClient` interfaces + capability enum + OpenBao config + dual ctors) wrapping **one** HTTP backend; `GetProvider`/`Capabilities`/`OCClient` branch all zero-caller/always-nil. Keep the concrete SM-API client, delete the framework. | ~half the package is dead flexibility with no second impl. Big deletion win. | L |
| `gittest` helper for the artifact vertical | `artifacts.ArtifactStore` shells `exec.CommandContext("git",...)`, consumed concretely by design+dispatch → requirements (0 test), design (1 helper test) untestable above the git layer. Add a `dbtest`-style `git init` in `t.TempDir()` so each orchestration path gets ONE real-git test. **Do NOT mock git behind a giant interface — that hides the thing under test.** | git *is* the product; genuinely hard, not neglect. | L |

---

## Explicitly NOT recommended

- **Do NOT shatter `models/` per-feature.** It's a deliberate shared kernel (77 importers); a clean split relocates irreducible change-amplification *and* re-introduces the task↔codingagent cycle. Rename it honestly (`internal/domain`) if anything; otherwise leave it.
- **Do NOT add a repository interface for every entity.** The `*gorm.DB` param is already a test seam (Theme 6). Interfaces only where a sibling test actually fakes them.
- **Do NOT mock git behind an `ArtifactStore` interface.** Pull pure functions out + use a real-git temp dir (Theme 8 bet).
- **Do NOT split `component/trait_sync.go` for size.** 492 LOC but one cohesive reconciler, exceptionally documented (concurrency rationale, first-deploy race). Leave it.
- **Do NOT merge `observer`/`observability`.** Different services, different auth — rename, don't merge.
- **Do NOT replace `go list -deps` with a depguard/linter plugin.** The ~25-LOC plain-`go test` check is appropriately lazy; just make it honest (Theme 3).
- **"Thin = ceremony" is mostly false.** `idp` (704), `runtimeconfig`, `project` (4-file shape) are right-sized house style — leave them.
- **Don't demote the cycle-breaking consumer ports** (`trait_sync.OrgPublisher`, `codingagent.taskTokenIssuer`, `task.BuildDispatcher`). They earn their keep. Only single-impl **producer-side** interfaces with no faking test are candidates for demotion — and that's polish, not pain.
- **Don't grow more `platform` package globals.** `gateMode`/`runnerAuthorizer` are an accepted Huma constraint at wiring+tests; just stop there.

---

## Suggested sequencing

1. **Phase 0 — wire it up + sweep** · ✅ mostly done 2026-07-01: the `go.work` wiring, the Theme 1 dead-code sweep, and the `ActorFromContext` fix shipped — aep-api tests now run in the `make` fan-out. **Remaining:** Theme 3 arch-test honesty (DFS acyclic check, `os.ReadDir` feature list, drop the dead `models` whitelist branch, delete `TestGateInvariant`).
2. **Phase 1 — kill ceremony (Theme 2, M):** ✅ Done 2026-07-01. Concrete constructor returns + direct setter calls; deleted 36 symbols and pre-shrank `main.go` for Phase 2.
3. **Phase 2 — composition root (Theme 5, L):** ✅ Done 2026-07-01. `migrations.RunAll` + `Config.Validate` + `buildApp` (in `cmd/aep-api/app.go`). `func main` is ~86 lines and the graph is now assemblable in a test via `buildApp`.
4. **Phase 3 — fill the test vacuum (Theme 6 + Theme 7 clustergatewayproxy seam):** `dbtest` tests against the inline-gorm services + the one missing client mock, leveraging `buildApp`.
5. **Phase 4 — auth consolidation (Theme 4, M/L):** ✅ Done 2026-07-01. Duplicate task-JWT verifier retired (runner cut over to the path-scoped endpoint → deleted `task_bearer` + the unscoped route + orphaned config), publisher-cc fence tested, and `internal/auth/scope` folded into `internal/platform/auth`. Turned out **not** to need Phase 3 — the surviving path was already tested and the blocker was an external runner cutover, not coverage.
6. **Later, opportunistically:** Theme 8 + the bigger bets (orgcreds split, secretmanagersvc collapse, models surgical moves) — each gated on actually touching that area.

Phases 0–1 are the lazy unlock: they're almost all deletion and they make every later phase testable.

---

## Target directory & file structure

The end-state layout the themes converge on — the target tree, per-feature file conventions, and the test-tier mapping — lives in its own doc: [`aep-api-target-structure.md`](./aep-api-target-structure.md).

