# aep-api test-migration — execution plan & progress

> Living tracker for converging `services/aep-api` onto
> [`aep-api-target-structure.md`](./aep-api-target-structure.md) **behavior-for-behavior
> unchanged**, one component at a time, under a test net we build first.
> Strategy record: [ADR-0003](../decisions/ADR-0003-aep-api-test-migration-strategy.md).
> Terms: [`glossary.md` → Test-migration terms](../glossary.md).
>
> **The table columns below ARE the per-component done-gate.** Update this doc as
> work lands; the session TaskList is ephemeral working state, this is the record.

## Strategy in one screen

| # | Fork | Decision |
|---|---|---|
| 1 | Safety net | in-process tiers (unit + component + dbtest). Playwright golden = oracle, **not** the net |
| 2 | Model | characterize-then-refactor **in place** (cover-and-modify); **not** a strangler |
| 3 | Phase 0 | keystone first: harvest → `app.Build` → `componenttest`+ENFORCE → `dbtest.New`. Test-first is *within* features |
| 4 | Rollout | pilot-first. A = `project` (prove harness), B = `orgcreds` (prove restructure), then replicate |
| 5 | Done-gate | structure moved + behavior at right tier + goldens green. Anti-dup rule **softened**: purposeful dup OK |
| 6 | Honesty | coverage as gap-finder (no hard %) **+** agent-verification pass. Honesty & maintainability > coverage # |
| 7 | Progress | this doc (columns = done-gate) |
| 8 | Harvest | `playwright-cli` HAR-drive of the spine + rep errors → `testdata/harvest/`. One-time |
| 9 | Order | product spine; `gitrepo`+`artifacts` last (need a `gittest` harness); backend-only = no component tier |

## Phase 0 — keystone (once, before any feature)

> **Status (2026-07-02): COMPLETE — committed `a662e59`.** All four sub-phases
> landed + verified: `make test`/`make test-db` green; 0b golden before/after
> diff 35/37 byte-identical (2 restart-volatile fields only — progress `seq`
> counter + validator timestamp); live boot clean (19 migrations, 6 watchers);
> create-project→repo→delete demo smoke ok; agent code-review signed off (no
> blocking). Guard fix: stale `CreateGitSecret` term dropped from
> `check-no-legacy-creds`. The N1 follow-up (kill the process-global
> `humakit.gateMode`) landed with Pilot A: mode is now stamped per-request on
> the /api/ context by mountSurfaces and read by Resolve with a fail-secure
> ENFORCE default; the global and SetGateMode are deleted.

- [x] **0a — Harvest goldens.** Drive the console via `playwright-cli skill` with HAR
      capture + verbose aep-api logs over the happy-path spine (login → list orgs
      → create project → requirements → design → tasks → dispatch → status) plus
      a few representative error responses. Save under
      `services/aep-api/testdata/harvest/`.
- [x] **0b — Extract `internal/app`.** Move `buildApp` out of `package main` into
      `internal/app` as `Build(cfg, db) (*App, error)` (pure assembly) +
      `Bootstrap(ctx)` (migrations, grants, seed, credValidator). `main.go` shrinks
      to load/validate cfg → open db → Bootstrap → Build → serve → shutdown.
      **Protected by the 0a diff** (buildApp has zero coverage today): app boots
      and serves byte-identical golden responses before and after.
- [x] **0c — `componenttest` harness + gate ENFORCE.** New
      `internal/platform/componenttest/` assembles the **real** `/api` handler via
      `app.Build` with faked auth at the `jwt.WithClaims` seam and mocked clients;
      drives it with `httptest`. **Kill the global `SetGateMode(GateModeLog)` flip**
      so the org-scope/IDOR gate runs in ENFORCE — cross-org-404 / no-claims-401
      become actually testable. (bff-component-testing.md §8.1/§8.3.)
- [x] **0d — `dbtest.New`.** Stand up testcontainers `postgres:17` + `pgtestdb`
      template-clone behind `dbtest.New(t)`; `t.Skip` under `-short`. `make test` =
      `-short` (no Docker), `make test-db` = full. (target doc → DB testing.)

*0d runs parallel to 0b/0c. Exit Phase 0 when a throwaway `_component_test.go` and
a `dbtest.New` test both compile and pass.*

## Session state (2026-07-03 — MIGRATION COMPLETE)

> **15/15 rows committed.** Final phase landed: gittest harness `3acbc38`, seams `aa0933c`, gitrepo net `c9e299b`, artifacts net `9dd08ad`, provider-seam restructure `84e74b7`, review-gap fixes `d32ba80`. Review SIGN-OFF (9 mutations, relocation verbatim); full ADR demo PASS on rebuilt container; `make test` + `make test-db` green.
> **Upon Finish progress:** (1) DONE — convergence `6fdebaa` (internal/-only layout, middleware/utils dissolved) + arch-lock honesty `aa5b347` (edge allowlist both-ways, ReadDir discovery, layout check). (2) DONE — backlog fixes `c747e22` + `9060d76` (12 fixes incl. phantom-OU SECURITY + idp data-loss; reviewer mutation-verified, 1 blocker → lock-hold bounded `e9e45e6`) + cleanup `2c18535` (license-check GREEN repo-wide, gofmt clean, dead code out). (3) IN PROGRESS — coverage sweep verdict: net honest, security fixes real; sweep findings closed `b6112e7` (DeleteProject orphan purge — NEW bug root-causing the demo-teardown DB cleanup ritual — + real cascade-wiring test); remaining-gap batch (repositories real-PG proof, TraitSync tests, orgcreds SM/App paths, credentials resolver/minter, webhook secrets TTL, boundedDNSName, 2 dead-code deletions) in flight; THEN fresh-env teardown + final full ADR demo, iterate until stable.
> **Manual cleanup for the user (gh token scopes — delete_repo/read:project; `gh auth refresh -h github.com -s delete_repo,read:project`):** GitHub repos `asdlc-repos/feat89-demo891`, `asdlc-repos/gitphase-demo694`, `asdlc-repos/finale-demo094`; boards #224, #225, and finale-demo's (node `PVT_kwDOEJM9dM4BcVw2`).
> **Flake note:** one unreproduced artifacts -race failure right after the restructure (~20 green stress runs since, reviewer found no nondeterminism; monitor on recurrence).

## Previous session state (2026-07-02 ~16:20 UTC — batch 8+9 LANDED)

> **13/15 rows done + committed.** Batch 8+9 closed: `3660db0` (runtimeconfig) + `9801639` (webhook); suites green (`make test` + `make test-db`; one environmental OOM `signal: killed` on the requirements package during a full-lane run concurrent with a QEMU demo build — passed clean in isolation). Demo tail full PASS on `feat89-demo` incl. the env-config.js artifact proof; project/DB-rows/containers cleaned.
> **Leftover manual cleanup (gh token scopes):** delete GitHub repo `asdlc-repos/feat89-demo891` + GH project board #224 — blocked on missing `delete_repo`/`read:project` scopes; needs interactive `gh auth refresh -h github.com -s delete_repo,read:project`, then the two deletes.
> **REMAINING WORK:** only L1 `gitrepo` + L2 `artifacts`. The `gittest` design is **ALIGNED with the user (2026-07-02)** and recorded in `aep-api-target-structure.md` → "Git testing (the `gittest` tier) + the git-provider seam": bare-repo Remote + GitDataServer (httptest Git Data API backed by the same bare repo, real CAS 422s) + orgcreds-style stubGitHub; **plus a user-added requirement**: provider-switchable design (capability ports `GitData`/`RepoAdmin`/`IssueOps`/`WebhookOps`/`BoardOps` in gitrepo; GitHub impl → `clients/github/`; `GIT_PROVIDER` switch, github-only; NO registry/framework). Execution order: (1) harness agent → (2) pin: gitrepo + artifacts nets in parallel (+ WithAPIBase interim seam + webhook_service interface fix) → (3) restructure to ports/clients-github keeping green → (4) review + full demo + commits. Then the ADR "Upon Finish" pass (progress-note sweep, target-structure cross-check, final fresh-env demo).
> **Batch 8+9 findings — ALL RESOLVED in Upon Finish:** board invisibility FIXED (`c747e22`); cascade→runtimeconfig emitter wiring TESTED (`b6112e7`); webhook dead assertion deleted (`2c18535`).
> **Environmental note:** trait_sync watcher logs recurring reconcile 500s against `apii`/`hello-world-api` — pre-existing, consistent with the k8s TTL rot that also drifted 3 harvest goldens (re-baseline per landing).

## Phase 1+ — the per-feature loop (repeat in order)

For each feature, in the order below:

1. **Locate** its harvested fixtures (from 0a).
2. **Unit** — real service + mocked ports for logic branches. Red-green each
   (see it fail on a real break before green).
3. **Component** *(HTTP-surface features only)* — real handler via the harness,
   gate ENFORCE, harvested payloads as inputs: prove validation, error-mapping,
   and the IDOR/org-scope gate. 1–2 representative cases per op.
4. **dbtest** — `dbtest.New` for SQL-shaped behavior (isolation/IDOR queries, CAS,
   advisory locks, skip-locked).
5. **Restructure** — re-home files to the target vertical (under `internal/`,
   `*_huma.go` suffix, fold `oc_error.go`→shared mapper, split god-files) keeping
   every test green. Behavior unchanged vs goldens.
6. **Coverage** — review as a gap-finder; justify low spots, don't pad.
7. **Agent-verify** — run the test-quality reviewer (honesty / maintainability /
   tier-fit). Resolve findings.
8. **Land** — flip the row, one PR per feature.

**Done-gate (row complete)** = `moved` ✓ (or n/a) **and** every applicable tier ✓
**and** `golden` unchanged **and** `agent-verified` ✓.

## Order & progress tracker

Legend: `-` todo · `wip` · `✓` done · `n/a` not applicable · `A`/`B` pilot.
`comp` = component tier (HTTP-surface features only; backend-only = `n/a`).

| # | feature | kind | golden | unit | comp | dbtest | moved | agent-verified | notes |
|---|---------|------|:---:|:---:|:---:|:---:|:---:|:---:|---|
| A | project | HTTP | ✓ | ✓ | ✓ | ✓ | n/a | ✓ | **DONE 2026-07-02.** unit=`project_service_test` (ladder+best-effort chain, mutation-checked), comp=`project_component_test` (real chain, gate ENFORCE, golden-pinned 422/404/401 shapes, full `mapProjectError` table), dbtest=`project_dbtest_test` (org-scoped HasTasks vs real PG); `project_huma_test` demoted to spec-only. Dividends: killed global `humakit.gateMode` (ctx-stamped, fail-secure ENFORCE default) **and** latent `artifacts.splitDesignCatalogRef` global (caught by `-race`, catalog now instance-threaded). Goldens byte-identical (37/37); full demo (create→…→auto-deploy) PASS |
| 1 | requirements | HTTP | ✓ | ✓ | ✓ | ✓ | n/a | ✓ | **DONE 2026-07-02** (`86127ce`). 55+30 tests: unit incl. SSE-rule persistence + sibling loop; component 3 surfaces golden-pinned + 409 rides a REAL advisory lock; dbtest = the locker (mutex/contention/key-isolation). collab-validate = carve-out (gate n/a). Gaps integration-owned: SSE framing, StreamChat loop, collab header branches (harness can't set headers — possible extension) |
| 2 | design | HTTP | ✓ | ✓ | ✓ | n/a | n/a | ✓ | **DONE 2026-07-02** (`8d169e9`). 53 tests: unit incl. ErrSpecNotApproved gate + 3 consumer ports proven-called + SSE-rule persistence via real ArtifactStore; component 10 ops golden-pinned + full mapDesignError. dbtest genuinely n/a (no SQL in package). Flagged: stale $schema comment (api/huma.go), near-dead ErrDesignNotFound branch, stale SSE doc comments |
| 3 | task | HTTP | ✓ | ✓ | ✓ | ✓ | n/a | ✓ | **DONE 2026-07-02** (`4222e46`). 67 tests: projector dbtest centerpiece (advisory-lock serialization -race, 5-org×3-trial scoping after review B1, real webhook handler); stream per SSE rule incl. retry-exhaustion; component golden-pinned; S2S surface integration-owned (runnerAuthorizer global). ~~Flagged: NewTaskService dead params~~ **FIXED** (`c747e22`) — componentSvc/configSvc/tokenProvider removed. Board-invisibility root cause (partial GH-card sync hiding a live task, the feat45 orphaned-issue ticket) also **FIXED** here — `board_service.go` DB is now the source of truth |
| 3b | codingagent | backend | ✓ | ✓ | n/a | ✓ | n/a | ✓ | **DONE 2026-07-02** (`f0a2235`). 64 tests: watcher dbtests run PRODUCTION claim SQL via consts + structural SKIP-LOCKED guard (review B2); dispatcher wire-faked through real proxy client; DispatchTasks orchestration integration-owned. ~~CONFIRMED latent findings ticketed: cascade-hook advisory lock is a no-op~~ **FIXED** (`c747e22`: lock+cascade now run in one real `db.Transaction`, `TestDispatchCascadeHook_OnTaskDeployed_SerialisesConcurrentDeploys` proves peak-concurrency 2→1; `e9e45e6` then bounded the now-real lock hold — 30s k8s client timeout + 10m hook deadline, closing the "unbounded lock" review finding the fix itself introduced). Sweep row-lock-release timing reclassified as intentional/documented, not a live bug (comments rewritten in `build_watcher.go`/`on_hold_watcher.go`; real safety is the projector's per-task advisory lock + idempotent `ApplyTaskEvent`). **Coverage-sweep finding (2026-07-03, still open):** `SetTraitSync`/`SetRuntimeConfig` — the two production-wired re-emit branches inside the now-real lock — are never exercised by any test (hook is always constructed with both nil); see `docs/design/aep-api-test-migration-progress.md` session note below for the minimal fix shape |
| 4 | component | HTTP | ✓ | ✓ | ✓ | ✓ | n/a | ✓ | **DONE 2026-07-02** (`f4a5b87`). 47 tests: TriggerBuild secret-staging, config mirror, watcher budget + DISTINCT-tuple dbtest (7-decoy scoping), null-config + 409-webapp-openapi quirks pinned. ~~CONFIRMED bugs ticketed (shared-OC-mapper fixes both)~~ **FIXED+TESTED** (`9060d76`, new `internal/platform/ocerr` shared mapper): OC 401/403/409 no longer collapse to 500; get-component 404 (was unreachable, wrong sentinel) now fires. **Coverage-sweep finding (2026-07-03, still open):** `TraitSyncService.SyncProjectAPITraits`/`siblingSPAOrigins` — live prod code invoked by every dispatch cascade, zero tests anywhere; not previously flagged |
| 5 | skills | HTTP | ✓ | ✓ | ✓ | n/a | n/a | ✓ | **DONE 2026-07-02** (`d89a0bb`). 52 tests: HTTP surface (was zero) over real services + fake GitHub via export_test bridge; reconcile/import/CAS-exhaustion units. ~~Flagged: MarshalValidationIssues dead code~~ **DELETED** (`2c18535`); goldens carry stale asdlc.version keys. Demo proved dispatch-time skill materialization |
| 6 | idp | HTTP | ✓ | ✓ | ✓ | ✓ | n/a | ✓ | **DONE 2026-07-02** (`c9740f3`). 704 LOC, ZERO tests before. Unit: secret-non-leak (byte-checked), empty-orgID guards ×6, Thunder-unavailable classification. dbtest: GetOrCreateProfile idempotency+self-heal, publisher lifecycle w/ `idp_audit_events` (kinds/actor/no-partial-damage), issuer-only-preserves vs kind-change-clears, 8-decoy org scoping (mutation-verified). Component: golden-pinned get/discovery + 400/502/503 + 422-vs-400, ENFORCE 401. Discovery IS gated (embeds OrgScopedInput; earlier carve-out guess wrong). ~~LATENT BUG pinned+ticketed: platform self-heal clobbers BYO custom issuer~~ **FIXED+TESTED** (`c747e22`: self-heal now gated on `existing.Kind == "platform"`; `TestGetOrCreateProfile_SelfHealPreservesCustomIssuer_DB` red→green) |
| 7 | organization | HTTP | ✓ | ✓ | ✓ | ✓ | n/a | ✓ | **DONE 2026-07-02** (`f1475db`). Kept `ou_validation_test`. Unit: List short-circuit, translateHTTPError/mapOrganizationError (401 not collapsed, opaque no-leak), warm-cache zero-IO. dbtest: `EnsureForOuHandle` JIT side-car — backfill/cache-served/TTL-re-verify (OC call-counted), singleflight 10→1 (-race), 6-decoy name scoping (mutation-verified). Component: list-organizations golden; carve-out pinned POSITIVELY (tokenless 200) → deliberately no NoAuth-401 row. ~~LATENT SECURITY BUG pinned+ticketed: phantom-OU trust guard misses the fresh-org NULL→set path~~ **FIXED+TESTED** (`9060d76`: `ensureThunderUUID` now runs `ouIsTrustworthy` before any write, NULL-set path included; `TestEnsureForOuHandle_PhantomOnFreshOrgIsRejected_DB` red→green) |
| B | orgcreds | HTTP | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **DONE 2026-07-02** (`5e314a4`). Pinned FIRST (~80 funcs: unit probes/bearer/error-map; dbtest connect/replace/drift/webhook-secrets/installs/disconnect-cascade/org-isolation; component=DB-backed flavor, golden field-sets, ENFORCE), THEN split `credential_service.go` 1478→7 files (core+connect/lifecycle/identity/webhook_secrets/installations/github_probe) — review proved relocation-only at AST level. Seams added: `WithGitHubAPIBase`/`WithAnthropicAPIBase`. Goldens 37/37 identical; full demo PASS (deployed 200). Honest gaps (integration-owned): App-mode connect beyond entry guards (needs real App key), raw OAuth callback. **Coverage-sweep finding (2026-07-03):** the "k8s SSA / SM-API mirror = integration-owned" call was too broad — `sm_api_writer.go` (5 methods) and the App-install path (`credential_installations.go`) are trivially fakeable (the `AppTokenMinter` test already fakes an RSA key + httptest server for this exact shape) and are genuine gaps, not integration-owned. ~~Quirks pinned+flagged: 500-detail leak in `mapCredentialError`, dead `disconnecting` branches, replace-timestamp mismatch, Anthropic-5xx→400~~ **ALL FOUR FIXED+TESTED** (`9060d76`: opaque error mapping via `ocerr`, dead branches deleted, `RETURNING connected_at` timestamp fix, Anthropic 5xx→502) |
| 8 | runtimeconfig | backend | ✓ | ✓ | n/a | n/a | n/a | ✓ | **DONE 2026-07-02** (`3660db0`). runtime_config_emit_test.go: 6 funcs/37 subtests — emit path (was 0%): buildEnvValues ready-gating, layerThunderKeys THUNDER_*, EmitForComponent/ProjectSPAs w/ captured env-config.js payload; real ArtifactStore over artifactstest; mutation-verified. dbtest genuinely n/a (no SQL). Demo artifact proof: deployed hello-web SPA served env-config.js containing hello-api's live endpoint URL. Notes: sibling URLs come from DependsOn (not DependentApis); benign trailing-slash inconsistency flagged |
| 9 | webhook | backend | ✓ | ✓ | ✓* | ✓ | n/a | ✓ | **DONE 2026-07-02** (`9801639`). 44 funcs/7 files: router/routing_key/refetch/verifier-refetch units; dbtest = DeliveryStore PK-dedup + installation cascade; *raw-receiver suite (plain httptest, NOT componenttest — non-Huma) owns HMAC valid→200/forged→401-and-NEVER-persisted/dup→no-redispatch/fail→500+redelivery-reruns per §7. First author died on billing limit; second fixed a jsonb byte-verbatim TEST bug + wrote the receiver file. Reviewer's 6 mutations incl. verify-before-persist order swap all caught. Demo: ready_for_review ×2, merge→building in seconds ×2, build→deployed ×2, cascade on_hold→in_progress — all live |
| L1 | gitrepo | backend | ✓ | ✓ | n/a | n/a | ✓ | ✓ | **DONE 2026-07-02/03** (harness `3acbc38`, seams `aa0933c`, net `c9e299b`, provider-seam `84e74b7`, review fixes `d32ba80`). 43 tests over `gittest` (real bare-repo origin, no Docker — fast lane): ErrCloneCorrupt data-loss guard, drafts-untouched pull, PreWarm skip rules, repo/issue/webhook/board over stub, client sentinel table, one GitData round-trip through the REAL client. Prod fixes: webhook_service silent concrete type-assert → interface + checked assertion; dead WithGraphQLEndpoint completed. **moved ✓ = the provider seam**: 6 capability ports (incl. honest GitHub-specific AppInstallOps), impls → `clients/github/` (relocation VERBATIM, reviewer-diffed), GIT_PROVIDER switch (github-only, boot error). dbtest n/a (persistence rides repositories' own dbtest). Review: 9 mutations, 8 caught + 1 gap closed (CreateTagRef 422 mapping — BeforeCreateTagRef hook + real-client test, kill verified). Demo (rebuilt container): full ADR flow PASS incl. GIT_PROVIDER default boot. **Coverage-sweep correction (2026-07-03):** the "rides repositories' own dbtest" claim overstated what that dbtest covers — `repositories/repo_repository_dbtest_test.go` and `task_repository_dbtest_test.go` each exercise only 2 of ~13 methods (`Create`+one lookup); `GetByOrgAndSlug`/`ListAllReady`/`Update`/`DeleteByOrgAndProjectID`/`LookupOrgProjectByRepoURL` (repo) and most of `TaskRepository`'s methods are never run against real Postgres by anything — every consumer fakes the repository interface instead of exercising the concrete GORM struct. Not a security/correctness risk (interfaces are exercised at every call site via fakes), but a real dbtest-tier gap worth a follow-up ticket |
| L2 | artifacts | backend | ✓ | ✓ | n/a | n/a | n/a | ✓ | **DONE 2026-07-02/03** (`9dd08ad` + `d32ba80`). 70 tests: git-exec paths + the ENTIRE save/conflict-retry flow (was 0%): saves over the REAL clients/github client against gittest.GitDataServer (same bare repo as origin → save→tag→post-save-pull→read-at-tag→discard genuinely end-to-end offline); CAS retry (real server-derived non-FF 422), budget exhaustion, REAL tag-collision 422 through the real client, tombstones + base_tree preservation, versions/discard/snapshots/If-Match, diff rename-expansion + nested-path regression pin. First author died mid-mutation-testing (one live mutation found + reverted); reviewer ran the full mutation pass instead. Post-save pull convergence genuinely asserted (rev-parse on the real clone). Demo: v1/v1-1 tags verified on the live repo |

**Sequencing notes**

- **Pilots first:** `project` (A) proves the harness with ~zero restructure;
  `orgcreds` (B) proves pin→restructure→keep-green on the worst god-file. Only
  after both do we commit the middle features to the same loop.
- **Spine order** (1→9) reuses harvested fixtures in flow order and follows the
  SDLC the platform embodies. `codingagent` (3b) rides with `task`.
- **`gitrepo` + `artifacts` (L1/L2) last.** Git-exec heavy, zero tests, need a
  dedicated `gittest` harness (target doc's separate "bigger bet"). Pinned
  indirectly by spine goldens until then.
- **Backend-only features** (`codingagent`, `runtimeconfig`, `webhook`, `gitrepo`,
  `artifacts`) have no `*_huma.go` → **no component tier is correct**, not a gap;
  their net is unit + dbtest (+ webhook's raw receiver test).

## Out of scope

- A maintained e2e/golden CI suite (integration tier) — owned by
  [`backend-testing.md`](./backend-testing.md); the harvest is one-time only.
- `models/`→`internal/domain` rename, `clients/`/`config/`/`database/`→`internal/`
  import-hygiene moves — do opportunistically when touching arch-lock work, per
  the target doc's "What moves" table; not gated on this effort.
