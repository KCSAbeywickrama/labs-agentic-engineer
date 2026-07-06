# asdlc-service Restructure: Feature-Based, Multi-Tenant-Correct, Testable Go Service

**Status:** Design — ready for developer handoff.
**Scope:** `asdlc-service` (`module github.com/wso2/asdlc/asdlc-service`), the multi-tenant control-plane / BFF for the ASDLC platform.
**Decisions already made (not re-litigated):** move from a horizontal layered layout to a feature-based (vertical-slice) layout; clients handled as ports & adapters; contracts and shared code made explicit; multi-tenancy enforced consistently.

This is an implementation handoff. It states the current defects, the target boundaries, the per-defect fix, and a build-green strangler sequence. Read §10 (Handoff Checklist) before writing code — it lists the traps that look simple and are not.

---

## 1. Executive Summary

`asdlc-service` is a horizontally-layered Go service — `api/` → `controllers/` (28 files) → `services/` (75 files, ~28k LOC) → a thin `repositories/` (only **3**: config, repo, task) + `models/` + `clients/` (~43k LOC). Three structural defects compound each other:

1. **Layering is leaky and inverted.** `services/webhook/projector.go` imports its *parent* `services` package to reach the task state machine — an upward dependency. Three services (`branch`, `pull_request`, `webhook`) downcast `IssueService` to the concrete `*issueService` purely to call an unexported `resolveRepoAndCredential`. The composition root `main.go` (1091 LOC) wires optional collaborators via interface type-assertions (`SetSkillService`, `SetTraitSync`, …), making the dependency graph implicit and untestable.

2. **Tenancy is parameterized but never authorized.** Every method takes an `orgID` string, but **zero** controllers call `jwt.ClaimsFromContext`/`ResolveOuHandle` (verified by grep). The path `{orgHandle}` is read straight from the URL and used to drive OpenChoreo namespace access and per-org secret storage with no comparison to the verified JWT org claim. Worse, the OC impersonation resolver (`main.go:304-324`) *actively* impersonates the path org using the BFF's privileged M2M token on mismatch — a textbook confused deputy. Net result: a catalogue of cross-org IDORs up to exfiltrating another org's Anthropic key and rotating its OAuth client secret.

3. **Data access is scattered, and the tenant column is inconsistently named.** Only 3 of **~15** tables (6 GORM-AutoMigrated + 9 raw-SQL `CREATE TABLE`) have a repository; **27** service files import `gorm.DB` directly and run raw `.Where`/`.Raw`/advisory locks (**16** use `.Raw`/`.Exec`). The tenant key is uniformly the **handle**, but it lives under two column names (`org_id` vs `oc_org_id`) and flows through misleadingly-named `ocOrgID` parameters — a trap that invites a developer to treat it as a UUID. `GitRepository.ProjectID` carries a **global** single-column unique index (`models/repository.go:29`); and `models/spec.go`, `design_version_skill_snapshots`, `webhook_payloads`, `coding_agent_logs` have no org column at all.

**The proposal, in five bullets:**

- **Vertical-slice features under `internal/feature/<name>/`**, each owning its HTTP handlers, service logic, repository (the only place `gorm` is allowed), and published `contract/` (DTOs + event hooks only — *not* fat service interfaces). Clients stay separate under `clients/`; the generated OpenChoreo SDK stays isolated. ~11 features.
- **Tenancy becomes a first-class, type-distinct concern in `platform/tenant`** (pure, gorm-free): an authorized `Caller` — carrying the verified `OrgHandle` (the universal tenant key) plus `ThunderUUID` (the `ouId`, used only for impersonation + the `wc-` namespace) — produced only from the verified JWT; a `Scope(caller, pathOrg)` gate applied by *one gate function at each org-scoped route*; and **`tenant.OrgHandle`-typed repository signatures** as the *primary* compile-time guarantee (the handle is the key on every tenant table — §6.5). A `platform/tenantdb` companion adds a runtime defense-in-depth net for the gorm *builder* API only.
- **Ports & adapters for all external systems**: consumer features define narrow port interfaces; `clients/` adapters *structurally satisfy* them (the compile-time `var _` assertion lives at the wiring boundary, so `clients/` never imports `internal/feature/*`). The three divergent token-provider shapes reconcile onto one small `token.Source` interface.
- **One error taxonomy (`platform/apperr`) + org-qualified advisory-lock helpers** replace per-controller HTTP mappers and projectID-only locks. A full unit-of-work runner is deferred until a concrete multi-write transaction needs it.
- **A strangler migration** that front-loads the tenancy gate (closing the systemic IDOR before any feature moves), then extracts feature slices leaves-first / highest-risk-early, fixing each load-bearing tenancy defect *inside* the PR that extracts its owner — build green at every step. Cross-cutting abstractions are sequenced behind the features that need them, not front-loaded.

---

## 2. Current State

### 2.1 Layout & layered flow

```
asdlc-service/
  cmd/asdlc-api/main.go   composition root / DI (1091 LOC): config, single *gorm.DB,
                          ~18-step migration runner (phases 0,2–8 + side migrations),
                          ~40-field AppParams (api/app.go), 5 watchers + 29 setter-DI sites
  api/                    route registration (~1 file/domain) + app.go mux assembly
  controllers/            HTTP handlers (28 files)
  services/               business logic (75 files, ~28k LOC) — the bulk
  repositories/           ONLY 3: config_repository, repo_repository, task_repository
  models/                 GORM models + git-backed DTOs (spec/design/tasks) mixed with OC facades
  clients/                external integrations (~43k LOC; ~33k is generated OC SDK)
  middleware/             jwt, jwtassertion, orgensure, org_scope, auth_token, correlation, logger
  internal/credentials/   AES-GCM secret store + resolver + app-token minter (well-encapsulated)
```

Request flow: `api/app.go::NewHandler` builds one outer mux (`http.NewServeMux`, `app.go:107`) + three sub-muxes by auth posture — `apiMux` (User/Service Thunder JWT + best-effort `orgensure`), `gsMux` (Service JWT, folded-in git-service), `taskMux` (Task JWT). Several routes (webhooks, JWKS, runner callbacks, `/orgs`, `/repos/{projectId}/board`, the unauthenticated `effective-key`) are hand-mounted directly on the outer mux. **Path wildcards bind only after the inner mux matches** — `RequireOrgScope` is therefore applied per-route via a `wrap()` helper (`api/repo_routes.go:38-44`, reading `r.PathValue` at `org_scope.go:59`), never as a single subtree mount.

### 2.2 The coupling reality (file evidence)

| Smell | Evidence |
|---|---|
| Inverted layering | `services/webhook/projector.go` imports parent `services` for `ApplyTaskEvent` |
| Hidden shared capability via downcast | `branch_service.go:56`, `pull_request_service.go:43`, `webhook_service.go:61` cast `IssueService`→`*issueService` for `resolveRepoAndCredential` |
| Scattered data access | **27** service files import `gorm.DB` (16 use raw `.Raw`/`.Exec`); `DeliveryStore` is a repository misfiled as a service. Raw `component_tasks` readers: the **4 watchers** + `loadBaselineBatch` (`task_diff.go:380`). The projector reads `component_tasks` via the gorm **builder**, not raw SQL — its only raw `.Exec` is the `pg_advisory_xact_lock`; `readSnapshotRows` reads `design_version_skill_snapshots`. |
| Implicit DI | `main.go:596-782` wires optional features via interface type-assertions (`SetSkillService`, `SetTraitSync`, `SetDispatchHook`, …) |
| `services/webhook/` is a catch-all | Holds the inbound pipeline **and** 4 pollers that aren't receivers (`build_watcher`, `coding_agent_watcher`, `on_hold_watcher`, `trait_sync_watcher`) |
| Divergent token providers | One concrete **struct** `clients/auth.AuthProvider` (`GetToken(ctx)`+`Invalidate()`) plus **two local interfaces** that duck-type the shared concrete `clients/oauth.TokenProvider`: `clients/openchoreo/transport.AuthProvider` (`Token()`+`Invalidate()`) and `clustergatewayproxy.AuthProvider` (`Token()` only). Three shapes for one job. |
| `httpx → middleware` cycle | `clients/httpx/correlation.go:23` imports `middleware` (a client depending on a horizontal layer) |

### 2.3 The tenancy reality (file evidence)

- **No claim-vs-path check anywhere.** `middleware/jwt/jwt.go` projects `OuHandle/OuName/OuId` into ctx, but `grep -rn "ClaimsFromContext\|ResolveOuHandle" controllers/` returns **zero hits**. `requireOrgHandle` (`controllers/validation.go:30`) only checks slug shape — its comment calling the slug "the cross-tenant fence" is false.
- **`orgensure` never enforces** — `orgensure.go:57-67` passes through on missing claims/handle/namespace and on DB error.
- **`RequireOrgScope`** (`org_scope.go`) is mounted only on `gsMux`/repo routes, applied per-route, and self-documents (`:53-55`) that it does *not* match path org against the JWT.
- **Impersonation confused-deputy** — `main.go:304-324`: on JWT/namespace mismatch the resolver falls through to a DB lookup keyed by the *path* namespace and returns the victim org's UUID for `X-Impersonate-Org`, sent under the BFF's M2M token.
- **Global project-name namespace** — `models/repository.go:29` puts a single-column `uniqueIndex` on `ProjectID`, collapsing all orgs into one project-name space.
- **Heterogeneous `apiMux`** — `app.go:123-161` mixes org-scoped routes with routes that have **no** `{orgHandle}` (org listing, `idp/discover`, `_test/reset`) and one that uses a **different var** (IDP `{orgId}`). No single blanket wrap can gate this set without 404ing the carve-outs.
- **Unauthenticated secret endpoint** — `api/app.go:247` mounts `GET /internal/.../anthropic/effective-key` on the outer mux with no auth, returning a decrypted Anthropic key by slug.
- **Unverified-JWT collab validation** — `controllers/collab_controller.go:105` (`ValidateCollabAccess`), routed at `api/collab_routes.go:32` on the **outer** mux, parses the Bearer with `jwt.ParseUnverified` (no signature check) and returns identity with no org/project authorization.

---

## 3. Multi-Tenancy Findings (the work list)

Severity: **H** = cross-tenant read/write or secret disclosure; **M** = collision/degraded isolation; **L** = defense-in-depth. The **per-finding fix and its phase live in the canonical "Finding → Fix → Phase" table in §6.7.**

| # | Finding | Location | Sev |
|---|---|---|---|
| IDOR-1 | Project CRUD trusts path `orgHandle`, never matched to JWT | `controllers/project_controller.go:68,89,114,152,182,203` | H |
| IDOR-2 | IDP RegenerateSecret returns victim org's rotated client_secret by path `orgId` | `controllers/idp_controller.go:114-134` | H |
| IDOR-3 | GitHub credential by path `orgHandle`: `:108` StartConnect, `:287` ConnectPAT, `:314` GetStatus, `:343` Disconnect | `controllers/org_github_controller.go:108,287,314,343` | H |
| IDOR-4 | Anthropic key connect/status/disconnect by path `orgHandle` | `controllers/org_anthropic_controller.go:60-119` | H |
| IDOR-5 | Requirements/Design/Component/Task/Config/Board/Skill/Chat all trust path org | all org-scoped `apiMux` controllers | H |
| IDOR-6 | `orgUUIDResolver` impersonates path org, defeating downstream authz | `main.go:304-324` → `transport.go:126-164` | H |
| IDOR-7 | `GetRepoStatus`/`GetProjectStatus` ignore `orgName`, resolve by `projectName` | `project_service.go:134-160`; `repo_repository.go:51-60` | M |
| F1 | `ArtifactStore` accepts `orgID` but discards it; repo resolved by `projectID` alone | `artifact_store.go:79-262`; `artifact_service.go:852-853` | H |
| F2 | `GitRepository.ProjectID` global `uniqueIndex`; idempotent create returns another org's row | `models/repository.go:29`; `repo_service.go:83` | H |
| F3 | Repo board routes unauthenticated, no `{orgId}`, confused-deputy with owning org's token | `api/repo_board_routes.go:29-30`; `app.go:253`; `repo_board_service.go:46-79` | H |
| F4 | Org-less resolution is the default: `GetByProjectID` (`:51`) and org-less `Delete` (`:114`) across branch/issue/git-ops/artifact — **~21 direct callers (~30 incl. `RepoService.GetRepo` wrappers)** vs **1** caller of `GetByOrgAndProjectID` | `repo_repository.go:51,114` | M |
| F5 | `getRepoLock(projectID)` lock key omits org (false-sharing once F2 lands) | `git_ops_service.go:123` | L |
| F6 | `taskRepo.GetByID`/`GetByIssueURL` load tenant rows on a non-org key | `task_repository.go:66-104` | H |
| F2t–F5t | GetTask / GetTaskStatus / Retry / ExecTask read/mutate any task by UUID, no org check | `task_controller.go:222,360,494,512` | H |
| F8 | `loadBaselineBatch` selects baseline by `project_id` only (raw SQL) | `task_diff.go:363-394` | M |
| F9 | `readSnapshotRows` reads skill snapshots by `project_id` only; table has no org column (raw SQL) | `task_skills_service.go:120-133`; table at `database/migrations/phase7_skills.go:94-104` | M |
| F10 | `RequirementsBundle` DTO has `ProjectID`, no org dimension | `models/spec.go:22-29` | L |
| F-WP | `webhook_payloads` has no org column | (table) | M |
| INT-1 | Unauthenticated `/anthropic/effective-key` returns any org's decrypted key by slug | `api/app.go:247`; `anthropic_credentials_routes.go:126-140` | H |
| INT-2 | Webhook discards HMAC-validated `ocOrgID` (`webhook_controller.go:163`); **two** unanchored re-resolvers, each `LIMIT 1`: `handlers.go:339-344` (`lookupProjectByRepo`, `repo_url ILIKE '%'+repoFullName` — no `/` anchor) and `credential_service.go:898-903` (`OrgIDByRepoFullName`, `repo_url LIKE '%/'+fullName`) | `webhook_controller.go:163`; `handlers.go:339-344`; `credential_service.go:885-911` | H |
| INT-3 | Service JWT shares issuer/audience with user tokens; `/internal/credentials/*` has no org enforcement (registered with no `orgScope` at `app.go:239`; Service-JWT mount at `app.go:264`) | `main.go:843-854`; `credentials_routes.go`; `app.go:239,264` | H |
| INT-4 | `_test/reset` global truncate (`Where 1=1`) gated only on `TestMode` (set on shared dev cloud) | `app.go:325-341`; `task_repository.go:167` | H |
| INT-5 | `_test/sm-api-resync` unauthenticated at the HTTP layer, **gated dev-only by two config flags** | `app.go:179-181,359-437` | M (dev-only) |
| INT-6 | Legacy `/credentials/refresh` trusts Task JWT `ocOrgId` without task↔org DB check | `credentials_refresh_service.go:58-73`; `task_token_manager.go:166-197` | M |
| INT-7 | cluster-gateway-proxy enforces no auth in k3d; namespace is a free parameter | `clustergatewayproxy/client.go:82-87,516-528` | M |
| INT-8 | Collab access-validation route trusts an UNVERIFIED JWT and performs no access check: forged/any token validates collab access to any org's room | `controllers/collab_controller.go:105` → `parseDisplayIdentity` → `jwt.ParseUnverified` (`:86`); route `api/collab_routes.go:32` (mounted on the OUTER mux) | H |
| TEN-A | `orgensure` weak seam (never enforces) | `orgensure.go:57-67` | — |
| TEN-B | `RequireOrgScope` weak seam (no JWT cross-check) | `org_scope.go:53-55` | — |

---

## 4. Target Boundaries — Feature Modules

Two non-negotiable rules drive the layout:

1. **Interfaces a consumer calls are defined by the consumer.** A feature declares a narrow `ports.go` naming only the methods it uses. A producer's published `contract/` package exports **DTOs + event-hook types only — never a fat service interface**. The pure task state machine and the cross-feature event hooks move to `internal/contracts` (importable by all, importing none), killing the projector→parent-services upward import.
2. **No feature imports another feature's concrete package.** Cross-feature side effects flow through hook interfaces *defined in `internal/contracts`*, so the package that owns the hook type is imported by neither caller nor callee's concrete package.

Dependency direction (strict; leaf-ish at top, drivers below):

```
                       internal/contracts          internal/platform/*
              (TaskLifecycle, event hooks,        (tenant[pure], tenantdb[gorm],
               shared value DTOs)                  auth, apperr, httpkit, httpx,
                            ▲   ▲   ▲               obs, ids, bootstrap)
        ┌───────────────────┘   │   └───────────────────────────┐
        │                       │                                │
   organization            credentials                         idp
        ▲                    ▲    ▲                              ▲
        │                    │    │                              │
    ┌───┴────────┬───────────┘    └───────────┐                  │
 gitrepo      artifacts                     skills               │
    ▲             ▲                            ▲                  │
    │             │                            │                  │
 requirements ◄── │                            │                  │
    ▲             │                            │                  │
 design ──────────┘ (reads artifacts; reads requirements corpus)  │
    ▲                                          │                  │
 component ───────────────────────────────────┘──────────────────┘
    ▲
 task  (owns the projector + lifecycle handlers; reads design via artifacts;
    │   never imports design — DesignChanged hook lives in contracts)
    ▲   ▲
    │   └──── codingagent  (owns Dispatcher + BuildWatcher + JobWatcher;
    │                       requests transitions via contracts.TaskTransitions)
    └──────── webhook      (ingestion; drives task via contracts.TaskTransitions)
 project (orchestrator; calls gitrepo/artifacts/task via consumer ports)
 runtimeconfig (deploy-time emit; calls idp/component via consumer ports)
```

### How the cross-feature cycles stay broken

The cross-feature edges between `task` and its neighbours are routed through hook interfaces whose *type* lives in `contracts` (owned by neither side) — so the package that defines a hook is never imported by both sides.

- **design → task.** Today `design_service.go:603` calls `task.ReconcilePendingForDesignChange` directly. After the move, design *emits* a `contracts.DesignChanged` event, and task *reads design strictly through `artifacts`/`contracts.DesignReader`* — so task never imports `internal/feature/design`. (`DesignReader` is precautionary: it keeps the edge from reappearing when task needs design corpus.)
- **webhook → task.** Webhook drives lifecycle transitions through `contracts.TaskTransitions`; task imports no webhook package and webhook imports no task package.
- **task ↔ codingagent — BOTH directions.** After the restructure two concrete edges exist, each routed through a distinct `contracts` hook. **This relationship is bidirectional; both directions must cross `contracts` or the cycle is not broken.**
  1. **Build trigger (task → codingagent).** Today the merged-PR handler calls `services.WorkflowRunService.DispatchTaskBuild` (in the flat `services` package, `workflowrun_service.go:151`, invoked at `services/webhook/handlers.go:275`); it fires an **OpenChoreo *build* WorkflowRun** via `TriggerBuildAtCommit`. **codingagent has no `DispatchTaskBuild` today.** This restructure (a) **moves `WorkflowRunService` into codingagent** (`codingagent` phase) — which is what creates the `task→codingagent` edge — and (b) routes the merge-time call through a **new** `contracts.BuildDispatcher` hook (a.k.a. `OnTaskMerged`): task EMITS, codingagent PROVIDES, wired at the composition root.
  2. **Status write-back (codingagent → task).** `WorkflowRunService.dispatchBuild` writes task status via `projector.MarkBuilding` (`workflowrun_service.go:231`). The **projector is owned by `task`** (§4.9). Routed through **`contracts.TaskTransitions`**: `MarkBuilding`/`MarkBuilt`/`MarkFailed` become `contracts.TaskTransitions` methods that task's projector satisfies and codingagent calls. **Every codingagent component that writes `component_tasks.Status` (`WorkflowRunService`, `BuildWatcher`, `JobWatcher.markFailed`) goes through `contracts.TaskTransitions`; none imports `internal/feature/task`.**

  `contracts.BuildDispatcher` (merge-time build trigger) is a **new** hook — **not** the same as `projector.SetDispatchHook`, which wires the *post-deploy* `OnTaskDeployed` cascade (sibling-unblock, fires at `projector.go:258-263`; built at `main.go:791-794`). Different hook, different trigger (merge vs deploy). `SetDispatchHook` is the precedent only for the *wiring style*, not for `BuildDispatcher`'s identity.

---

### 4.0 Platform & shared packages

#### `internal/contracts`
- **Admission rule:** interfaces + value DTOs shared by ≥2 features, plus **pure, dependency-free, side-effect-free algebra** (the task state machine). The enforceable guarantee is the **import allowlist** (depguard: stdlib + `models` value types only — §6.3), **not** a "no function bodies" rule (which would reject `ApplyTaskEvent`). Leaf-ness is enforced, not behavior-freeness.
- **Owns:** `ApplyTaskEvent`/`TaskEvent`/`EventCause`/`allowedTransitions` (from `services/task_state.go` — pure, imports only `errors`+`models`; the hoist requires relocating `TaskStatus`/`TaskEvent` into a gorm-free package — see §6.3, blast radius ~14+ files); the cross-feature **event-hook interfaces** `TaskTransitions`, `BuildDispatcher` (a.k.a. `OnTaskMerged`), `DesignChanged`, `TraitSync`, `OnTaskDeployed`, `DesignReader`; the `ProgressEvent` *DTO*; shared value DTOs (`ArtifactVersion`, agents request DTOs mirroring the TS schemas).
- **Explicitly NOT here:** `ParseProgressLine` (behavior + observer-specific → stays in its owning adapter); OC sentinel errors + label/annotation catalog (vendor-specific → OC adapter package); `RepoCoordinatesResolver` (a consumer port → defined in `task`/`artifacts`).
- **Allowed deps:** stdlib, `models` value types. **Forbidden:** any feature, `platform/*`, `gorm`, any client. *(Enforced by lint, §6.3.)*

#### `internal/platform/tenant` (pure, gorm-free)
- **Owns:** `OrgHandle`/`ProjectID` types; `Caller` (authorized, JWT-only — `OrgHandle` is the universal tenant key; `ThunderUUID`/`ouId` is carried only for impersonation + `wc-` namespace derivation) + `Source` provenance; `FromContext`/`With`; `Scope(caller, pathOrg)`; `MustOrg`; `ResolveOuHandle` (from `jwt.go:49`); org-qualified lock-key helpers (`OrgLockKey`/`ProjectLockKey`/`TaskLockKey`); the `Bind*` HTTP middleware; the cross-org sweep capability `SweepAllOrgs` (§6.4). It is also the **new home for the namespace/vault-path derivation helpers**:
  - The `wc-<first8>-<sha256[:8]>` family (`OrgBaseNamespace`/`RemoteWorkerNamespace`) is **already centralized in one helper** (`codingagent/namespace.go`), already *called* by `sm_api_writer.go:186`. The move buys **location** — relocating into gorm-free `platform/tenant` so HTTP/middleware can read it keyed off `Caller.ThunderUUID`. The *only* genuine parallel implementation is the **external** cloud SM-API + the local stub; those cannot share an import and are reconciled by a **byte-parity contract test** (§8).
  - The `workflows-<ocOrgID>` family (`WorkflowPlaneNamespace`, `models/wp_naming.go`) is a **distinct namespace on a different plane** (ADR-0001) with a DNS-bounded derivation and **no external counterpart**. It also relocates here but is a **separate function that must not be merged** with the `wc-` family.
- **Allowed deps:** `platform/auth`, `contracts`, **`Resolver`/`RepoResolver` interfaces only** (consumer-defined here, satisfied by `organization`/`gitrepo` and injected at the composition root), stdlib. **Forbidden:** business features, `package repositories`, **direct `gorm`**.
- **Why:** every IDOR finding bottoms out on org-from-path vs org-from-JWT. Keeping this gorm-free lets HTTP/middleware read a `Caller` without dragging `gorm` in.

#### `internal/platform/tenantdb` (gorm boundary)
- **Owns:** `TenantTable` marker interface (`TenantColumn() string`); `TenantDB`/`Open`/`Scoped` (§6.6); `RegisterGuard` (the builder-API guard callback).
- **Allowed deps:** `gorm`, `platform/tenant` (for `OrgHandle`). **Imported by:** feature repositories only.

#### `internal/platform/auth`
- **Owns:** `jwtassertion` verify engine + `JWKSCache`; `jwt.Middleware` claim projection; `ExtractAuthToken` + service-identity markers; `RequireTaskBearer`; `TaskTokenManager` (mint/verify) + JWKS publication; `PublisherTokenVerifier`; `BearerService` (connect-state HS256).
- **Why:** all five token postures funnel through one verification engine; co-locating mint+verify+JWKS prevents audience-confusion and dev-fail-open footguns.

#### `internal/platform/{httpkit, httpx, obs, ids, apperr, bootstrap}`
- `apperr`: the `Code` enum + `Error` carrier + `E`/`Coded`; **no** domain sentinels (those live in each feature, constructed via `apperr.E`).
- `httpkit`: `WriteJSON`/`WriteAppError` (replaces every per-controller mapper) + the single SSE writer (dedups 4 copies) + the `Write40x` helpers used by the gate.
- `httpx`: outbound transport decorators; hosts the **one reconciled token interface** (§6.8).
- `obs`: correlation-ID + slog context — **leaf; stdlib + `context` only, zero internal imports** (breaks the `httpx→middleware` cycle by hosting the header/key/getter here; `middleware`/`auth` import `obs`, never the reverse).
- `ids`: slug/UUID validation (rename of `utils/validate`).
- `bootstrap`: `database.Open` + the ~18-step migration runner (phases 0,2–8 + side migrations) + skill bootstrap. Runs `RunBootstrapGrants` (owner self-grant keyed on the live connection's `CURRENT_USER`) **before** AutoMigrate as a permanent env-agnostic step — a no-op locally, self-healing the managed-RDS `REVOKE` in cloud. The "safe no-op in the permissive env, self-heal in the restrictive one" idiom (§6.11), not an `if cloud` branch.

The generated OC SDK (`clients/openchoreo/gen`) is **not** under `platform/` — it lives under `clients/` and is imported only by the OC adapter (§6.8).

---

### 4.1 `internal/organization`
- **Purpose:** the tenant root — local `Organization` UUID side-car, ouHandle→UUID resolution, JIT-ensure, org listing.
- **Owns:** `organizations` table + model + DTOs; `OrganizationService` (List, EnsureForOuHandle); `OrganizationController` + routes; `openchoreo.NamespaceClient` (sole consumer).
- **Contract:** published DTOs; satisfies the consumer-defined `tenant.Resolver` (`{ EnsureForOuHandle, ResolveUUID, List }`).
- **Tenant state:** `organizations` (PK uuid, name=handle, thunder_org_uuid).
- **Why:** the only normalization of org identity to a UUID and the only NamespaceClient consumer. Everyone depends on it for identity *via `platform/tenant`*, so it can move last without churn.

### 4.2 `internal/credentials`
- **Purpose:** per-org secret/credential trust root.
- **Owns:** `org_credentials`, `org_anthropic_credentials`, `org_secrets` tables + repositories; `CredentialService`, `AnthropicCredentialService`, `BuildCredentialsService`, `OrgDisconnectService` (credential side), `commitIdentity`, `ValidatorProbes`; `internal/credentials/*` (AES store/resolver/minter); `SMAPIWriter` + `secretmanagersvc` + sm-api provider + OC `SecretReferenceClient` + `GitSecretClient` + `clients/k8s`; the GitHub/Anthropic controllers + `/internal/credentials/*` + `/anthropic/*` surfaces.
- **Contract:** published `CredentialResolver`/`WebhookSecrets`/`EffectiveAnthropicKey` DTOs; consumers define their own narrow ports.
- **Tenant state:** keyed by `OcOrgID` PK (rename → `org_id`; holds the handle). Owns the fixes for INT-1, INT-2 (routing leg), INT-3.
- **Two-path (§6.10/6.11):** the `smapi` adapter owns the in-repo `local-secret-manager-api` stub behind one HTTP contract (ADR-0002); `BuildCredentialsService` models build-credential provisioning as one provider whose failure **degrades gracefully** (empty `secretRef` → unauthenticated clone for public repos), with repo visibility in deploy config (`GITHUB_REPO_VISIBILITY`) — the degrade branch becomes dead code once both planes route OC `CreateGitSecret` (ADR-0006).

### 4.3 `internal/idp`
- **Purpose:** per-org IDP profile + Thunder publisher OAuth-app lifecycle + BYO-IDP discovery + audit.
- **Owns:** `organization_idp_profiles` + `idp_audit_events` tables + repository; `IDPService`; `IDPController` + routes; `clients/oidc` (→ `adapters/oidc`); `clients/thundersvc` (→ `adapters/thundersvc`, shared with `runtimeconfig` via published DTOs).
- **Tenant state:** profile keyed by `OrgID`; publisher app bound to org Thunder OU. Owns the fix for IDOR-2 via `{orgId}`→`{orgHandle}` normalization + the central gate + slug validation.
- **Contract:** publishes a single idempotent **`EnsureOrgPublisher`** port — one owner of "the per-org publisher exists," not three call sites. Consumed by *both* `codingagent` dispatch and `component` trait-sync. Does: get-or-create + SM-API mirror + registration **under the org's own Thunder OU**; the publisher self-heal + 5xx-on-delete tolerance; token URL derived from the org JWKS URL.
- **Why:** distinct secret-at-rest posture (Postgres column vs OpenBao) and Thunder-OU tenancy make it a sibling of credentials, not a sub-slice.

### 4.4 `internal/gitrepo`
- **Purpose:** the absorbed git-service core — repo lifecycle, on-disk git ops, branch/issue/PR creation, outbound webhook registration, project init, GitHub board.
- **Owns:** `git_repositories` table (composite `(org_id, project_id)` unique index — **F2**) + `RepoRepository`; `RepoService`, `GitOpsService`, `BranchService`, `PullRequestService`, `IssueService` (+ board), `WebhookService` (registration), `RepoBoardService`, `GitHubV2Client`; the GitHub REST/git-data adapters (→ `adapters/github`); the 8 git-service controllers + repo/org/board routes; `issue_body` formatter.
- **Contract:** publishes the `RepoCoordinates` DTO; satisfies the consumer-defined `RepoCoordinatesResolver` port (the promoted ex-`resolveRepoAndCredential` — **kills the downcast**) and `tenant.RepoResolver`. Also owns the **pre-verification routing resolver** that webhook calls before HMAC dispatch: `RepoRepository` does an **exact host/owner/repo match** replacing the INT-2 routing-resolver site `credential_service.go:898-903` (`OrgIDByRepoFullName`) — see §6.6g.
- **Tenant state:** `git_repositories` (OrgID+ProjectID, composite unique). Clones at `repoBasePath/<orgID>/<projectID>`. Owns the fixes for F1/F3/F4/F7 by routing all resolution through `GetByOrgAndProjectID` and removing org-less methods.
- **Two-path:** the absorbed git-service is consumed **only via in-process feature ports**, never a loopback HTTP client — the deleted `GIT_SERVICE_BASE_URL`/`AGENT_GIT_SERVICE_URL` loopback worked locally by accident but 503'd in cloud once the standalone Service scaled to 0. The composite `(org_id, project_id)` unique index (F2) lets the webhook resolve the **globally-unique** repo row instead of a per-org slug.

### 4.5 `internal/artifacts`
- **Purpose:** git-backed artifact persistence engine (requirements/design file store + tag versioning) — a real repository mislabeled "services". Shared by requirements + design.
- **Owns:** `ArtifactStore` (typed facade + `DesignFile` YAML codec), `ArtifactService` (file I/O, path validation, save/discard, snapshots, per-project mutex), `save_via_api`; `artifact_versioning` + mappers + `openapi_normalize`; `conflict_retry` (relocated here); `ArtifactController` + the artifact block of repo routes; the git-backed DTOs from `spec.go`/`design.go`/`tasks.go`.
- **Contract:** publishes the artifact/versioning DTOs (org-scoped); consumers define narrow ports.
- **Tenant state:** none of its own (files in the per-project clone). **The single point to fix F1** — thread `orgID` end-to-end, resolve via `gitrepo.GetByOrgAndProjectID`. F10 is subsumed: the bundle is only ever read from the correctly-scoped clone (no DTO field added).

### 4.6 `internal/requirements`
- **Owns:** `RequirementsService`, `RequirementsChatService`, `RequirementsDirLocker` (org-aware pg advisory lock keyed `ProjectLockKey(org, projectID)`); requirements/chat/collab controllers + routes.
- **Allowed:** `platform/*`, `contracts`, `artifacts`, narrow `agents.Client` port. **Forbidden:** `design`, `task`.
- **Tenant state:** none of its own. Fixes the collab unverified-JWT hole (**INT-8**) during the move: (a) signature-verify the Bearer (not `ParseUnverified`); (b) add a **project-scoped access check** via the §6.6g oracle — `collab` depends on `gitrepo.RepoRepository.GetByOrgAndProjectID(caller.Org, projectID)` (the verified caller's org must own the room's project).
- **Why:** requirements + chat + collab share `ArtifactStore`, the dir lock, and `agents.Client` — one bounded context.

### 4.7 `internal/design`
- **Owns:** `DesignService` + tag decode + `toK8sName` + `ocEntrypoint`; `ExternalAPICatalog` (injected, not process-global); `AssembleDesignFromFiles` (moved from requirements); `api_security` predicates (moved out of the credentials grouping where misfiled); `DesignController` + routes.
- **Contract:** publishes design DTOs; **emits `contracts.DesignChanged`** for trait-sync/reconcile side effects — does **not** import `task`/`component`.
- **Allowed:** `platform/*`, `contracts`, `artifacts`, `requirements` (corpus), `skills` (catalogue), narrow `agents.Client` port. **Forbidden:** `task`/`component` concrete.
- **Why:** highest fan-out; decoupling requires the trait-sync + task-reconcile side effects to become `contracts`-hosted events, which is also what makes the design↔task cycle stay broken.

### 4.8 `internal/component`
- **Owns:** `ComponentService` (CRUD/OpenAPI/env mirror), `ConfigService` + `ComponentConfig` + `ConfigRepository` (cleanest-tenanted unit); `TraitSyncService` + `TraitSyncWatcher` (evacuated from `services/webhook/`); component/config controllers + routes; `openchoreo.ComponentClient` (primary owner).
- **Contract:** publishes component DTOs; satisfies `contracts.TraitSync`.
- **Tenant state:** `component_configs` (composite unique OrgID+ProjectName+ComponentName — already correct).
- **Why:** `ConfigService` is already a clean repo-backed slice; `TraitSyncService`/`TraitSyncWatcher` share `{org,project,component}` addressing. `TraitSyncService` **consumes idp's `EnsureOrgPublisher` port** (§4.3) — it must not re-implement per-org publisher provisioning.

### 4.9 `internal/task`
- **Purpose:** task CRUD/read + tech-lead generation + **the lifecycle projector** (sole `Status` writer) + the webhook-driven transition handlers.
- **Owns:** `component_tasks` + `coding_agent_logs` tables + `TaskRepository` (and forces the projector through it); `TaskService`, `task_stream`, `task_diff`, `task_design`; `Projector` + advisory locks (from `services/webhook/`); PR/push/issue_comment transition `Handler` (from `services/webhook/handlers.go`); `TaskController`, `BoardController` (task half), `CredentialsRefreshController` + routes.
- **Contracts:**
  - **satisfies** `contracts.TaskTransitions` (used by webhook/codingagent for lifecycle transitions; `MarkBuilding`/`MarkBuilt`/`MarkFailed` are methods here, so codingagent writes `Status` through the contract, never a concrete task import);
  - **emits** `contracts.BuildDispatcher` (a.k.a. `OnTaskMerged`) — the merged-PR handler triggers the build through this hook (a **new** hook, not a mirror of `SetDispatchHook`). Task imports no codingagent package;
  - publishes a `TaskReader` DTO surface (used by board/project, which define their own ports);
  - reads design via `artifacts`/`contracts.DesignReader` — **never imports `design`.**
  - **owns the HTTP `TaskController` in-feature** (landed; `ports.go`): its coding-agent dispatch + `/progress/*` surfaces call **task-local consumer ports** `TaskDispatcher` (`DispatchTasks`/`MarkVerificationFailed`/`RetryTask`) and `ProgressReader` (`GetAgentProgress`/`GetBuildProgress`), satisfied by codingagent's `DispatchService`/`ProgressService`. Their DTOs (`DispatchResult`, `ProgressResponse`, `ProgressEvent`) and the `ErrProgressUnavailable` sentinel live in `contracts`, so the controller drives codingagent **without importing it** — the cycle stays cut. The `var _` satisfaction lives at the composition root.
- **Tenant state:** `component_tasks` (OrgID+ProjectID — close GetByID/GetByIssueURL gaps), `coding_agent_logs` (FK). Owns the fixes for F6, F2t–F5t, F8.
- **Why:** the projector *is* the lifecycle engine and currently lives under webhook/ importing its parent — re-homing it with the state machine in `contracts` fixes the upward import and routes `JobWatcher.markFailed`'s raw-UPDATE bypass through `contracts.TaskTransitions`.

### 4.10 `internal/codingagent`
- **Merged scope** (build folded in). Build and coding-agent dispatch are **not** the same OC client — per ADR-0001 they target **different planes** (coding-agent = data-plane Job via cluster-gateway-proxy; build = workflow-plane `WorkflowRun` via `TriggerBuildAtCommit`). They are merged because both are **dispatch-side, write task `Status` through `contracts.TaskTransitions`, and share the dispatch/`WorkflowRunService` ownership + the per-task token machinery** — *not* because they share a transport.
- **Owns:** `DispatchService` + `DispatchCascadeHook`; `services/codingagent/*` (Dispatcher, JobWatcher, namespace, job/ES templates); `ProgressService` + `clustergatewayproxy` (→ `adapters/clustergatewayproxy`) + `observer` (incl. `ParseProgressLine`); `OnHoldWatcher` (evacuated); `WorkflowRunService.DispatchTaskBuild/RetryAuthFailedBuild`; `BuildWatcher` (evacuated); `clients/observability` (→ `adapters/observability`).
- **Contracts:** publishes `ProgressReader`/`BuildResult` DTOs (`ProgressEvent` itself lives in `contracts`). **Provides** `contracts.BuildDispatcher`. **Consumes** `contracts.TaskTransitions` for *every* `component_tasks` status write (`WorkflowRunService.dispatchBuild`'s `MarkBuilding`, `BuildWatcher`, `JobWatcher.markFailed`). Imports no `internal/feature/task` package.
- **Tenant state:** per-org isolation via `RemoteWorkerNamespace(scope.ThunderUUID)`. Owns the fix for INT-7 (namespace derived from `scope`, never caller-supplied).
- **Two-path (§6.10).** Three points: the `clustergatewayproxy` adapter owns the `local-cluster-gateway-proxy` stub; dispatch calls `idp.EnsureOrgPublisher` for every component before reading the publisher secret; the cloud-vs-local runner-auth fork is a typed `RunnerAuthMode` from `DeploymentEnv` (§6.10a), **replacing `isGatewayPlatformURL`'s `https://`-sniff**. The legacy `tryDispatchViaProxy`-vs-ClusterWorkflow fallback (routed today by a fragile `last_coding_agent_run_name LIKE 'ca-%'` filter) retires once both planes use the Job path.

### 4.11 `internal/webhook`
- **Purpose:** pure inbound GitHub event ingestion.
- **Owns:** `WebhookController`, `Router`, `RoutingKey/ResolveOcOrgID/RoutingCache`, `Verifier`, `SecretProvider`, `RefetchLimiter`; `DeliveryStore` (promoted to a real repository) + models; `RegisterInstallationHandlers`; webhook routes.
- **Contract:** none external — pure ingestion edge; depends inward on a narrow `credentials` secrets port + `contracts.TaskTransitions`.
- **Tenant state:** `webhook_deliveries` (OcOrgID → `org_id`), `webhook_payloads` (gains `org_id`, backfilled from the delivery's `OcOrgID` — F-WP). Owns the fix for **INT-2** — `Router.Dispatch(ctx, Caller{Source:SourceWebhookHMAC, Org:validatedOrg}, event, body)`; handlers **resolve the repo scoped-by-`validatedOrg` with an exact host/owner/repo match** (the unanchored `ILIKE … LIMIT 1` is deleted); 4xx-drop when absent. `lookupProjectByRepo` returns `(orgID, projectID)` from the globally-unique `git_repositories` row.
- **Why:** ingestion has a distinct resolve-then-verify model and only two stable inward dependencies. The four background pollers evacuate to their owners.

### 4.12 `internal/skills`, `internal/runtimeconfig`, `internal/project`
- **`skills`**: `skills`/`skill_audit_events`/`design_version_skill_snapshots` + first-class models + a `SkillRepository` (closes the largest raw-gorm gap, 6 files); `SkillService/Bootstrap/Import/Mutation`; `SkillController` + routes; `skills/embed.FS`. Publishes skill DTOs; satisfies a `SnapshotStore` port. Owns the fix for **F9**: add `org_id` to `design_version_skill_snapshots`. *Because snapshots are derived, the migration drops the column-less rows and rematerializes* (no unbackfillable join when two orgs already collide on a project slug); add `org_id NOT NULL` + composite `(org_id, project_id, design_version, skill_id)` unique afterward.
- **`runtimeconfig`**: `RuntimeConfigService` (env-config.js emission) + `NormalizeExternalURL` (single consumer, lives here). Publishes a `RuntimeConfig` DTO. **Fixes the per-project Thunder OAuth-client cross-tenant collision** — key the client by `(org, project)`, not project name alone.
- **`project`**: `ProjectService` (CRUD + status aggregation) + DTOs; `ProjectController` + routes; `openchoreo.ProjectClient`. The cross-feature orchestrator — calls `gitrepo`/`artifacts`/`task` through narrow consumer ports. Owns the fix for **IDOR-7** (scope status reads by `(org,project)`).

---

## 5. Proposed Package Layout

```
asdlc-service/
  cmd/asdlc-api/main.go            # composition root ONLY: assemble features, var _ port assertions, watchers
  internal/
    contracts/                     # dep-free: TaskLifecycle, event hooks, shared value DTOs
    platform/                      # shared kernel — never imports internal/feature/* or clients/*
      tenant/                      #   PURE: OrgHandle/Caller/Scope/Bind* mw/lock keys/SweepAllOrgs (no gorm)
      tenantdb/                    #   gorm boundary: TenantDB + builder-API guard
      auth/                        #   jwtassertion engine, claim projection, TaskTokenManager, verifiers
      apperr/                      #   Code enum + Error carrier + E/Coded
      httpkit/                     #   WriteJSON/WriteAppError (preserves {error,code}) + SSE + Write40x
      httpx/                       #   outbound transport decorators + token.Source/Invalidator
      obs/                         #   correlation-ID + slog (LEAF: stdlib+context only)
      ids/                         #   slug/UUID validation (ex utils/validate)
      bootstrap/                   #   DB open + ~18-step migration runner (phases 0,2–8 + side) + skill bootstrap
  clients/                         # external adapters — import contracts + gen + stdlib, NEVER internal/feature/*
    openchoreo/gen/                #   GENERATED OC SDK — imported only by occlient
    openchoreo/occlient/           #   transport (impersonation) + sub-client adapters + OC errors/oc_names catalog
    agents/                        #   agents-service adapter (satisfies per-feature agent ports)
  internal/feature/
      organization/  ports.go store.go http.go contract/  # tenant root + NamespaceClient
      credentials/   ...  contract/  internal/credentials/  adapters/{k8s,smapi,ocgitsecret,ocsecretref}/
      idp/           ...  contract/  adapters/{oidc,thundersvc}/            # IDOR-2
      gitrepo/       ...  contract/  adapters/github/                       # F1/F2/F3/F4
      artifacts/     ...  contract/                                         # F1 — orgID threaded
      requirements/  ...  contract/                                         # + chat + collab; org dir lock; INT-8
      design/        ...  contract/                                         # emits contracts.DesignChanged
      component/     ...  contract/                                         # ConfigService + TraitSync(+Watcher)
      task/          ...  contract/                                         # projector + handlers; F6/F2t-F5t/F8
      codingagent/   ...  contract/  adapters/{clustergatewayproxy,observability}/  # +build +watchers; INT-7
      webhook/       ...  store.go                                          # ingestion only; INT-2, F-WP
      skills/        ...  contract/                                         # SkillRepository; F9
      runtimeconfig/ ...  contract/                                         # env-config.js; per-(org,project) OAuth
      project/       ...  contract/                                         # orchestrator; IDOR-7
      shared/tenancytest/                                                   # AssertCrossOrgDenied + two-org kit
  database/migrations/             # ~18-step runner behind one Run() (phases 0,2–8 + side; unchanged ordering)
  skills/                          # embedded built-in SKILL.md (embed.FS, owned by feature/skills)
```

~11 features + 9 platform packages + `contracts` + the `clients/` subtree. `clients/` retains the **multi-consumer** adapters (`openchoreo/gen`+`occlient`, `agents`, `thundersvc`, `observability`, `oauth`/`token.Source`); only single-consumer clients move into feature `adapters/` (§6.8).

---

## 6. Cross-Cutting Design

### 6.1 Tenancy enforcement: context + per-route gate + scoped-repo signatures

#### 6.1a Typed tenant context

Replace the loose `*jwt.Claims` + best-effort `orgensure` with a typed `Caller` produced *only* by the auth middleware, plus a provenance `Source` so S2S/webhook/runner paths can assert how the org was established.

```go
package tenant // pure: no gorm

type OrgHandle string
type ProjectID string
type Source uint8
const ( SourceUserJWT Source = iota; SourceServiceJWT; SourceTaskJWT
        SourcePublisherCC; SourceWebhookHMAC; SourceServiceIdentity )

type Caller struct {
    Org         OrgHandle
    ThunderUUID string // ouId; impersonation + WP namespace derivation
    Subject     string
    Source      Source
}
func FromContext(ctx context.Context) (Caller, bool)

// Scope is the seam that closes the systemic IDOR. Same 404 body for
// wrong-org and no-such-org (no existence leak).
func Scope(c Caller, pathOrg string) (OrgHandle, error) // apperr.PermissionDenied on mismatch
func MustOrg(ctx context.Context) (OrgHandle, error)     // (nil scope => deny, never global)
```

#### 6.1b A single gate FUNCTION, applied PER ROUTE

Go's `net/http` `ServeMux` binds path wildcards only *after* the inner mux matches, so a middleware wrapped around the mux sees an empty `r.PathValue("orgHandle")` (the reason `RequireOrgScope` is already per-route). Centralize the gate *logic* in one function and apply it at each org-scoped route registration via `registerOrgScoped(mux, pattern, h)` — N wraps, one implementation. It folds `orgensure`'s JIT-provisioning into the gate (the get-or-create runs **only after** the path==claim check has guaranteed the caller is acting on its **own** org, so JIT onboarding of a brand-new org's first request is preserved):

```go
func BindUserOrg(pathVar string, res Resolver) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            claims := jwt.ClaimsFromContext(r.Context())
            tokenOrg := jwt.ResolveOuHandle(claims)
            if tokenOrg == "" { httpkit.Write401(w); return }            // was: pass-through
            pathOrg := r.PathValue(pathVar)
            if err := ids.Slug(pathOrg); err != nil { httpkit.Write400(w, err); return }
            if !strings.EqualFold(tokenOrg, pathOrg) {                   // THE missing check
                httpkit.Write404(w, "organization not found"); return    // closes IDOR-1..5
            }
            // path==claim is now guaranteed: the caller acts on its OWN org, so
            // EnsureForOuHandle (get-or-create) is the JIT-onboarding step, NOT a
            // cross-org provisioning risk. It never 403s the first legit request.
            uuid, err := res.EnsureForOuHandle(r.Context(), tenant.OrgHandle(pathOrg), claims.OuId)
            if err != nil { httpkit.Write500(w); return }
            scope := Caller{Org: OrgHandle(pathOrg), ThunderUUID: claims.OuId,
                            Subject: claims.Subject, Source: SourceUserJWT}
            next.ServeHTTP(w, r.WithContext(With(r.Context(), scope)))
        })
    }
}
```

The `Resolver` the gate needs in the **`gate` phase** is satisfied by a thin composition-root adapter over the existing `organizationService` (or a direct `organizations` read) — `organization`-as-a-feature only moves last; it does **not** gate the resolver's availability. (A pure claim-vs-path `strings.EqualFold` would close IDOR-1..5 with *no* resolver at all; the resolver is needed only for the JIT-ensure + `Caller.ThunderUUID`, so the gate phase can ship the string check first and wire the ensure-adapter alongside.)

**The gate is an allowlist-by-construction invariant, keyed on route PREFIXES — not a denylist on a single path-var literal.** The live IDORs do **not** all use `{orgHandle}`: IDP uses `{orgId}` (IDOR-2), credentials use `{ocOrgId}` (INT-1/IDOR-4), the board route uses `{projectId}` with no org segment at all (F3). A check keyed on the literal `{orgHandle}` would silently pass a future route that reintroduces those exact var names. The enforced invariant is: **every route under `/api/v1/organizations/…`, `/internal/credentials/…`, or `/repos/…` MUST be registered through a gating `Router` method** (`registerOrgScoped`→`BindUserOrg`, `registerService`→`BindServiceOrg`, or `registerTaskBearer`→`BindRunnerScope`); the *only* escape is `registerPublic` against the enumerated carve-out list. **Precondition:** `{orgId}` (IDP) and `{ocOrgId}` (credentials) are renamed to `{orgHandle}`, and the board route gains an `{orgHandle}` segment (F3), so every gated route names the org uniformly. The CI check is "no raw `mux.Handle`/`HandleFunc` of **any** pattern under those three prefixes (and no `{orgHandle}`-bearing pattern anywhere) outside the typed `Router`'s gating methods + the `registerPublic` allowlist" — across **both** muxes.

The heterogeneous `apiMux` is **not** wrapped wholesale. The carve-outs that bind a `Caller` *without* a path-org match are enumerated and handled explicitly through `registerPublic`:
- `GET /api/v1/organizations` (listing — scoped to the JWT's own org, no path var);
- `GET /api/v1/idp/discover` (no org);
- `POST /api/v1/_test/reset` (dev-only, INT-4);
- `GET /api/v1/collab/validate` (the outer-mux collab route — INT-8; it MUST still be brought under signature-verify + a project-scoped access check, so a signature-only fix cannot ship by leaving it off the gated path).

Non-user surfaces each bind from something the caller *proved* control of:
- **`BindServiceOrg`** (`/internal/credentials/*`, `/repos/{orgHandle}/{projectId}/*`): the Service JWT is a single platform-wide identity with **no org claim**, so this binding provides **scoping/observability, NOT authorization** — any valid Service JWT could name any path org. It resolves `(orgHandle, projectId)` via `GetByOrgAndProjectID` (404 on miss) and tags `Caller{Source: SourceServiceJWT}`. A distinct `aud` stops *user* tokens replaying here (INT-3). **No secret-returning route may use `BindServiceOrg` as its only gate** — those move to the Task-JWT path or to Secret projection.
- **`BindRunnerScope`** (`/tasks/{taskId}/*`): verify Task JWT → assert `claims.TaskID == path taskId` → load task → `Caller{Org: task.OrgID, Source: SourceTaskJWT}` (org from the *row*, not the claim). This closes INT-6. The legacy `/credentials/refresh` is then **retired in favor of SSA Secret projection into `workflows-<org>`**, so the runner no longer makes an HTTP credential call at all.
- **Webhook**: resolve `ocOrgID` from the routing key, HMAC-verify, then thread it through `Router.Dispatch` as `Caller{Source: SourceWebhookHMAC}`; handlers **resolve the repo scoped-by-org with an exact match** so a cross-org claim cannot resolve a row at all.

**Impersonation fix (IDOR-6):** the OC adapter reads `scope.ThunderUUID` straight off the `Caller`; the DB path-namespace fallback is gated to `Source == SourceServiceIdentity` only. A user-JWT mismatch never reaches the OC client because `BindUserOrg` rejects it first. The `WithServiceIdentity` carve-out is wired *before* fail-closing (§7.5). The DirectOC-vs-ImpersonatingOC adapter is chosen **once at the composition root** (§6.10a) — not via a per-request heuristic; call mode reads `Caller.Source`.

#### 6.1c Scoped-repository signatures (primary) + builder guard (defense-in-depth)

The **primary** guarantee is that tenant-table repository methods take `tenant.OrgHandle` as an argument, making "forgot the org filter" a compile error:

```go
type RepoRepository interface {
    GetByOrgAndProjectID(ctx, org tenant.OrgHandle, p string) (*GitRepository, error)
    DeleteByOrgAndProjectID(ctx, org tenant.OrgHandle, p string) error
    // REMOVED: GetByProjectID, Delete(projectID)
}
type TaskRepository interface {
    GetByIDScoped(ctx, org tenant.OrgHandle, id string) (*ComponentTask, error)
    // bare GetByID/GetByIssueURL move to InternalTaskRepository (service-identity only)
}
```

A runtime net (`platform/tenantdb`) backs this up — but **only for the gorm builder API**:

```go
package tenantdb
type TenantTable interface { TenantColumn() string } // "org_id" (legacy "oc_org_id" until renamed; both hold the handle)
type TenantDB struct { db *gorm.DB; org tenant.OrgHandle }
func Open(ctx context.Context, db *gorm.DB) (*TenantDB, error) { /* fail closed if no scope */ }
func (t *TenantDB) Scoped(m TenantTable) *gorm.DB {
    return t.db.Model(m).Where(m.TenantColumn()+" = ?", string(t.org))
}
```

`RegisterGuard` registers on gorm's `Query/Update/Delete` callbacks and aborts a builder statement on a registered tenant table whose WHERE omits the tenant column. **It explicitly does NOT cover `db.Raw(...).Scan()` / `db.Exec(...)`** — gorm fires those through the Row/Raw chain, which the guard never sees. The 16 raw-SQL sites (webhook `handlers.go:341`, projector, `loadBaselineBatch`, `readSnapshotRows`, …) are therefore **not** trusted to the runtime net; each is *rewritten* as a builder-based `TenantDB.Scoped` call or wrapped in an org-typed repository method. A `forbidigo` lint rule bans `db.Raw`/`db.Exec` on tenant tables outside feature repository packages, so the rewrite is enforced.

**The precise residual value of the `tenantdb` guard** over the signatures + `Scoped()` + lint stack is one thing the rest cannot catch: an *in-repo builder call where the org argument is in scope but is never applied to the WHERE clause*. `Scoped()` is a convenience helper, not a forcing function — nothing compels a hand-built builder statement to call it. The guard is the only mechanism that fails such a statement at runtime. **Do not cut the guard.**

**Cross-org sweeps are a typed capability, not an escape-hatch flag.** Legitimate sweepers (build/coding-agent/on-hold/trait-sync watchers) call:

```go
func SweepAllOrgs(ctx, orgs Resolver, fn func(ctx context.Context) error) error
// iterates organizations, re-enters fn with a per-org Caller{Source: SourceServiceIdentity}
```

so each iteration is org-scoped by construction and no watcher ever holds a global handle. A `forbidigo` rule bans any `db.Set("tenancy:allow_global", …)` literal outside `platform/tenant`.

#### 6.1d Tenancy column / path-var standardization

The logical key is **already the handle on every tenant table** — the work is to make it *uniform and legible*:
- **Column name:** converge on `org_id` everywhere; rename the `oc_org_id` PK on the credential tables to `org_id` (it already holds the handle) — `TenantColumn()` returns `"org_id"` for all tables. Rename the misleading `ocOrgID` service/repo parameters to `org`/`orgHandle` in the same PR that extracts each feature.
- **Path-var name:** rename all path vars to `{orgHandle}` (IDP `{orgId}` and credentials `{ocOrgId}` first).
- **Identifier discipline:** the handle keys all tables; the Thunder `ouId`/`ThunderOrgUUID` is used **only** for `X-Impersonate-Org` and the `wc-` namespace and is never written to a tenant column. Do **not** introduce a UUID-typed table key.
- **Schema:** replace `GitRepository.ProjectID` global unique with composite `(org_id, project_id)` (F2); add `org_id` to `design_version_skill_snapshots` (drop-and-rematerialize, F9) and `webhook_payloads` (backfill from delivery, F-WP); force artifact resolution through `GetByOrgAndProjectID` (F1).

#### 6.5/6.6 Canonical tenant-identifier map

The single source of truth for "what does this table's tenant column hold, and what type does its repo take." **Every tenant table keys on the handle**; the column-name column shows today's inconsistency (all converge to `org_id`).

| Table | Today's tenant column | Holds | Repo arg type | Notes |
|---|---|---|---|---|
| `component_tasks` | `org_id` | handle | `tenant.OrgHandle` | F6/F2t–F5t: add `GetByIDScoped` |
| `component_configs` | `org_id` | handle | `tenant.OrgHandle` | already composite-unique `(org_id, project_name, component_name)` |
| `git_repositories` | `org_id` | handle | `tenant.OrgHandle` | F2: composite `(org_id, project_id)` unique |
| `org_credentials` | `oc_org_id` (PK) | handle | `tenant.OrgHandle` | rename col → `org_id` |
| `org_anthropic_credentials` | `oc_org_id` (PK) | handle | `tenant.OrgHandle` | rename col → `org_id` |
| `org_secrets` | `oc_org_id` | handle | `tenant.OrgHandle` | rename col → `org_id` |
| `webhook_deliveries` | `oc_org_id` | handle | `tenant.OrgHandle` | rename col → `org_id` |
| `webhook_payloads` | *(none)* | — | `tenant.OrgHandle` | F-WP: add `org_id NOT NULL`, backfill from delivery |
| `design_version_skill_snapshots` | *(none)* | — | `tenant.OrgHandle` | F9: add `org_id`, drop-and-rematerialize |
| `coding_agent_logs` | *(none, FK `task_id`)* | — | via task scope | scoped through its parent `component_tasks` |
| `organizations` | `name` (PK is `uuid`) | handle=`name`; `thunder_org_uuid`=ouId | n/a (the resolver) | the only place handle↔ouId is mapped |
| `idp_audit_events` / `skill_audit_events` | `org_id` / (derived) | handle | `tenant.OrgHandle` | audit, scope by org |

**Not a tenant identifier:** `ouId`/`ThunderOrgUUID` (impersonation + `wc-` namespace) and `project_id`/`project_name` (intra-org scoping, always paired with `org_id`).

#### 6.6f Route-posture table (every mount → Source → Bind\*)

The allowlist invariant is only complete if **every** `app.go` mount has an assigned posture. No outer-mux route may read an org from path **or body** without a `Bind*` establishing the `Caller`.

| Route group | Today's mount | Source | Binding | Notes |
|---|---|---|---|---|
| `/api/v1/organizations/{orgHandle}/…` (project/req/design/component/task/board/config/skill/github/anthropic) | apiMux (jwt+orgensure) | `SourceUserJWT` | `BindUserOrg` | closes IDOR-1..5 |
| `/api/v1/organizations/{orgId}/idp-profile/…` | apiMux | `SourceUserJWT` | `BindUserOrg` (after `{orgId}`→`{orgHandle}` rename) | closes IDOR-2 |
| `/internal/credentials/orgs/{ocOrgId}/…` | gsMux (ServiceJWT) | `SourceServiceJWT` | `BindServiceOrg` (scoping only) + Task-JWT/Secret-projection for secret-returning routes | rename `{ocOrgId}`→`{orgHandle}`; INT-3 |
| `/repos/{orgId}/{projectId}/…` | gsMux (ServiceJWT) | `SourceServiceJWT` | `BindServiceOrg` row-binding | F4/F7 |
| `/repos/{projectId}/board` | **outer mux, no auth** | `SourceServiceJWT` | re-key to `/repos/{orgHandle}/{projectId}/board` + `BindServiceOrg` | **F3** (confused-deputy today) |
| `/api/v1/orgs` InitProject (**org in BODY**) | outer mux | `SourceServiceJWT` | `BindServiceOrg`-equivalent with **body-org row-binding**, or move org to path | org read from body with no binding today |
| `/api/v1/tasks/{taskId}/{skills,verification-failed,credentials/refresh}` | **outer mux, inline bearer** | `SourceTaskJWT` | `BindRunnerScope` (assert `claims.TaskID==path`, org from row) | re-mount under the gate; INT-6 |
| `/internal/v1/credentials/refresh` (legacy) | taskMux (RequireTaskBearer) | `SourceTaskJWT` | `BindRunnerScope` → then retire (Secret projection) | INT-6 |
| `/webhooks/github`, `/api/v1/webhooks/github` | outer mux, HMAC inside | `SourceWebhookHMAC` | resolve org from routing key → HMAC-verify → `Router.Dispatch(Caller{…})` | INT-2 |
| GitHub App connect callback | outer mux | `SourcePublisherCC` | validate the signed connect-state JWT; bind org **from that state**, not from path | not a path/body org |
| `/internal/credentials/orgs/{ocOrgId}/anthropic/effective-key` | **outer mux, no auth** | — | **delete the route** → runner: projected Secret; agents-service: BFF-injected key (§7.12) | INT-1 |
| `GET /api/v1/organizations` (listing) | apiMux | `SourceUserJWT` | `registerPublic` — scoped to the JWT's own org, no path var | carve-out |
| `GET /api/v1/idp/discover` | apiMux | `SourceUserJWT` | `registerPublic` — no org | carve-out |
| `POST /api/v1/_test/reset` | apiMux (TestMode) | `SourceUserJWT` | `registerPublic` + `DeploymentTier==dev` assertion (INT-4) | carve-out; org-scope the delete in `cleanup` |
| `GET /api/v1/collab/validate` | **outer mux** | `SourceUserJWT` | bring under signature-verify + project-scoped check (INT-8); keep enumerated | carve-out — must not ship signature-only |
| `GET /health`, `GET /auth/external/jwks.json` | outer mux | — | `registerPublic` (intentional) | unauthenticated by design |

#### 6.6g The project-ownership oracle (the single source for "org owns project")

Three places need to answer "does this org own this project?": INT-8's project-scoped collab check, the board route, and the webhook merged-PR handler's repo→project resolution. **There is no standalone `projects` table with an org FK** — org-owns-project is established **solely** by the existence of the `(org, project)` row in `git_repositories`. The one port that answers all three is `gitrepo.RepoRepository.GetByOrgAndProjectID(caller.Org, projectID)` returning a row (404 otherwise). Every project-scoped route calls it **after** establishing the `Caller`; `requirements`/`design`/`task`/`project`/`webhook` all depend on this one port. This is also the exact-match resolver that replaces the unanchored INT-2 `ILIKE … LIMIT 1`.

### 6.7 Canonical: Finding → Fix → Phase

This is the **single** place each finding's fix and its phase are stated (the §3 table is location/severity only; §4's feature notes point here; §9's phase table references this rather than restating fixes). Phase labels refer to §9's feature-labeled phases.

| Finding(s) | Fix | Phase |
|---|---|---|
| IDOR-1, IDOR-3, IDOR-4, IDOR-5, TEN-A | `registerOrgScoped`/`BindUserOrg` gate fn at each org-scoped route (§6.1b); 404 on path≠claim mismatch; `orgensure` JIT-ensure folded in **after** the path==claim check | `gate` |
| IDOR-2 | Normalize `{orgId}`→`{orgHandle}` **first**, then `BindUserOrg` gate + claim match on the secret-returning route + slug validation | `gate` (rename) / `credentials` |
| IDOR-6 | OC resolver reads `scope.ThunderUUID`; DB path-namespace fallback gated to `Source == SourceServiceIdentity` only; fail-closed (carve-out wired first) | `watchers` |
| IDOR-7, F1, F4, F7, F10 | Resolve via `GetByOrgAndProjectID` everywhere; remove org-less methods; F10 subsumed (bundle read only from correctly-scoped clone) | `gitrepo` (IDOR-7/F4/F7); `artifacts` (F1 core) |
| TEN-B | `BindServiceOrg` = scoping/observability only (not authorization); no secret route gated by it alone | `gate`/`credentials` |
| F2 | Composite `(org_id, project_id)` unique index + org-scoped create/delete. **Audit SQL** (run before the migration; expect 0 rows because the existing *global* unique already forbids dupes — the real collision surface is the *other* `project_id`-keyed tables, audit those too): `SELECT project_id, count(DISTINCT org_id) c FROM git_repositories GROUP BY project_id HAVING c > 1;` | `gitrepo` |
| F2t–F5t, F6 | `GetByIDScoped(org,id)` from `tenant.MustOrg`, 404 on org mismatch; bare `GetByID`/`GetByIssueURL` → `InternalTaskRepository` (service-identity only) | `task` |
| F3 | Re-key board routes to `/repos/{orgHandle}/{projectId}/board`; `BindServiceOrg` row-binding; resolve via `GetByOrgAndProjectID` | `gitrepo` |
| F5 | Org-qualified typed `ProjectLockKey(org, projectID)` | `req+design` |
| F8 | Rewrite raw `loadBaselineBatch` as an org-typed repo method (`org_id` predicate, builder API) | `task` |
| F9 | Add `org_id` column + **drop-and-rematerialize** derived snapshots **+ one-shot backfill loop**; org-typed repo method; composite `(org_id, project_id, design_version, skill_id)` unique afterward | `project+org+idp+skills` |
| F-WP | Add `org_id NOT NULL` to `webhook_payloads`, backfilled from joined `webhook_deliveries` org column; scope reads by org | `projector+webhook` |
| INT-1 | Delete the unauth `effective-key` route entirely. **Two consumers, two transports of the same principle:** (a) **runner** (WP pod) reads an SSA-projected per-org Secret in `workflows-<org>`; (b) **agents-service** (control plane) receives the key **injected by the BFF** per request (`X-Anthropic-Key`), resolved in-process from the authorized `Caller` (§7.12) | `svc-aud` |
| INT-2 | Thread validated org via `Router.Dispatch`; **resolve scoped-by-org with exact host/owner/repo match** (delete the unanchored `LIMIT 1` lookups); unique `(org,repo)`; 4xx-drop on absent. **Two sites with *different* predicates:** the post-verification **sink** `handlers.go:339-344`, AND the pre-verification **routing resolver** `credential_service.go:898-903` (moves to `gitrepo`'s `RepoRepository` exact-match) | `projector+webhook` (sink); `gitrepo` (routing resolver) |
| INT-3 | Distinct `aud` for service tokens (own coordinated PR); `BindServiceOrg` row-binding for *scoping*; **no secret-returning route on Service-JWT alone** | `svc-aud` |
| INT-4 | `DeploymentTier==dev` fail-fast assertion + a dedicated dev-only flag in `gate`; the org-scoped delete rewrite (replacing the global `Where 1=1` truncate) lands in `cleanup` | `gate` (tier assertion + flag); `cleanup` (org-scoped delete) |
| INT-5 | Handler-level admin token; require `?org=`; loopback bind (already double-gated dev-only) | `cleanup` |
| INT-6 | `BindRunnerScope` (task↔org DB check) closes the IDOR now; route then **retired in favor of SSA Secret projection** (§9.2) | `watchers` (BindRunnerScope); `cleanup` (route retire) |
| INT-7 | Derive namespace from `scope.ThunderUUID` via `RemoteWorkerNamespace`; never caller-supplied | `watchers` |
| INT-8 | **Two-part:** (a) signature-verify the Bearer JWT (NOT `ParseUnverified`); (b) project-scoped access check — the verified caller's org must own the room's project (via the §6.6g oracle). Keep the route enumerated in the §6.6f carve-out | `req+design` |
| raw-SQL strays | `forbidigo` ban + rewrite as builder/repo methods (NOT the runtime guard) | `cleanup` (ban enabled last); rewrites per owning phase |

### 6.8 Clients as ports & adapters

**Rule (exactly one survives):** the **consumer** defines the narrow port in its own package; the `clients/` adapter *structurally* satisfies it and **does not import `internal/feature/*`**. The compile-time `var _ feature.Port = (*adapter)(nil)` assertion lives in the composition root (or the adapter's wiring test), where both sides are already in scope. This preserves the invariant "`clients/` and `platform/` never import `internal/feature/*`" with no cycle.

```go
// internal/feature/component/ports.go — narrow, consumer-shaped
type OCComponents interface {
    ListDeployments(ctx, org, project, name string) ([]models.Deployment, error)
    UpdateComponentTraits(ctx, org, project, name string, t models.ComponentTrait) error
}
// cmd/asdlc-api/wire.go — assertion at the wiring boundary, NOT in clients/
var _ component.OCComponents = (*occlient.Adapter)(nil)
```

- Fat producer interfaces split per consumer: `agents.Client` → `task.TechLeadAgent` + `requirements.DocAgent`; `ComponentClient` → per-feature method subsets. Org stays an **explicit port parameter** so the tenancy contract is visible at the seam.
- **Token providers reconcile.** The canonical seam is the **contextless** `token.Source interface { Token() (string, error) }`, with an optional `token.Invalidator interface { Invalidate() }` discovered via type-assertion. This shape matches **3 of the 4** existing providers verbatim — `oauth.TokenProvider`, OC `transport.AuthProvider`, and `clustergatewayproxy.AuthProvider` — and both `Invalidate()`-based 401-retry consumers; those three need **no change**. The **lone narrowing case** is the concrete `clients/auth` provider, which keeps its `GetToken(ctx)` and **adds a thin contextless `Token()` shim**. **`token.Source` is THE single outbound platform-plane auth seam** (§6.10a): one provider injected into every platform client (OC, cluster-gateway-proxy, SM-API), `nil` locally (k3d proxies run auth-off) and the M2M provider in cloud; a client never mints its own credential.
- `clients/openchoreo/gen` stays isolated, imported only by `clients/openchoreo/occlient`. **Only *genuinely* single-consumer clients move into their owning feature's `internal/feature/<name>/adapters/`** (`oidc`→idp, `k8s`→credentials, `observer`→codingagent). **Multi-consumer clients STAY under `clients/` as shared adapters with per-feature ports**: `thundersvc` has **three** consumers (`idp`, `runtimeconfig`, `codingagent`'s publisher-token path) and `observability` has **two** (`component` build-logs + `codingagent` progress). Cross-service wire DTOs (`ProgressEvent`, agents DTOs) live in `contracts`; OC sentinel errors + the label/annotation catalog stay in `occlient`. A **cloud-only-service adapter additionally owns its in-repo local stub** as a parity-tested sibling (`smapi`→`deployments/local-secret-manager-api`, `clustergatewayproxy`→`deployments/local-cluster-gateway-proxy`); one contract test gates both impls (§6.10b, ADR-0002/0003).
- `moq` `//go:generate` directives follow their interfaces — to the feature-local ports.

### 6.9 Shared kernel + inter-feature contracts

The kernel admission test: **a type goes in `platform/` only if removing it forces two unrelated features to duplicate it or re-cross a boundary.** Anti-junk-drawer exclusions: `NormalizeExternalURL` (single consumer → `runtimeconfig`), `conflict_retry` (→ `artifacts`), `api_security` predicates (→ `design`), OC-facade DTOs (`models/component.go`/`project.go` → `occlient`). The flat `models/` package is **dissolved** into per-feature packages and `contracts` — but this has a real import-cycle trap:

> **`models/` dissolution & the `TaskStatus` cycle.** `contracts` imports `models` value types, so `models` must **not** import `contracts` or it cycles. But hoisting `TaskStatus`/`TaskEvent` into `contracts` (needed by the state machine, §4.0) collides with `ComponentTask.Status` (gorm-tagged, in `models`) and **~14 `models.TaskStatus` consumers**. Resolution: move `TaskStatus`'s canonical definition **fully into `contracts`** and change `ComponentTask.Status` to `contracts.TaskStatus` directly. The value types `contracts` needs (`ArtifactVersion`, `TaskStatus`, …) move OUT of the gorm-tagged files *first*, into `contracts`, and `models` imports `contracts`, not the reverse. The blast radius is **~14+ files, not "zero-risk."** A **per-file destination table** (`version.go`→`contracts`; `spec.go`/`design.go`/`tasks.go`→ their features; `component.go`/`project.go`→`occlient`; `wp_naming.go`→`platform/tenant`; `TaskStatus`/`TaskEvent`→`contracts`) is a `helpers`-phase deliverable so the dissolution order is explicit and acyclic.

Inter-feature wiring (the precise rule): a consumer A defines a **narrow port** in its own package naming only the methods it calls; B's concrete *satisfies* it. Shared **DTOs** live with their producer's published `contract/` (or in `contracts` if ≥2 unrelated features need the identical shape). **No fat service interface is exported from any feature.** Cross-feature side effects (`DesignChanged`, `OnTaskDeployed`, `TaskTransitions`, `BuildDispatcher`) are hook interfaces *defined in `contracts`*, *invoked* by the emitter, and *provided* by the composition root — replacing the `SetX` type-assertion cascade. A `depguard` rule in `.golangci.yml` forbids `internal/feature/A` from importing `internal/feature/B` (only `contracts` + ports).

**The `internal/contracts` anti-junk-drawer rule is mechanically guarded.** The guarantee that matters is **leaf-ness (import restriction)**, not behavior-freeness — `contracts` legitimately owns the pure `ApplyTaskEvent` algebra:
- a `depguard` rule asserting `internal/contracts` imports **only stdlib + `models` value types** (no feature, no `platform/*`, no `gorm`, no client);
- a supporting lint that bans I/O and stateful package-level vars in `contracts` (the package may declare functions with bodies — `ApplyTaskEvent` — but they must be pure). Do **not** use a "no method body beyond a constructor" check.

### 6.10 Error taxonomy + transaction boundaries + connection pool

- **One error model** (`platform/apperr`): `Code` enum + `Error` carrier; feature sentinels constructed via `apperr.E(...)` (e.g. `ErrSpecNotApproved = apperr.E(FailedPrecondition, "spec_not_approved", …)`), still `errors.Is`-able. The bespoke `ValidationError`/`ConflictError`/`NotFoundError` structs collapse into codes. The HTTP layer calls **only** `httpkit.WriteAppError`, which **preserves the existing `{error, code}` body shape and the 404/409/400 mappings** from `credential_errors.go` (including project `openchoreoErrorStatus`) so console/agents snapshots don't break. Repositories return raw db errors; the service translates at its boundary. *Adopted lazily — per feature, when its controller mapper actually moves.*
- **Transaction boundaries:** the immediate, real need is org-qualified advisory locks (`OrgLockKey`/`ProjectLockKey`/`TaskLockKey` in `platform/tenant`), which fix F5, `task_stream.go:92`, `dispatch_cascade_hook.go:91`. A full `uow.Runner`/`Querier` abstraction is **deferred** — there is no identified multi-write transaction-correctness bug, and the shared `*gorm.DB` already serves. Every table still gets a feature-owned repository.
- **Connection pool & concurrency:** the **single `*gorm.DB` (one pool) is retained** — per-feature stores wrap the *same* handle; the restructure does not shard the pool. State the pool config once at `bootstrap.Open` (`SetMaxOpenConns`/`SetMaxIdleConns`/`SetConnMaxLifetime`) sized for `(HTTP concurrency + N watchers × per-org fan-out)`; `SweepAllOrgs` must process orgs **sequentially within a watcher** (or with a bounded sub-pool semaphore) so a 200-org cloud tenant set cannot exhaust the pool.

### 6.10/6.11 Composition root

`cmd/asdlc-api/main.go` stays the single composition point but becomes a **feature assembler**. Each feature exposes `New(Deps) *Feature` (typed `Deps` carrying sibling **ports** + `contracts` hooks — no concrete sibling structs) and `Register(router)`. `main.go` shrinks to: load config → `bootstrap.Open` + `migrations.Run` → build the shared infra bundle (auth verifiers, obs, one client set, the fail-closed impersonation resolver, the `var _ port = adapter` assertions) → construct features in dependency order → `for _, f := range features { f.Register(router) }` → start watchers under one `watcherCtx` (each via `SweepAllOrgs`) → serve.

The ~40-field `AppParams` is replaced by per-feature `Deps`. **Mandatory** collaborators become **required, non-pointer constructor params** so a missing wire is a **compile error**; only *genuinely optional* hooks remain nil-able typed fields, and for those the wiring test must assert **behavior** (fire the hook, observe the provider was invoked), not mere field presence. The hand-mounted four sub-muxes become a typed `platformhttp.Router` whose `registerOrgScoped`/`registerService`/`registerTaskBearer`/`registerPublic` methods apply the matching posture per route — a feature declares posture by *which method it calls*. This typed `Router` is the forcing function behind the allowlist-by-construction invariant of §6.1b.

**The wire block carries a hook→provider comment map for traceability:**

```go
// contracts.DesignChanged   ← design       emits   → task.ReconcileHook
// contracts.OnTaskDeployed   ← task(projector) emits → runtimeconfig/component cascade   (post-DEPLOY; today's SetDispatchHook)
// contracts.BuildDispatcher  ← task(handler)  emits  → codingagent.WorkflowRunService    (merge-time build; NEW hook)
// contracts.TaskTransitions  ← codingagent + webhook  →  task.projector (MarkBuilding/MarkBuilt/MarkFailed)  (status write-back)
```

The map distinguishes the **two task-side hooks that are easy to conflate**: `OnTaskDeployed` is the *post-deploy* cascade (sibling unblock), wired today via `projector.SetDispatchHook`; `BuildDispatcher` is the *merge-time* build trigger, a **new** hook. `TaskTransitions` carries the status write-back so codingagent never imports task concretely.

The composition root also builds the single `DeploymentEnv` bundle (§6.10a) — `OCAccess` / `token.Source` / `RunnerAuthMode` / `SecretMgr` — chosen **once** from deployment config. Runner reach-back collapses to one `AGENT_PLATFORM_URL` whose *value* (not presence) differs per env, with a `depguard`/grep ban on parallel `*_SERVICE_URL` vars. Each dangerous local-only surface sits behind its **own** 1:1 capability flag that the cloud release binding sets `false` by default (one flag = one capability — never an overloaded `TEST_MODE`).

### 6.10 Two-path convergence (local k3d ⇄ wso2cloud)

`asdlc-service` ships **one binary** that must run on two deployment planes: the in-repo **local** stack (`deployments/`, k3d + docker-compose — a *dedicated* OpenChoreo whose Thunder is the only trusted issuer, single org on the default OU, OpenBao, simpler/often header-less auth) and **wso2cloud** (a *shared* `platform-api` that routes and **bills by the JWT `ouId` claim**, per-org Thunder OUs + publisher client-credentials, the real `secret-manager-api` behind ESO, a JWT-validating `cluster-gateway-proxy`, per-org ECR pull secrets, CP/WP plane split). The convergence canon — recorded as ADRs 0001–0006 (full reconstruction in **`docs/design/wso2cloud-dual-path-pr-analysis.md`**) — is one rule:

> **Every local/cloud difference is a single injected value, a nullable provider/resolver, or an in-repo stub of the cloud service — never an `if cloud … else local …` branch. Identity and topology are *derived from request scope*, never configured.**

**ADR index (0001–0006, committed to `docs/adr/` as part of this work):**
- **0001** — coding-agent off the workflow-plane.
- **0002** — local SM-API in-repo stub (behind one HTTP contract).
- **0003** — coding-agent via cluster-gateway-proxy.
- **0004** — namespaced `ComponentType`.
- **0005** — dual-mode OC auth (`X-Impersonate-Org`).
- **0006** — build git secret via OC `CreateGitSecret`.

The restructure makes that canon **structural** instead of incidental. Today it is implicit and re-decided per request (three seams on `main`: `transport.go:126` `useServiceIdentity := IsServiceIdentity(ctx) || userJWT=="" || ImpersonateOrgResolver==nil`; `dispatch_service.go:665` `isGatewayPlatformURL` sniffing `https://`; the present/absent M2M `token.Source`). Three mechanisms:

#### 6.10a One `DeploymentEnv` provider, selected once at the composition root

The per-request seams collapse into one typed bundle built at wiring time:

```go
type DeploymentEnv struct {
    OC          OCAccess        // DirectOC (k3d) | ImpersonatingOC (cloud) — picks the OC adapter, not a per-request branch
    PlatformAuth token.Source   // nil (local: proxies run auth-off) | M2M provider (cloud) — one credential, every platform client
    RunnerAuth  RunnerAuthMode  // PerTaskBearer (local) | PublisherCC (cloud) — replaces the isGatewayPlatformURL https-sniff
    SecretMgr   SecretMgrClient // local stub | real SM-API — identical HTTP contract
}
```

A feature never asks "am I in cloud?"; it consumes the injected port. The `OCAccess` adapter exposes one `ForCaller(ctx)` reading `Caller.Source`: `SourceUserJWT` forwards the user JWT (platform-api routes/bills by its `ouId`); **every service source** attaches the M2M token + `X-Impersonate-Org` from `Caller.ThunderUUID` (already on the `Caller` — no `namespaceFromPath` re-parse, no `userJWT==""` heuristic). The `DirectOC` impl omits both. This deletes the IDOR-6 confused-deputy *and* all three per-request seams in one move. The durable lesson: **auth intent must be a positive first-class marker (`WithServiceIdentity`), never inferred from incidental ctx state** (ADR-0005).

#### 6.10b Cloud-only capability = one narrow HTTP contract + a per-env implementation

Where the real cloud binary can't run locally, an in-repo stub of identical shape does (`deployments/local-cluster-gateway-proxy`, `deployments/local-secret-manager-api`), so local testing exercises the cloud code path with zero `if cloud` branches. **Each such adapter OWNS its stub as a parity-tested sibling**: `credentials/adapters/smapi` and `codingagent/adapters/clustergatewayproxy` each ship the contract test that BOTH the real client and the in-repo stub must satisfy (ADR-0002/0003). Promote "in-repo stub behind one HTTP contract" to a named pattern so the next cloud-only dependency follows it, not an OpenBao-style structurally-different local provider.

#### 6.10c Derive identity from scope; one flag = one capability

- The `wc-<first8>-<sha256[:8]>` derivation **relocates** to `platform/tenant` keyed on `Caller.ThunderUUID`. The move buys **location** (gorm-free, readable by HTTP/middleware), not de-duplication — within the BFF it is already centralized in one helper. The **only** genuine parallel implementations live in **other processes** (external cloud SM-API + local stub) and are reconciled by the §8 **byte-parity contract test**. Do **not** treat `sm_api_writer.go` (a caller) or `models/wp_naming.go` (the *different* `workflows-` family on a *different* plane) as duplicate `wc-` impls.
- Per-org publisher OU, publisher token URL (from the org JWKS URL), and managed-DB grant identity (`CURRENT_USER`) are likewise *derived*, not configured.
- Config toggles are the seam of last resort and each maps **1:1 to a capability gated by deployment-env identity** (e.g. `LOCAL_OPENBAO_REPAIR`, never an overloaded `TEST_MODE`); the cloud release binding sets every local-only flag `false` by default.
- Env-agnostic *idempotent* operations (bootstrap self-grant; degrade-to-empty-`secretRef`; provision the same-named ComponentType in both envs) absorb the divergence at runtime — a safe no-op in the permissive env, a self-heal in the restrictive one — rather than branching.

The ADRs (0001–0006) are committed to `docs/adr/` as part of this work; they govern code already on `main` but were never landed (see §7.11).

### 6.12 Fresh-Scenario Walkthrough (Phase-1 handover)

**Scope.** Phase-1 is the **auth + org + platform** surface — the seams in §6.10a, the `gate` phase (§9), and the identity plumbing in `organization` (§4.1), `credentials` (§4.2), `idp` (§4.3), `gitrepo` (§4.4), plus `runtimeconfig`/`project` (§4.12). Business-logic feature internals (requirements/design/task **generation**) stay out of scope until Phase-1 is **green on both planes** (§6.13, §10). This subsection traces a brand-new user from first login to a provisioned repo, naming the **owning module** and the **seam** at each step and marking where the two planes (§6.10) diverge. It **does not redefine** the seams — `DeploymentEnv` is §6.10a, `token.Source` is §6.8, `Caller`/`Source` is §6.1a; it only traces a request through them. Each marked divergence is proven at runtime by the matching `[SHAKEOUT:*]` log in §6.13.

> **The one rule, restated for the trace:** no stage asks "am I in cloud?". Every divergence below is a single injected value (§6.10a), a nullable resolver, or an in-repo stub — and identity (`Caller.Org`, `Caller.ThunderUUID`) is **derived from the verified JWT claim**, never from config or the URL path.

**(a) First Thunder login.** The console SPA loads `/env-config.js` → `window._env_` (Thunder URL, `asdlc-console-client`, scopes, redirect), then the Asgardeo SDK runs **browser PKCE** against Thunder `/oauth2/authorize`. The BFF has **no** `/login`, `/callback`, or `/token` — it is never in the handshake. The SDK exchanges the code at `/oauth2/token` for a **User JWT (RS256)** held in `localStorage`; every later call carries `Authorization: Bearer <User JWT>`. The BFF's only auth role is **inbound verification** (`platform/auth`, §4.0): JWKS-cached RS256 verify + `iss`/`aud` (`asdlc-*`) check → projects `Claims`. *State:* User JWT in the browser only — no server session.

| | Local (k3d) | wso2cloud |
|---|---|---|
| `env-config.js` | container entrypoint heredoc from compose env | BFF-owned `ReleaseBinding` `container.files` literal (same image) |
| Thunder | `thunder.openchoreo.localhost:8080` direct; `JWKS_URL=…/oauth2/jwks` | `platform-idp.gateway.<base>`; per-cluster `JWT_ISSUER`/JWKS URL |
| Inbound verify | `ThunderJWKS==nil` ⇒ `IsLocalDevEnv` extracts claims **unverified** (still checks `iss`/`aud`/exp) | full RS256, no fallback — `[SHAKEOUT:CLAIMS]` |

The PKCE handshake shape is identical on both planes; only the issuer/JWKS wiring differs.

**(b1) Org resolution — verify-only.** The first authenticated request hits `BindUserOrg` (§6.1b): `tokenOrg = ResolveOuHandle(claims)` (precedence `ouHandle>ouName>ouId`, `jwt.go`), `pathOrg = PathValue("orgHandle")`, then the **`EqualFold` check** → 404 on mismatch (closes IDOR-1..5). Only then `EnsureForOuHandle` (`organization`, §4.1). **The BFF never creates the OC namespace:** `EnsureForOuHandle` calls `NamespaceClient.GetNamespace`, **get-or-creates only the local `organizations` side-car row** (`uuid`, `name=handle`, `thunder_org_uuid=ouId`), and returns `ErrOrganizationNotProvisioned` if the namespace is absent. ("JIT-ensure" in §6.1b is the side-car **row**; the namespace is verify-only, created out-of-band — see table and §7.13.) *State:* one `organizations` row.

| | Local (k3d) | wso2cloud |
|---|---|---|
| OC namespace created by | install scripts (`setup-asdlc.sh` labels `default`, pre-creates `workflows-default`); single org, `ouHandle` hardcoded `default` | `platform-api` provisions it out-of-band (exact trigger TBD — see §7.13); per-org Thunder OU; ns `wc-<first8>-<sha256[:8]>` derived from `Caller.ThunderUUID` — `[SHAKEOUT:ORG]` |

**(b2) Org-level keys — Anthropic dual-token + GitHub.** From Org Settings: **Anthropic** `POST …/anthropic` → validate against `/v1/messages`, write `org_secrets` `anthropic/key` (AES-256-GCM), upsert `org_anthropic_credentials`, best-effort SM-API mirror — it **never touches the workflow plane** (key delivery to agents-service is BFF-injected per request, §7.12). **GitHub** PAT or App callback → write `org_secrets` `github/pat`, upsert `org_credentials` with its `kind`. **`org_secrets` (Postgres, AES-256-GCM) is authoritative**; the SM-API/OpenBao mirror is a downstream projection (§4.2, §6.10b) — the BFF never reads secrets back from SM-API as source of truth. Dual-token: the per-org key (coding-agent, hard-required) plus the platform fallback `ANTHROPIC_PLATFORM_KEY` (agents-service long-lived flows only). *Owner:* `credentials` (§4.2) + `idp` publisher (§4.3).

| | Local (k3d) | wso2cloud |
|---|---|---|
| GitHub `kind` (the seam) | `user-pat`; resolver returns the PAT (seeded by `seed-dev.sh`) | `app-installation`; `AppTokenMinter` short-lived install tokens — `[SHAKEOUT:CRED]` |
| `SecretMgr` (§6.10a) | `local-secret-manager-api` stub (parity-tested) | real `secret-manager-api` + ESO; same `smapi` contract — `[SHAKEOUT:SMAPI]` |
| Publisher OU (§4.3) | single default OU (masked) | `EnsureOrgPublisher` under the org's own OU; token URL from the org JWKS |

**(c) Create a project.** `POST …/organizations/{orgHandle}/projects` (Caller already bound, `SourceUserJWT`). `project` (§4.12) orchestrates: (1) OC `ProjectClient.CreateProject` — the project **lives in OC**, the BFF keeps no `projects` table; (2) `gitrepo.CreateRepo` keyed `(org_id, project_id)` (F2); (3) webhook register (best-effort). OC identity comes from `OCAccess.ForCaller` (§6.10a). Org-owns-project is the existence of the `(org, project)` `git_repositories` row (§6.6g, IDOR-7). *State:* OC Project CR + `git_repositories` row (`cloning`).

| | Local (k3d) | wso2cloud |
|---|---|---|
| `OCAccess` (§6.10a) | `DirectOC`: no Bearer, no `X-Impersonate-Org` (the namespace isolates) | `ImpersonatingOC`: `SourceUserJWT` forwards the user JWT; service sources attach M2M + `X-Impersonate-Org=Caller.ThunderUUID`; a resolver miss aborts — `[SHAKEOUT:OCAUTH]` |

**(d) Generate requirements (plumbing only).** Once the repo is `ready`, `requirements` (§4.6) streams from agents-service and writes `specs/requirements/requirements.md` into the clone via `artifacts` `ArtifactStore` → `PutFile` (atomic, per-project mutex, §4.5). Save → diff working-tree vs HEAD → apply over the default branch via the **GitHub Git Data API** under CAS retry → create the next `v<N>` tag. *Owner:* `gitrepo` (§4.4, **in-process** — no `GIT_SERVICE_BASE_URL`) + `requirements` + `artifacts`. *State:* a commit + a `v<N>` tag (versioning lives in git tags, not Postgres). The generation **content** is business-logic (out of Phase-1); only the auth/commit plumbing here is in scope.

| | Local (k3d) | wso2cloud |
|---|---|---|
| Generation key | falls back to `ANTHROPIC_PLATFORM_KEY` when the org key is absent | per-org key only |
| Clone storage | folded into `asdlc-api`; host bind mount | sole-owner `gitrepo` on an RWO PVC; the BFF holds no repo volume |

**(e) Repo creation / provisioning** (triggered inside (c)). `gitrepo.CreateRepo` is idempotent on `(orgId, projectId)`: resolve the org credential via `credentials.Resolver.Resolve` (branches on `kind`) → `POST /orgs/{owner}/repos` (`/user/repos` fallback), `AutoInit=true`, visibility from `GITHUB_REPO_VISIBILITY` → persist the row (`cloning`) → async clone (`GIT_ASKPASS` token) → `ready`. **A clone failure does not fail project creation.** Build git creds go through `BuildCredentialsService` → OC `CreateGitSecret` (ADR-0006), degrading to an empty `secretRef` when the cloud `/gitsecrets` capability is absent. *Owner:* `gitrepo` (§4.4) + `credentials` (§4.2).

| | Local (k3d) | wso2cloud |
|---|---|---|
| Credential `kind` | `user-pat` resolver | `app-installation` minter — `[SHAKEOUT:CRED]` |
| Repo owner | PAT login (`/user/repos` fallback) | App installation org login |
| Visibility / build secret | `private` + OC GitSecret | `public` (interim, blocked on wso2cloud#319) + empty `secretRef` |
| Webhook delivery | smee.io relay → `/webhooks/github` | direct ingress; mounted at `/webhooks/github` and `/api/v1/webhooks/github` |

**(f) Remaining Phase-1 bootstrap.** The per-project SPA OAuth client is deferred to first SPA dispatch: `runtimeconfig` (§4.12) `EnsureProjectOAuthClient` declares a per-project **public-PKCE** client via the Thunder **`/applications` REST API** (not a ConfigMap), keyed `(org, project)`, idempotent, then emits the Thunder keys into that SPA's `env-config.js` on its ReleaseBinding. Per-org publisher via `idp.EnsureOrgPublisher` (§4.3). DB bootstrap self-grant on `CURRENT_USER` (no-op local, self-heal cloud). Coding-agent dispatch and runner→BFF auth differ by `RunnerAuthMode` (§6.10a): `PerTaskBearer` local vs `PublisherCC` cloud — `[SHAKEOUT:TOKEN]`, `[SHAKEOUT:DISPATCH]`.

The §6.13 seam table is the consolidated fork index: each `[SHAKEOUT:*]` tag above marks exactly where that divergence is observed (and reconciled) at runtime.

### 6.13 Mandatory Instrumentation & Dual-Environment Reconciliation (Phase-1 shakeout)

**Mandate — not optional.** Phase-1 touches exactly the paths whose runtime behavior is **not knowable from the code alone**: they depend on what Thunder vs `platform-idp` actually put in the JWT, what `platform-api` derives for a namespace, and which credential/secret shape each plane carries. Therefore **every Phase-1 PR that touches an auth/org/platform seam ships deliberately verbose diagnostic logging at that seam, is run end-to-end on BOTH planes (local k3d AND wso2cloud), and its two log captures are diffed and reconciled before the code is considered correct.** The logs are temporary and removed with one grep, but only once both planes produce the expected values for a full fresh-scenario run. Erring toward **too many** logs here is correct: a missing log on the cloud path turns a silent mis-route into an undiagnosable downstream error.

**Prefix convention.** Use the existing `slog.*Context(ctx, …)` idiom (the `obs` ContextHandler auto-attaches `correlation_id`, §4.0) with one grep-able bracket tag the lowercase prose convention never collides with:

```go
slog.InfoContext(ctx, "[SHAKEOUT:CLAIMS] resolved org handle",
    "ouHandle", c.OuHandle, "ouName", c.OuName, "ouId", c.OuId,
    "resolved", resolved, "subject", c.Subject,
    "platformAuth", cfg.ServiceAuth.ClientID != "") // plane discriminator on every line
```

- Root tag `[SHAKEOUT]`; per-seam UPPERCASE suffix: `:CLAIMS :ORG :OCAUTH :TOKEN :CRED :SMAPI :DISPATCH`.
- **Emit at `Info`, never `Debug`** — wso2cloud may run at `info` level, so a `Debug` shakeout line would never appear in the cloud capture (defeating the purpose).
- Put a **plane discriminator** key on every line so local-vs-cloud is visible per record — e.g. `cfg.ImpersonateOrgResolver != nil`, `cfg.ServiceAuth.ClientID != ""`, `isGatewayPlatformURL(platformURL)`.
- **Never log a secret value.** Log presence/prefix/last4/length only (consistent with §7.12 "never logged"): Anthropic key, PAT, M2M secret, and Bearer tokens are logged as `"hasKey", k != ""` / `"last4", last4(k)`, never raw.
- **Removal:** `grep -rln '\[SHAKEOUT' asdlc-service` → delete the tagged lines, one commit at the phase's DoD.
- This **extends the existing precedent** — the `gate` phase's log-only "would-deny" canary + `TENANT_GATE_MODE=log→enforce` (§6.1b, §7.1) is the same pattern; `[SHAKEOUT:CLAIMS]`/`[:ORG]` carry the values the would-deny line does not.

**Seams to instrument (Phase-1).** Every row forks or is unverified across planes; instrument all before the first dual-plane run.

| Tag | File · symbol | Log these values | Why it is a dual-env risk |
|---|---|---|---|
| `:CLAIMS` | `middleware/jwt/jwt.go` · `ResolveOuHandle` | all three raw claims (`OuHandle`/`OuName`/`OuId`), which won, the empty-return case, `Subject`/`ClientID` | If cloud `platform-idp` sets only `ouId` (a UUID) where local sets `ouHandle` (a slug), the "handle" silently becomes a UUID and every downstream OC URL/lookup/impersonation uses the wrong key. Mirror of `console/src/utils/orgClaims.ts`; drift here mis-routes everything (§7.14). |
| `:CLAIMS` | `middleware/jwtassertion/auth.go` · `validateJWT` | branch taken (JWKS-verified, `IsLocalDevEnv` unverified, or fail-closed), token `iss`+`aud`, configured `AllowedIssuers`/`AllowedAudiences` | Cloud runs real RS256; a `JWT_ISSUER`/`JWT_AUDIENCE` that omits the platform-idp values 401s every request before any handler — a cloud-only break invisible locally. |
| `:ORG` | `services/organization_service.go` · `EnsureForOuHandle`/`verifyForOuHandle`/`ensureThunderUUID` | `ouHandle`, `claims.OuId`, cache hit/miss, row-existed?, `GetNamespace` outcome (found / `ErrOrganizationNotProvisioned` / other), backfill key used (`ouHandle`, NOT `view.Name`) plus the `view.Name` returned | Cloud `platform-api` returns the canonical `wc-…` ns name in `metadata.name` while the row is keyed by `ouHandle`; storing `view.Name` once made every per-org lookup miss forever. This is where the row gets the wrong key and `thunder_org_uuid` fails to backfill. |
| `:OCAUTH` | `clients/openchoreo/transport.go` · `authEditor`/`namespaceFromPath` | method+path; decision inputs (`userJWT` non-empty, `IsServiceIdentity(ctx)`, resolver non-nil); the resulting `useServiceIdentity`; branch taken; `namespaceFromPath` result; resolved `orgUUID` in `X-Impersonate-Org` (or "no org" / "no ns") | The central fork. `useServiceIdentity` = IsServiceIdentity OR userJWT-empty OR resolver-nil is subtle: an async path missing `WithServiceIdentity` but holding a user JWT forwards it and never sets the impersonation header, so the write lands in the wrong org's namespace. Behavior is opposite per plane. |
| `:OCAUTH` | `cmd/asdlc-api/main.go` · `orgUUIDResolver` | namespace arg; claim fast-path hit + `OuId`; or the DB side-car branch with `ThunderOrgUUID` (preferred) vs `org.UUID` (local-PK fallback) and which was returned | The fast path fires only when the claim handle equals the URL namespace. In cloud (UUID claim vs slug URL) it falls to the DB branch, which returns a random local PK when `thunder_org_uuid` was never backfilled, so the impersonated write targets a non-existent org. Async paths (webhooks/watchers) always hit this branch. |
| `:TOKEN` | `clients/oauth/token_provider.go` · `Token`/`fetchLocked` | `tokenURL`, `clientID`, cache-hit vs fetch, fetch status + (non-200) body, `expiresAt`; `Invalidate()` firing at `transport.go:87` | Local often has no provider (unauth proxies); cloud requires a valid `platform-idp` client-credentials token with specific Host routing. A wrong `clientID`/secret/URL surfaces only as a downstream 401→Invalidate→retry loop; the token endpoint's non-200 body is the fastest signal of which plane's Thunder rejected the creds. |
| `:CRED` | `internal/credentials/org_resolver.go` · `Resolve` | `ocOrgID`, `row.Kind`, `row.Status`, `InstallationID` presence (app), `IdentityLogin`, error class | The sole `kind` branch. A cloud `app-installation` row with a nil `installation_id` or non-active status returns errors `StageBuildSecret` collapses into `ErrOrgDisconnected`, so a mis-seeded kind looks identical to a disconnect. |
| `:SMAPI` | `services/sm_api_writer.go` · `WriteGitHubPAT`/`WriteAnthropic`/`resolveVaultKey` | `ocOrgID`, `SecretLocation`, returned `secretRefName`, `claims.OuId`, derived `OrgBaseNamespace(OuId)`, final `vaultKey` | `resolveVaultKey` rebuilds the Vault path from `claims.OuId` and must exactly match the ns SM-API derives server-side from the same JWT. A differing `OuId`, or a Connect without a user JWT, yields a wrong `sm_api_kv_path`, the ExternalSecret materializes nothing, and the coding-agent pod boots with no key. The classic silent dual-env break. |
| `:SMAPI` | `clients/.../secretmanagerapi/provider.go` · `PushSecret`/`resolveSecretID` | JWT present?, `baseURL`, derived `secretName`, label selector, response status, item count (0 ⇒ `ErrSecretNotFound`) | Async/service ctx has no JWT → instant "no JWT in context". A selector matching in single-tenant local may match 0 or the wrong item in multi-tenant cloud (`Items[0]` is taken blindly). |
| `:DISPATCH` | `services/dispatch_service.go` · `tryDispatchViaProxy`/`lookupOrgUUID` | `task.ID`/`OrgID`; each fallback reason (dispatcher nil, image/store empty, anthropic/github row missing, SM-API triplet nil, publisher-cc missing + `isGatewayPlatformURL`); `thunder_org_uuid` used vs local-PK fallback; final `RemoteWorkerNamespace(orgUUID)` | The explicit plane branch: local keeps the legacy per-task Bearer, cloud mandates publisher-cc and must fail loudly if absent. Many independent fallbacks each silently revert to legacy; without logging which one fired, a cloud dispatch that "does nothing" is undiagnosable. |

**Reconciliation loop (required per Phase-1 seam PR).**
1. **Instrument** the seam(s) the PR touches per the table.
2. **Run the fresh scenario (§6.12) on local k3d** (`deployments/`); capture with `docker compose logs asdlc-api | grep '\[SHAKEOUT'`, grouped by `correlation_id`.
3. **Run the same fresh scenario on wso2cloud** (deploy per the deployment runbook; full plane reconstruction in `docs/design/wso2cloud-dual-path-pr-analysis.md`), capturing the BFF pod logs (`kubectl logs <asdlc-api-pod> | grep '\[SHAKEOUT'`) the same way. If a repeatable cloud deploy + log-capture procedure does not yet exist, writing it is a Phase-1 prerequisite.
4. **Diff the two captures** per seam + `correlation_id`: values must either match or differ **only** by the intended injected seam (§6.10a). An unexpected divergence is a bug.
5. **Reconcile into the code** — eliminate the divergence (single injected value / derive-from-scope) or, if intended, record it as a seam in §6.10a. Never leave an `if cloud` branch.
6. **Attach both captures to the PR**, and where the value is now load-bearing, **lock it with a test** (`tenancytest`, an adapter parity test, or a claim-shape unit test).
7. **Remove the logs** (`grep -rln '\[SHAKEOUT' asdlc-service` → delete) as the **last commit before the phase's DoD**. A phase does not close with `[SHAKEOUT]` lines present.

**Phase-1 done = green on both planes.** No business-logic phase (req/design/task generation internals) starts until the fresh scenario (a)→(f) completes end-to-end on **both** local k3d and wso2cloud, every `[SHAKEOUT]` divergence is reconciled, and the would-deny canary (§7.1) is zero. See §10.

---

## 7. Risks & Open Questions

### 7.1 The central gate (`gate` phase) is highest blast radius
If `ResolveOuHandle` precedence (ouHandle>ouName>ouId, `jwt.go:49`) doesn't match how every console route identifies orgs, it 404s legitimate traffic. It is also **per-route, not a subtree mount** (stdlib `PathValue` timing) — every org-scoped registration must call `registerOrgScoped`; a missed registration leaves an open route. The structural defense is the **allowlist-by-construction invariant**: an `{orgHandle}`-bearing pattern is registerable only through the typed `Router`'s gating methods, and the CI check is "no raw `mux.Handle`/`registerPublic` of an `{orgHandle}`-bearing pattern" across both muxes. *Mitigation:* ship log-only "would-deny" first, diff against real traffic; reuse the exact logic mirrored in `console/src/utils/orgClaims.ts`.

### 7.2 `BindServiceOrg` is scoping, not authorization
The Service JWT is a single platform-wide identity, so a valid Service token can name any path org. No secret-returning route may rely on it alone — those move to the Task-JWT row-binding or Secret projection. INT-3's distinct `aud` only stops *user*-token replay.

### 7.3 Live UNIQUE-constraint changes need pre-migration audits
F2 (`git_repositories`), INT-2 (`(org, normalized_repo)` webhook), and F9 (`design_version_skill_snapshots`) all change uniqueness on live tables. F2/INT-2 require a collision audit + backfill/rename before the migration; F9 is handled by drop-and-rematerialize (snapshots are derived) to avoid an unbackfillable join when two orgs already collide on a project slug. Webhook task resolution was historically scoped by the per-org `project_id` slug alone (reused across orgs) until it was re-keyed to `(org_id, project_id)` from the globally-unique repo row; single-org local masked the collision entirely, so the two-org-same-slug test kit (§8) is the forcing function.

### 7.4 The compile-time org argument is the guarantee; the runtime guard is only a net for the builder API
Raw `db.Raw`/`db.Exec` (16 files) are not caught by the gorm callback — they are rewritten as builder/repo methods and enforced by a `forbidigo` ban. Cross-org sweeps use the typed `SweepAllOrgs` capability, not a free-form `allow_global` flag (also `forbidigo`-banned outside `platform/tenant`). The guard's unique residual value is catching an in-repo builder call where the org argument is in scope but never applied to the WHERE clause — so it is kept, not cut.

### 7.5 Fail-closing the impersonation resolver (IDOR-6) can break service-identity flows
Watchers/webhooks with no user JWT break if the `SourceServiceIdentity` carve-out isn't wired *first*. Sequenced in the `watchers` phase ahead of enforcement.

### 7.6 Moving the projector + 4 watchers touches the only writer of `ComponentTask.Status` under advisory locks
To keep dependency order intact, watchers stay in place during the `projector+webhook` phase (importing the new contract) and each evacuates with its destination feature in the `watchers` phase. `JobWatcher.markFailed`'s raw-UPDATE bypass is routed through `contracts.TaskTransitions` in `projector+webhook`. Needs a real-cluster integration test, not just `dbtest`.

### 7.7 Threading `orgID` through `ArtifactStore`/`save_via_api` (`artifacts` phase) intersects the per-project mutex (F5) and the concrete `*gitOpsService` panic-cast
A wrong lock key introduces cross-tenant false-sharing once F2 allows same-named projects.

### 7.8 Centralizing `apperr→HTTP` mapping is deferred per feature
It must preserve the existing `{error, code}` shape and the 404/409/400 mappings (project `openchoreoErrorStatus`, `credential_errors.go`) so console/agents snapshots don't break.

### 7.9 Retiring legacy routes (INT-1, INT-6) and the Service-JWT `aud` change (`svc-aud`) are breaking for older runner/consumer images
They live in dedicated consumer-coordinated PRs with transition windows and in-flight-pod drain — not bundled into a structural extraction. See §9.2.

### 7.10 Per-feature `Deps` must map every current `SetX` site (`main.go:596-782`, 29 setter sites)
A missed mapping silently disables a cascade hook (trait-sync, runtime-config emit, build dispatch) with no compile error. **Resolution:** make *mandatory* collaborators **required, non-pointer constructor params** (a missing wire is a compile error); for *optional* hooks, the wiring test must assert **behavior** (fire the hook, observe the provider ran), not field presence.

### 7.11 The ADR decision log (`docs/adr/0001–0006`) governs code already on `main` but was never committed
It lives only on an open upstream PR branch, so the canonical two-path decisions float free of the code they govern. Commit it as part of this restructure. Also resolve the contested **`application-secrets-read` vs `secretstore-read`** ClusterSecretStore guidance — a **3-vs-2 internal disagreement**: `dispatcher.go:76`, `externalsecret_template.go:45`, and `config/config.go:192` all assert **`application-secrets-read`**, while `dispatch_service.go:113` (comment) **and** `job_template_test.go:122` (fixture) assert **`secretstore-read`**. **Do not pre-judge which is correct** — **assert the value at startup against the live ESO `ClusterSecretStore` + AppRole policy** (fail-fast, per §6.11 "derive/validate, don't trust config"), then reconcile **all four code sites** to the asserted-correct value.

### 7.12 The agents-service control-plane key path (INT-1) — RESOLVED: BFF injects the key per request
`agents-service` is a long-lived control-plane service serving **all** orgs, so it cannot use the runner's per-org projected-Secret mechanism (one pod = one org). Today it **pulls** the key per request from the **unauthenticated** `effective-key` route (`api/app.go:247`; `agents/src/shared/anthropic-key-resolver.ts:114`) — the INT-1 hole.

**Resolution (decided):** the **BFF injects** the effective key into the per-request call it *already* makes to agents-service. The BFF holds the authorized `Caller` for the request's org (post-gate), resolves the effective key **in-process** via the `credentials` resolver, and passes it on the existing `X-Oc-Org-Id` call as `X-Anthropic-Key` (header; never logged; internal/mTLS hop). agents-service uses it inline (`createAnthropic({apiKey})`) and **no longer fetches** it.

This **unifies both planes under one principle** — *the secret trust root delivers the secret to a scope-authorized consumer; the consumer never pulls it by naming an org* — differing only in transport (runner = projected K8s Secret; agents-service = request injection). The standalone `effective-key` route is **deleted for both** (closing INT-1 completely), and there is **no** secret-returning HTTP route left to gate.

**Consequences for the developer:**
- **BFF:** `clients/agents` adds the resolved key to each `Stream*` call; the BFF resolves it via the in-process `credentials` effective-key resolver using the authorized `Caller`. No new endpoint, no token minting.
- **agents-service:** delete `anthropic-key-resolver.ts`'s HTTP fetch + the 5-min LRU + the `/v1/internal/cache/invalidate` route + `ASDLC_API_URL` key usage; read the injected key from the request context instead. The `none` case still surfaces `503 no_anthropic_key_configured`.
- **Supersedes** `docs/design/anthropic-key-dual-token.md` §3.3 / §6.4 (which chose an HTTP resolver for agents-service) — the runner mechanism (projected Secret) is unchanged. Add a pointer note to that doc.

Lands in the `svc-aud` phase (§9.2) alongside the runner's Secret-projection cutover.

### 7.13 Org-bootstrap posture: verify-only namespace vs "JIT-create"
The live `EnsureForOuHandle` (§6.1b, §4.1) is **verify-only at the namespace level** — it calls `NamespaceClient.GetNamespace` and returns `ErrOrganizationNotProvisioned` when absent; the **only** thing it get-or-creates is the local `organizations` side-car row. The OC namespace is created out-of-band (local: `setup-asdlc.sh`; cloud: `platform-api` on Thunder `notify_org_created`). `docs/design/default-org-seed-removal.md` §3.2 still describes the BFF **JIT-creating the org** with a reserved-handle deny list — stale relative to this behavior. **Resolution:** treat verify-namespace + ensure-local-row as canonical (encoded in §6.12 (b1)); reconcile the seed-removal doc's wording and the §6.1b comment ("get-or-create … JIT onboarding of a brand-new org's first request") so it is unambiguous that the *row* is JIT, the *namespace* is not. The genuine open item is the **cloud per-tenant namespace bootstrap trigger** (BFF→platform-api vs platform-api watch vs an Org/OU CR) — a Phase-1 prerequisite, surfaced by `[SHAKEOUT:ORG]`.

### 7.14 `ResolveOuHandle` claim shape across planes (the #1 shakeout target)
`ResolveOuHandle` (precedence `ouHandle>ouName>ouId`, `jwt.go:49`) is the single source of the org handle for the whole request, and the gate (§6.1b) 404s legitimate traffic if that precedence doesn't match how every caller (console, agents-service, runner) names orgs. **Unknown until run on both planes:** whether wso2cloud `platform-idp` populates `ouHandle` (a slug) or only `ouId` (a UUID). If only `ouId`, the resolved "handle" becomes a UUID and every OC URL, org-ensure lookup, and impersonation compare silently uses the wrong key. **Resolution:** answer it empirically with `[SHAKEOUT:CLAIMS]` (§6.13) against a real cloud token **before** flipping `TENANT_GATE_MODE` to `enforce`; align with `console/src/utils/orgClaims.ts`; keep the would-deny canary (§7.1) live until both planes agree.

---

## 8. Testability Model

**Reality check — distinguish patterns the repo *already has* from tiers that must be *built*.** **Already present (reuse):** consumer-defined interfaces + constructor injection; hand fakes with `var _ Iface = (*fake)(nil)` (`org_scope_test.go` style); pure table tests for the algebra (`task_state_test.go`, `artifact_versioning_test.go`); client-level `httptest`. **Does NOT exist yet — must be built (a `helpers`/`component`-phase deliverable, not an assumption):** there are **zero `//go:build dbtest` files, zero `repositories/*_test.go`, zero controller `http_test.go`**, no `sqlmock`/`testcontainers`, and `make test` is bare `go test ./...`. The DB-backed and HTTP-seam tiers that gate *every* tenancy/IDOR guarantee below are greenfield.

**8.0 Harness deliverables (build these first).**
- **`dbtest` harness (`helpers` phase).** Pick one: reuse the `deployments` Postgres on `:5433`, or `testcontainers-go`. Apply schema via `migrations.Run` against the test DB. Per-test isolation via transaction rollback or `POST /_test/reset`. New `make test-db` (`go test -tags dbtest ./...`) + a CI job. **Without this, "two-org store tests are the forcing function for F2" is unimplementable.**
- **Controller `http_test.go` template (`component` phase).** A copyable skeleton wiring `httptest.Server` → the typed `Router` (with the real gate) → a fake `Service`, so the first feature (component) ships the pattern every later feature copies. The `tenancytest` kit plugs into it.

Per-feature suite:

| Seam | Test | Fake strategy |
|---|---|---|
| HTTP ↔ Service | `http_test.go` over `httptest` + fake `Service` | hand fake; **tenancy gate asserted here** |
| Service ↔ sibling feature | `<name>_test.go` against `ports.go` fakes | hand fake of the consumer port (kills the downcast) |
| Service ↔ own store | service test fakes the store; `store_test.go` (`//go:build dbtest`) hits real Postgres | in-memory map fake + DB-backed index assertions |
| Service ↔ external client | narrow per-feature port fake | hand fake; `moq` for integration |
| Pure algebra | table tests, moved verbatim | none |

**Tenancy as a reusable test kit** (`internal/feature/shared/tenancytest`):
- `AssertCrossOrgDenied(t, h, method, path, jwtOrg, spy)` — drives a handler with a JWT for org A against a path naming org B, asserts **404** (no existence leak) and that the downstream fake was never invoked. Every feature's `http_test.go` runs it per org-scoped route — the regression lock for IDOR-1..5.
- **Two-org-same-slug store tests** seed `(orgA,"foo")` + `(orgB,"foo")` and assert a read scoped to A never returns B's row. This currently *can't insert* due to the global unique index — so the test doubles as the forcing function for the F2 composite-index migration.
- **Webhook cross-org test** connects `foo/bar` in org A and org B, fires an org-A-HMAC webhook for the `foo/bar` full_name, and asserts it never touches org B's task (resolve-scoped-by-org makes the cross-org row unreachable — INT-2).
- **Impersonation fail-closed test** extends `transport_test.go`: a user-JWT context where `ResolveOuHandle(claims) != namespace` must error, not resolve a victim UUID.
- **Collab access test (INT-8):** a forged/unsigned Bearer must be rejected (signature-verify), and a verified caller from org A must be denied collab validation against a room whose project is owned by org B.

Run any feature in isolation: `go test ./internal/feature/<name>/...` — no cluster, sub-second. Adapter/integration shape (HMAC, impersonation, retry) is tested only at the adapter layer; contract shapes (`ProgressEvent`, agents DTOs) are CI-gated in `contracts`. The projector + watcher re-home additionally gets a **real-cluster** integration test (per-org impersonation on sweeps is not exercisable under `dbtest`).

---

## 9. Incremental (Strangler) Migration

Invariants: one module, no import cycles; new code lands under `internal/`, the flat `services`/`controllers` keep compiling until their last file leaves; **move the test with the code in the same PR**; `AppParams` stays the DI contract and shrinks one feature at a time; one feature slice (or one shared extraction) per PR; fix each load-bearing tenancy defect *inside* the PR that extracts its owner; **abstractions are introduced only when the feature that needs them moves**.

The shared `*gorm.DB` is **not** split — migrations stay in `database/migrations`; each new feature store wraps the same handle and is the only place allowed to import `gorm`; the 27 gorm-importing files (16 with raw SQL) are strangled site-by-site as their feature migrates. **The `tenantdb` builder guard is enabled only in the final `cleanup` PR** — enabling it earlier would abort statements in not-yet-migrated `services/` files and break build-green.

Per-finding fixes are stated once in the **§6.7 canonical "Finding → Fix → Phase" table**. The "Closes" column names *which* findings a phase closes; **DoD** is the Definition of Done.

**Sequencing rationale:** `component`+trait-sync cannot be the first slice — `TraitSyncService` takes `*ArtifactStore` (`main.go:631`) and reads design via `store.ReadDesign`/`DesignFile` (the **artifacts** engine) which itself panic-casts to `*gitOpsService` (the **gitrepo** feature). So `component` transitively needs `gitrepo` **and** `artifacts`. Order (top-to-bottom): **gate → helpers → gitrepo → artifacts → component → credentials → state-machine → projector/webhook → task → codingagent → req/design → project/org/idp/skills → cleanup.**

**Phase-1 instrumentation gate (mandatory).** Every phase that touches the auth/org/platform identity path — `gate`, `gitrepo`, `credentials`, `idp`, `organization`, and the §6.10a two-path seams — MUST ship the §6.13 `[SHAKEOUT:*]` instrumentation, be exercised by the fresh scenario (§6.12) on **both** local k3d **and** wso2cloud, have its two log captures diffed and reconciled, and **remove the `[SHAKEOUT]` lines as the last commit before its DoD**. A phase run on only one plane is **not done**. This is the forcing function that surfaces the claim-shape / namespace / impersonation / secret-path divergences (§7.13, §7.14) before they reach the business-logic phases. It is additive to each phase's existing DoD below, not a separate phase.

| Phase (label) | PR(s) / scope | Closes | Definition of Done | Build-green note |
|---|---|---|---|---|
| **`gate`** | `platform/tenant` (pure) `Caller` + `registerOrgScoped` gate fn per org-scoped route; **log-only "would-deny" first, then enforce**; prefix-based CI allowlist (§6.1b); enumerate carve-outs (§6.6f); `{orgId}`/`{ocOrgId}`→`{orgHandle}`; **INT-4** `DeploymentTier==dev` assertion + dedicated dev-only flag; `httpkit.Write40x` + `ids`; `tenancytest` kit; resolver-adapter over `organizationService` | **IDOR-1..5, IDOR-2 var, TEN-A, INT-4 safety** | `tenancytest.AssertCrossOrgDenied` green for **every** gated route; CI prefix-allowlist check passing; **canary: zero "would-deny" log lines** against console + agents-service + runner traffic over a full E2E run before flipping `TENANT_GATE_MODE=log→enforce`; rollback = flip back to `log` | additive per-route wraps; old controllers untouched; NO apperr/uow/guard yet |
| **`helpers`** | move `wp_naming`, `codingagent/namespace`, `external_url`, `artifact_versioning`, mappers into `platform`/feature shared; **hoist `ToK8sName`** to `platform` first; hoist correlation header → `obs` (fixes httpx→middleware cycle); **build the `dbtest` harness + `http_test.go` template (§8.0)**; **publish the `models/` per-file destination table (§6.9)** | — | `make test-db` runs green in CI; `http_test.go` template compiles; httpx→middleware cycle gone (`go vet`/depguard clean) | zero-risk; tests follow |
| **`gitrepo`** | extract gitrepo + board; composite `(org_id,project_id)` index (audit SQL §6.7-F2 first); delete org-less `GetByProjectID`/`Delete`; re-key board to `/repos/{orgHandle}/{projectId}/board` + `BindServiceOrg`; **rewrite the INT-2 routing resolver `OrgIDByRepoFullName` as an exact host/owner/repo match on `RepoRepository`** (now owned here) | **F2, F3, F4, F7, IDOR-7, INT-2 routing leg** | two-org-same-slug store test (the F2 forcing function) green; board route 404s cross-org; collision-audit SQL returns 0 (or backfill plan executed) | moves *before* component; audit ships first |
| **`artifacts`** | extract the `ArtifactStore`/`ArtifactService` engine; **thread `orgID` end-to-end, resolve via `gitrepo.GetByOrgAndProjectID` (F1 core)**; relocate `conflict_retry` | **F1 (core re-tenant), F10** | artifact read/write scoped by `(org,project)`; F1 store test green; `*gitOpsService` panic-cast removed | depends on `gitrepo`; engine for req+design |
| **`component`** | extract `ConfigService` + `TraitSyncService` + `trait_sync_watcher`; establish the `store/ports/http` feature template. **Honest size:** not a clean 113-LOC unit — drags `TraitSyncService` (~488 LOC) + 3 tests + watcher + an **`idp.EnsureOrgPublisher` port** + design-read via **`contracts.DesignReader`/`artifacts`** (~1.4k LOC) | — | feature builds with **no import of `services`**; trait-sync reads design through `artifacts`/`contracts`, not a concrete `services` cast; per-route `AssertCrossOrgDenied` green | depends on `gitrepo`+`artifacts`; proves the template |
| **`credentials`** | extract; IDOR-2/3/4 path-org gate; `internal/credentials/*` AES store; rename `oc_org_id`→`org_id` + `ocOrgID` params; apperr adopted here at its moving controllers | **IDOR-2/3/4 + structural** | secret routes reject cross-org (`AssertCrossOrgDenied`); no secret route gated by `BindServiceOrg` alone; apperr `{error,code}` body byte-identical to old (snapshot test) | best-encapsulated data; `gitrepo` already moved so INT-2 resolver call-site exists |
| **`svc-aud`** *(partly consumer-coordinated)* | distinct Service-JWT `aud` (token issuance + every verifier; transition window accepts old+new); **INT-1 dual-transport:** runner → SSA Secret into `workflows-<org>`; agents-service → **BFF-injected key** (§7.12, same-PR with `clients/agents`); delete the `effective-key` route — **see §9.2** | **INT-1, INT-3** | agents-service+BFF key-injection ships atomically (route gone, no window); runner Secret-projection cutover + `aud` change use transition windows; old route 404 only after the runner cuts over | `aud` + runner legs NOT atomic; agents-service leg IS atomic |
| **`state-machine`** | hoist pure `task_state.go` to `contracts`; **relocate `TaskStatus`/`TaskEvent` per the §6.9 cycle resolution** (canonical def in `contracts`, `ComponentTask.Status` → `contracts.TaskStatus`, update ~14 consumers — **not "zero-risk," ~14+ files**); add hook *types* `TaskTransitions`/`BuildDispatcher`/`DesignChanged`; thin re-export shim for not-yet-moved consumers, deleted at `task` | **projector upward-import precondition** | `errors.Is` holds across the shim; all `models.TaskStatus` consumers compile; `contracts` depguard (stdlib+models-values only) passes | qualified zero-risk: pure algebra, but blast radius is ~14+ files |
| **`projector+webhook`** | move projector (sole `Status` writer, under locks) + inbound pipeline; thread HMAC org via `Router.Dispatch`; resolve-scoped-by-org (INT-2 **sink** `handlers.go:339-344`); `(org,repo)` unique (audit first); `webhook_payloads` org_id; route `JobWatcher.markFailed` through `contracts.TaskTransitions`; **4 watchers stay in place importing the new contract** | **INT-2 (sink), F-WP; markFailed bypass** | webhook cross-org test green (org-A HMAC never touches org-B task); real-cluster integration test passes | watchers untouched → order intact |
| **`task`** | extract `TaskService`/repo/controllers + **re-home the projector**; `GetByIDScoped`; rewrite raw `loadBaselineBatch` as org-typed repo method; **delete the `state-machine` re-export shim** | **F6, F2t–F5t, F8** | by-UUID task routes 404 cross-org; `loadBaselineBatch` is a builder/repo method (forbidigo-clean) | sole `ComponentTask.Status` owner now homed |
| **`codingagent`** | extract `services/codingagent/*`; **move `WorkflowRunService` (build dispatch) in from `services`** — *this creates the `task→codingagent` edge*; wire `contracts.BuildDispatcher` (task emits, codingagent provides) **and** route `MarkBuilding/MarkBuilt/MarkFailed` through `contracts.TaskTransitions` (the **back-edge**); `RunnerAuthMode` replaces the `isGatewayPlatformURL` sniff | **the task↔codingagent cycle (both directions)** | depguard: codingagent imports no `internal/feature/task`, task imports no codingagent; build still dispatches + writes status via contracts only | the cycle conversion — both hooks must land here |
| **`watchers`** | evacuate `build_watcher`/`coding_agent_watcher`/`on_hold_watcher` to their owners; namespace from `scope.ThunderUUID` (INT-7); **IDOR-6 impersonation fail-close** (`SourceServiceIdentity` carve-out wired *first*, §7.5); `SweepAllOrgs` per-org | **INT-7, IDOR-6** | watchers run per-org via `SweepAllOrgs`; impersonation fail-closed test green; no global DB handle held | carve-out before fail-close (§7.5) |
| **`req+design`** | extract `requirements`+chat+collab and `design`; **fix collab INT-8 (signature-verify + project-scoped check via §6.6g oracle)**; `ProjectLockKey` (F5); design emits `contracts.DesignChanged` | **F5, INT-8** | collab access test green (forged Bearer rejected; org-A denied org-B's room); design→task only via `contracts` | depends on `artifacts` (already moved) |
| **`project+org+idp+skills`** | extract; `SkillRepository`; `design_version_skill_snapshots` org_id (**drop-and-rematerialize + backfill loop**); IDOR-7 status scoping | **F9** | F9 snapshots rematerialized for all current design versions (no idle-project gap); `task_stream` degrades, not errors, on missing baseline; `organization` re-homed | organization moves last (depended via `platform/tenant`, not the feature) |
| **`cleanup`** | delete empty `services`/`controllers`; collapse `AppParams` → per-feature `Deps` (mandatory deps = required ctor params); retire `/credentials/refresh` (→ Secret projection, §9.2); org-scope `_test/reset` delete; INT-5 admin token; **enable the `tenantdb` builder guard + `forbidigo` raw-SQL/allow_global bans LAST** | **INT-4 (delete), INT-5, INT-6; guard live** | guard live with zero aborts in E2E; no `services`/`controllers` packages remain; drain in-flight pods (`imagePullPolicy: Always`) | guard last so not-yet-migrated files don't abort |

### 9.1 Migration safety (live managed-RDS schema changes)

The runner is **forward-only** (`RunPhaseN` functions; no down-migrations). Every live-table change (F2 `(org,project)` unique, INT-2 `(org,repo)` unique, F9 `design_version_skill_snapshots` org_id, F-WP `webhook_payloads` org_id, the `oc_org_id`→`org_id` renames) must follow the **expand→backfill→verify→contract** ordering and state its recovery:
- **Ordering:** add the new column/index **nullable / non-unique** → backfill → **verify** (audit SQL returns 0 anomalies) → add `NOT NULL` / `UNIQUE` in a later step. Never add a `NOT NULL`+`UNIQUE` column in one shot on a populated table.
- **Audit SQL per affected table** (run and attach to the PR): `SELECT <key>, count(DISTINCT org_id) c FROM <table> GROUP BY <key> HAVING c > 1;` — for F2/INT-2 the surprising result is **0** on `git_repositories` (the existing *global* unique already forbids dupes); the real collision risk is the other `project_id`-keyed tables, so audit `component_tasks`/`component_configs`/`design_version_skill_snapshots` too before relying on `(org,project)` uniqueness.
- **F9 specifically:** drop-and-rematerialize leaves a **skill-baseline gap** for any task in `building`/`deployed` between the `task` and `project+org+idp+skills` phases. Ship a **one-shot backfill loop** that re-derives snapshots for all current design versions at migration time (do **not** rely on the next organic design save, which may never come for idle projects), and confirm `task_stream`'s diff **degrades** (returns `ErrSnapshotMissing` gracefully) rather than erroring.
- **Recovery:** forward-only ⇒ recovery for a bad backfill is **RDS snapshot restore + corrected re-run**; state this explicitly per PR. The rename steps (`oc_org_id`→`org_id`) use a **transitional view or dual-read** if any external consumer reads the column name directly (verify none do first).

### 9.2 Cross-service contract migration (the external consumers)

`svc-aud`, `INT-1`, and `INT-6` change contracts that **two live external consumers** depend on. Most are **not** internal refactors and must be sequenced **server-dual-serves → consumer-cuts-over → server-removes** — the exception is the agents-service Anthropic-key path, where the BFF and agents-service ship together over one internal hop (§7.12), so no dual-serve window is needed:

| Consumer | What it is | Current dependency | Replacement | Cutover order |
|---|---|---|---|---|
| **agents-service** | long-lived compose/CP service (NOT a WorkflowPlane pod) | `GET /internal/.../anthropic/effective-key` (INT-1) | **BFF injects the key per request** (`X-Anthropic-Key` on the existing `Stream*` call, resolved in-process from the authorized `Caller`). agents-service stops fetching; the route is deleted. | BFF injects in the same PR that adds key-resolution to `clients/agents`; agents-service drops its resolver in lockstep (both ship together — single internal hop, no dual-serve window needed) |
| **agents-service / consumers** | verify Service JWT | shared `aud` with user tokens | distinct Service `aud` (INT-3) | server accepts old+new `aud` during window → consumers update verifier → server drops old |
| **remote-worker (runner)** | one-shot WorkflowPlane pod | `POST /internal/v1/credentials/refresh` (Task JWT) + `effective-key` | SSA Secret projected into `workflows-<org>`; runner reads the mounted Secret, no HTTP credential call | new runner image reads Secret → drain old pods (`imagePullPolicy: Always`) → server retires route |

**Deliverable:** before any consumer-coordinated phase ships, enumerate which credential each consumer carries and confirm the dual-serve window in a written rollout note. Only the `aud` change and the runner Secret-projection cutover need transition windows; the agents-service effective-key path ships atomically.

### 9.3 git-service decommission checklist

The restructure absorbs the standalone git-service into the BFF (`gitrepo`). The deployed Service and its env wiring must be retired explicitly — this is platform-touching and gets its **own** consumer-coordinated PR, not buried in the `gitrepo` extraction:
- remove the `app-factory-git-service` dependency + `GIT_SERVICE_BASE_URL`/`AGENT_GIT_SERVICE_URL` bindings from `workload.yaml` and `deployments/docker-compose.yml`;
- delete/retire the OpenChoreo Component for git-service;
- reconcile `BFF_TASK_TOKEN_AUDIENCE='git-service'` and `SERVICE_AUTH_GIT_*` env — decide whether they stay (renamed) for the folded surface or are removed;
- confirm no runner/agents image still resolves a `*_SERVICE_URL` to the standalone Service (the `depguard`/grep ban on parallel `*_SERVICE_URL` vars, §6.11, enforces this going forward);
- collapse runner reach-back to the single `AGENT_PLATFORM_URL` (value differs per env, presence does not).

---

## 10. Handoff Checklist

**Before starting — confirm these traps are understood:**
1. The tenant key is the **handle** on every table; `oc_org_id`/`ocOrgID` is a **misnomer**, not a UUID (§6.5). Do not introduce a UUID-typed table key.
2. The `task↔codingagent` relationship is **bidirectional**; both the build trigger *and* the `MarkBuilding` status write-back route through `contracts` hooks (§4 cycle proof). `codingagent.DispatchTaskBuild` does **not** exist today — it's `services.WorkflowRunService` moved in at the `codingagent` phase.
3. `OnTaskDeployed` (post-deploy cascade) and `BuildDispatcher` (merge-time build) are **different hooks**; `SetDispatchHook` is the precedent only for the first.
4. The gate's CI invariant is **prefix-based** (`/api/v1/organizations`, `/internal/credentials`, `/repos`), not keyed on the `{orgHandle}` literal.
5. The `dbtest`/`http_test.go` tiers **do not exist** — build them in `helpers`/`component` before relying on them (§8.0).
6. **Phase-1 (auth/org/platform) is verified on BOTH planes before any business-logic phase.** The fresh scenario (§6.12) must run end-to-end on local k3d **and** wso2cloud with the §6.13 `[SHAKEOUT:*]` instrumentation reconciled and then removed; a phase run on one plane only is not done (§6.13, §7.13, §7.14). Emit shakeout logs at `Info` (cloud may not run `Debug`) and never log a secret value.

**Per-blocker acceptance (each must be demonstrably true at its phase's DoD):**

| Blocker | Acceptance test |
|---|---|
| cycle | `depguard` green: no `codingagent`↔`task` concrete import either direction; build dispatch + status write both observably flow through `contracts` |
| gate prefix | CI fails if any route under the three prefixes is registered outside the typed `Router`; `AssertCrossOrgDenied` green for `{orgId}`/`{ocOrgId}`/`{projectId}`-derived routes after rename |
| identifier | a two-org-same-handle store test passes with `tenant.OrgHandle`-typed signatures; grep finds no UUID written to a tenant column |
| sequence | `component` builds with zero `services` imports because `gitrepo`+`artifacts` already moved |
| DoD | every §9 phase has a green DoD before the next starts |
| harness | `make test-db` runs in CI; the F2 two-org store test exists and is green |
| phase-1 dual-plane | the §6.12 fresh scenario is green on local k3d **and** wso2cloud; both `[SHAKEOUT]` captures diffed + reconciled; `grep -r '\[SHAKEOUT' asdlc-service` returns zero at DoD; would-deny canary (§7.1) zero |

**Definition of done for the whole restructure:** no `services/`/`controllers/` packages remain; the `tenantdb` guard + `forbidigo` bans are live with zero aborts under the full E2E suite; the standalone git-service is decommissioned (§9.3); ADRs 0001–0006 committed under `docs/adr/`; the unauth `effective-key` route is deleted with the BFF injecting the key to agents-service (§7.12); and `tenancytest.AssertCrossOrgDenied` is green for every gated route — the structural regression lock that keeps the IDOR class closed.

---

## 11. Implementation Status & Deviations (live log — local only, pre-wso2cloud)

Tracks what has actually been built vs. the plan above, so deferred/deviated items are not lost. The seam-fix + extraction work is committed to the **feature branch `modularization/feature-extraction`** (off `refac`) as `[LOCAL-ONLY · DO-NOT-MERGE]` checkpoints — **nothing is merged to `refac`/`main`** (per the rule: no merge until verified on wso2cloud — currently down). All changes are build-green (`go build/vet ./...`, `go test ./...`, `go test -tags dbtest ./...`) and verified on **local k3d only**; the §6.13 dual-plane reconciliation and §10 "done = green on both planes" gate are **outstanding** for every item.

### RESUME CHECKPOINT (read this first — updated 2026-06-20)

This block is the authoritative handoff: a fresh/compacted session should rely on it + the memory file `asdlc-modularization-phase1.md` (no need for separate hand-off notes). Detail for each item is in the "Done" / "Deviations" subsections below.

- **Where:** branch `modularization/feature-extraction` off `refac` (`refac` is the real working branch, ~138 ahead of `main`; this doc under `docs/design/` is **gitignored** — on-disk only, edited directly). ~20 commits this session, all `[LOCAL-ONLY · DO-NOT-MERGE]`.
- **EXTRACTED to `internal/feature/`:** `gitrepo`, `artifacts`, `component`, `orgcreds` (credentials services/controllers), `task` (projector + handlers + board + TaskService + stream/diff/design/skills + errors), `codingagent` (dispatch + build dispatch + progress + the 3 watchers + JobWatcher/Dispatcher), `requirements` (RequirementsService + chat + dir-locker + collab, INT-8 closed), `design` (DesignService + AssembleDesignFromFiles + ocEntrypoint). Plus `internal/contracts` (pure-leaf task state machine + `TaskTransitions` hook) and the `wc-` namespace helpers in `internal/platform/tenant`. Plus a `/simplify` dedup pass. `internal/credentials` (AES store/Resolver) stays as foundation; `RepoRepository`/`ConfigRepository`/`TaskRepository` stay in `repositories`; gorm models + shared DTOs (`GitRepository`, `ComponentConfig`, `Skill`, `api_security` predicates, `models/{spec,design,tasks}.go`) stay in `models`.
- **REMAINING:** `cleanup` is **largely DONE** (CL-1..CL-6 — see Done; the flat `services` **and** `controllers` packages are **both gone** — `task_controller` moved into `internal/feature/task` behind consumer ports (CL-6), auth/jwks→`platform/auth`, webhook→`internal/feature/webhook`, import boundaries locked by `internal/arch/arch_test.go`). The **deferred cleanup tail** (all either cloud-/migration-coupled or polish): **F9** (`design_version_skill_snapshots` org_id + rematerialize) + **SkillRepository**; the F-WP `webhook_payloads` org_id + `Router.Dispatch` org-threading; the `.golangci.yml` depguard/forbidigo ruleset (CI parity with arch_test) + the runtime `tenantdb` builder guard; `AppParams`→per-feature `Deps`; INT-5 admin token; and the §9.2 consumer-coordinated `/credentials/refresh` retire. **The original cleanup-phase intent** — enable the `tenantdb` builder guard + `forbidigo` raw-SQL + `depguard` rules **LAST**; collapse `AppParams`→per-feature `Deps`; relocate the remaining flat-package residue into its homes: the **auth/platform** layer (`task_token_manager`, `publisher_token_verifier`, `jwks_controller` → `platform/auth`), the **webhook ingestion** edge (`services/webhook/*` + `webhook_controller` → `internal/feature/webhook`, with the F-WP `webhook_payloads` org_id migration + `Router.Dispatch` org-threading), `task_controller` → `internal/feature/task`, `external_url.go` → `runtimeconfig` (§4.12), `api_security_test.go` → models; reconcile the duplicated `ocEntrypoint` (design↔codingagent) + the per-feature `requireOrgHandle`/`requireProjectName`/`ErrUnauthorized`/`translateHTTPError` copies; **F9** (`design_version_skill_snapshots` org_id + rematerialize — a live migration touching task's snapshot readers) + the **SkillRepository** raw-gorm wrap (both deferred from the skills slice). The `task↔codingagent` cycle is already broken both ways (see Done).
- **Working PATTERN (use this):** survey coupling → decouple inward edges via consumer ports **in place** (commit) → `git mv` + repoint **build-green** (commit) → rebuild the `asdlc-api` compose container + smoke. Mechanical moves can be delegated to a subagent with a 4-gate build-green requirement — but ALWAYS verify independently after (gates + the `go list -deps` cycle invariant: a feature must import **no** flat `services`/`controllers`/`webhook` package).
- **GREEN SIGNAL:** `go build/vet ./...` + `go test ./...` + `go test -tags dbtest ./...` (needs Postgres on `:5433`). **`make test` is PRE-EXISTING red** on `check-no-legacy-creds` — use `go test`, not `make test`.
- **GOTCHAS:** (1) the saved user JWT `/tmp/asdlc-usertok.txt` **expires** — authenticated HTTP smokes need a fresh playwright browser login. (2) the **smee webhook relay is flaky/down** → the webhook-driven task lifecycle (dispatch→PR→merge→build→deploy) is NOT E2E-testable; the spec-authoring flow IS. (3) after a code change, **rebuild the `asdlc-api` container** (`cd deployments && docker compose up -d --build asdlc-api`) before smoking — it lags HEAD otherwise. (4) before any k3d-touching op, run the `docs/operations/cluster-health.md` check in an **isolated subagent** (per CLAUDE.md). (5) env bring-up = `deployments/scripts/{teardown,setup,start}.sh`; 7 compose services; console `:8090` (admin/admin), api `:9090`.
- **CONSTRAINTS:** `TENANT_GATE_MODE` defaults `enforce`; no merge to `refac`/`main` until wso2cloud-verified; doc-faithful + both-plane-correct only; **document every deviation here in §11**.
- **Cloud-blocked (don't attempt until wso2cloud is up):** the §6.13 `[SHAKEOUT]` dual-plane diff/reconcile/log-removal loop, the gate-mode claim-shape canary, INT-1 (delete unauth `effective-key`) + INT-3 (distinct Service `aud`) + the `oc_org_id`→`org_id` column rename (§9.2 consumer-coordinated / live-cred-table migration).

- **Post-audit hardening + doc corrections (2026-06-21).** A full multi-agent re-validation of this §11 against HEAD confirmed the extraction is faithful and build/vet/test/dbtest/arch are green, and surfaced one residual security gap + several doc inaccuracies, all now fixed in code:
  - **F2t–F5t was incomplete — closed.** Two operator progress routes (`GetTaskAgentProgress`, `GetTaskBuildProgress`) were registered `OrgScoped` but loaded the task by **bare UUID** (`progressSvc`→`taskSvc.GetTask`), with `task.OrgID` used only to derive the log namespace — never compared to the path org. Since the `OrgScoped` gate only matches path-org↔JWT-org (not task ownership), a caller could read another org's coding-agent/build progress by passing that org's `taskId` under their own org path. **Fix:** both handlers now pre-check via `GetTaskScoped(orgHandle, taskId)` (helper `assertTaskInOrg`) → 404 cross-org, mirroring the 5 sibling handlers. New regression test `controllers/task_controller_progress_test.go` (cross-org→404 + progress service never invoked; same-org→200).
  - **CA-3/RD-1 latent-wiring class closed structurally.** Every optional-setter the composition root wired via anonymous `interface{ SetX(...) }` type-assertion now has a **named interface + `var _ NamedIface = (*impl)(nil)` compile-time guard** (design `DesignServiceWith{TaskHook,TraitSync,Skills}`; codingagent `DispatchServiceWith{TraitSync,IDP,RuntimeConfig,CodingAgent}` + `ProgressServiceWithLogSource`; task `TaskServiceWithSkills`; requirements `RequirementsServiceWithLocker`; controllers `{SkillsService,PublisherVerifier,CredentialsRefresh}Setter`), and `main.go` was repointed to the named interfaces. A setter-signature drift is now a build failure, not a wire silently skipped at boot.
  - **Dead code + hacks removed.** Deleted the legacy git-CLI commit/tag cluster in artifacts (`runCommit`/`isNothingToCommit`/`createAndPushTag`/`treesEqualAtPath`/`pushAllTags`/`runGitWithEnv`/`identityT`/`blobSHAOnMain` — the save path is GitHub-API via `save_via_api.go`), unused exported `artifact_store.ComponentDesignPath`/`ComponentOpenAPIPath`, `task.topoSortComponents`, exported-unused `orgcreds.NoopAgentsCacheInvalidator`, the dead `controllers` copies of `requireComponentName`/`validateSlugParam`; removed the two `var _ = io.EOF` / `var _ = strconv.Itoa`/`errors.Is` import-suppression hacks; repointed stale `services.*` comments to current package names.
  - **Doc corrections (the prose elsewhere in this file is aspirational where it diverges from code):**
    - **`contracts.BuildDispatcher` does NOT exist.** The merge-time build trigger flows through a **task-local** `BuildDispatcher` port (`internal/feature/task/handlers.go`) satisfied by `codingagent.WorkflowRunService` and wired at the composition root. The cycle is genuinely broken either way (task imports no codingagent, arch-locked). References to `contracts.BuildDispatcher` in §4/§6.11 are the intended-but-not-landed shape; the back-edge `contracts.TaskTransitions` IS real.
    - ~~**`ProgressEvent` lives in `clients/observer`, not `contracts`**~~ — **RESOLVED (CL-6, 2026-06-21).** It was hoisted **into `contracts` itself**, *not* `models`: the original "contracts may import only models" framing was wrong — `models` already re-exports the task-state algebra FROM `contracts` (`models.TaskStatus = contracts.TaskStatus`), so `contracts→models` is a cycle. As a pure scalar value type `ProgressEvent` belongs on the leaf directly (keeping `contracts` stdlib-only); `clients/observer` keeps its `ParseProgressLine` wire-parser and a `type ProgressEvent = contracts.ProgressEvent` alias. `DispatchResult`/`ProgressResponse`/`ErrProgressUnavailable` were hoisted alongside it, which unblocked the `task_controller` move.
    - **`design.ocEntrypoint` was dead** (zero callers) and is now **deleted**; `codingagent.ocEntrypoint` is the only copy (corrects the req+design-phase note below that called design's the canonical copy).
    - **"projector is the sole `Status` writer"** is scoped to the **webhook lifecycle**; dispatch/generation/reconciliation also persist `Status` (all org+project-scoped via `taskRepo.Update`; build-status writes route through `contracts.TaskTransitions`).
  - **Still pending besides cloud (unchanged by this pass):** F9 (`design_version_skill_snapshots` org_id + rematerialize) + SkillRepository; F-WP (`webhook_payloads` org_id, defense-in-depth); `.golangci.yml` depguard/forbidigo + `tenantdb` builder guard; `AppParams`→per-feature `Deps`; INT-5 admin token; F5 org-qualified repo-lock key; broader validation.go/apperr dedup; ADRs 0001–0006 under `docs/adr/`. `tenant.Scope`/`MustOrg` are retained as the documented seam though the gate currently inlines the check. (`task_controller`→feature move + `controllers/validation.go` delete: **DONE** in CL-6, see below.)

- **Second multi-agent re-validation + fixes (2026-06-21, round 2).** A fresh 15-agent doc-vs-code audit (7 dimensions, each adversarially re-verified against source; build/vet/test/dbtest/arch all confirmed green with PG:5433 up) found §11 faithful to HEAD with **one untracked open security finding** and a handful of doc-stale items. All fixed/now-tracked in this pass:
  - **INT-4 closed (was an untracked open H).** `POST /api/v1/_test/reset` was gated *only* on `TestMode` — which `config.go` itself notes is set on the wso2cloud dev release binding — and its handler ran an unscoped global `Where(1=1)` truncate of `component_tasks` + `component_configs` (`TaskRepo`/`ConfigRepo.DeleteAll`). The `DeploymentTier==dev` assertion from §6.7 had never landed, and §11 listed INT-4 nowhere (not Done, not pending, not cloud-blocked) while §3 still carried it open. **Fix:** registration now requires `TestMode && DeploymentTier=="dev"` (mirrors the destructive-migration gate in `RunPhase0`/`RunPhase2PRA`), plus an in-handler `DeploymentTier!="dev"`→403 fail-fast (defense-in-depth). The local harness is unaffected (`DEPLOYMENT_TIER` defaults to `dev` in compose; `tests/helpers/db-reset.ts` calls reset with no org). **The org-scoped delete remains the doc's cleanup-phase leg** — the harness resets unauthenticated with no org, so org-scoping needs a harness change and stays deferred.
  - **Dead code removed (completes the L930 list + the §3 F6 staleness).** `blobSHAOnMain` (`artifacts/save_via_api.go`, named in the L930 deletion list but never actually removed) and `TaskRepository.GetByIssueURL` (interface decl + impl, zero callers — the §3 F6 prose implied it was still a live non-org-keyed reader) both deleted. `deadcode`/grep confirm zero callers; build green.
  - **Doc-stale corrections (genuine deviations from the §4–§10 target, previously untracked in §11; recorded here, deferred — the cycle stays intact + arch-locked throughout):**
    - **`middleware/jwt` + `middleware/jwtassertion` were NOT moved to `platform/auth`.** §4.0/§5 target `platform/auth` owning the jwtassertion verify engine + `jwt.Middleware` claim projection; in reality only `task_token_manager`/`publisher_token_verifier`/`jwks_controller` moved (CL-1/CL-4a), and `orgensure` was decoupled (PO-1) but not dissolved into `platform/tenant`. Re-home with the auth-layer cleanup tail.
    - **No `clients/openchoreo/occlient` subpackage and zero feature `adapters/` dirs.** The §6.8 single-consumer client relocations (`oidc`→idp, `k8s`→credentials, `observer`→codingagent, `database`→task) and the `gen/occlient` split never happened (everything is flat under `clients/`). The multi-consumer OC client correctly stays under `clients/` per §5 line 327; only the internal boundary is uncreated. Low priority.
    - **`token.Source` (§6.8) not reconciled** — 5 provider shapes coexist (`oauth.TokenProvider`, `openchoreo.AuthProvider`, `clustergatewayproxy.AuthProvider`, `clients/auth.AuthProvider`, `credentials.Credential`). Rides with the §6.10a `DeploymentEnv`/cloud work.
    - **Of the §4.0 contracts hooks, only `TaskTransitions` actually lives in `contracts`.** `TraitSync`/`DesignChanged` route through feature-local ports (acknowledged in deviation 1(h)); `OnTaskDeployed` routes through task's `DispatchHook` port + `codingagent.DispatchCascadeHook`; `DesignReader` never materialized (task reads design via `artifacts.ResolveDesignComponent`). §4/§6.11 prose listing these as `contracts` hooks is aspirational (extends the BuildDispatcher/ProgressEvent corrections above). The `state-machine` "Done" entry's "hook interface stubs … DesignChanged" line is itself stale — only `TaskTransitions` survives in `contracts`.
    - **`platform/ids` is a thin delegating wrapper over `utils/validate`** (the canonical impl, 8 consumers), not the rename §5 line 301 implies; `platform/ids` has one consumer (`platform/tenant/gate.go`).
    - **Stale line refs in the aspirational prose:** §6.13 `:CLAIMS` table row points at `middleware/jwt/jwt.go·ResolveOuHandle`, but the live `[SHAKEOUT:CLAIMS]` line is at `platform/tenant/gate.go:86` (which *calls* `ResolveOuHandle`); §6.10 cites `dispatch_service.go:665` for `isGatewayPlatformURL` where the live fail-branch is `:633` and the impl `:751`.
  - **Newly-surfaced deferred items added to the pending list (besides cloud):** the `middleware/jwt`+`jwtassertion`→`platform/auth` move (+ `orgensure`→`platform/tenant`); the `clients/openchoreo/occlient` split + single-consumer `adapters/` relocations; the `token.Source` reconciliation. Build/vet/test/dbtest/arch remain green after this pass.

- **Full authoring E2E PASSED at HEAD `47cc8b5` (2026-06-20, playwright-cli).** Rebuilt `asdlc-api` to HEAD (clean boot — all watchers up), cluster-health pre-flight green, fresh admin login. Drove the clean flow end-to-end through the extracted features, gate in **enforce** mode throughout (same-org allowed, no would-deny): create project `extract-e2e-620` → real GitHub repo `asdlc-repos/extract-e2e-620966` created + cloned (**gitrepo**) → requirements generated via agent chat, per-org Anthropic key `source=org` (**artifacts**: snapshot/baseline/tool-result writes), published + tagged **`v1`** (commit `64b0f96`, 4 files) → design generated via Architect, 1 component, `[SHAKEOUT:OCAUTH] forward-user-jwt` (**component**→OC), published + tagged **`v1-1`** (commit `3d28b21`) → tasks generated → ComponentTask + **GitHub issue #1** + board item, `[SHAKEOUT:OCAUTH] service-identity` on status poll (**task** TaskService) → board renders the card in **To Do** (**task** board). **0 BFF ERROR logs**; the only WARN (`trait_sync … Component not found`, backoff-pause) is expected since the coding-agent lifecycle was intentionally NOT dispatched (smee relay down → PR→merge→build→deploy not E2E-able; spend avoided). Seams captured local-plane values (CLAIMS=jwks-verified, OCAUTH=forward-user-jwt + service-identity, ORG=ensured). This confirms the gitrepo/artifacts/component/orgcreds/task extraction serves the whole authoring path correctly at HEAD.
- **FULL coding-agent lifecycle E2E PASSED at HEAD `6d3c7cd` (2026-06-20, playwright-cli).** The complete platform flow (not just authoring), with the **webhook relay live** (smee `z6DbbDto0LVN0Ej4` connected + forwarding `POST /webhooks/github 200`), gate in **enforce**. Project `hello-world-api` → repo `asdlc-repos/hello-world-api862` cloned → requirements (hello-world API, `source=org`) published **v1** → design published **v1-1** → tasks → GitHub issue #1 → **dispatched to the remote worker via the proxy path** (`cluster-gateway-proxy POST …/namespaces/wc-019edf5e-…-remote-worker/jobs 201`; publisher-cc path active) → one-shot runner pod `Running` (image pulled, 4 skills, `agent_started`) → **logs streamed in the UI** (Live progress: workspace_ready → agent_started → Skill asdlc) → agent implemented + opened **PR #2** (`Closes #1`, branch `feature/hello-api-service`) → webhook `pull_request opened` → task **ready_for_review** (DB-confirmed; task projector/handlers) → operator **merged PR #2** → webhook `pull_request closed merged=true` → task **building** + build dispatched (`last_build_sha`=merge SHA; **codingagent `WorkflowRunService` via task's `BuildDispatcher` port** [not a `contracts` hook — see Post-audit corrections], `MarkBuilding` via `contracts.TaskTransitions`) → build watcher (evacuated to codingagent) polled the WorkflowRun → task **deployed** (cause `build.deployed`) → board card in **Done**. **Deploy verified real:** pod `hello-world-api-hello-api-…` `1/1 Running` in `dp-default-hello-world-a-development-…`, ReleaseBinding `Ready`/`ResourcesReady`/`ReleaseSynced` all True, external HTTPRoute provisioned, and `GET /hello` returns `{"message":"Hello, World!"}`. **0 BFF ERROR logs** across the ~35-min run; **no bugs found** (first-pass green). This exercises EVERY extracted feature end-to-end incl. the webhook-driven transitions and the task↔codingagent contract hooks in both directions — proving the extraction through `req+design` is behavior-preserving for the complete lifecycle, not just authoring.

### Done (in-place, build-green, local-verified)
- **`gate` (§6.1):** `internal/platform/tenant` (`Caller`/`Source`/`OrgHandle`, `Scope`/`MustOrg`, `BindUserOrg` per-route gate), `internal/platform/{httpkit,ids}`, `api.Router` (`OrgScoped`/`HandleOrgScoped`/`Public`). All apiMux org-scoped routes gated; carve-outs via `Public`; idp `{orgId}`→`{orgHandle}` renamed. `[SHAKEOUT:CLAIMS]` (gate) + `[SHAKEOUT:ORG]` (orgensure) + `[SHAKEOUT:would-deny]`. `tenancytest.AssertCrossOrgDenied` + `gate_test.go`. Closes IDOR-1..5 live (enforce: cross-org→404, same-org→200).
- **`helpers` (partial):** `internal/platform/dbtest` (`//go:build dbtest`, reuses :5433 PG) + `make test-db` + proving tests; `api/tenancy_http_test.go` controller http_test template.
- **`gitrepo` (§4.4, fixes only):** `orgID` threaded through repo/git_ops/artifact/issue/branch/pull_request/board services + controllers + BFF callers; org-less `GetByProjectID`/`Delete` deleted (compile-time forcing function); **F2** composite `(org_id,project_id)` unique migration (`RunGitRepoCompositeUnique`, verified live); board **F3** re-key `/repos/{orgId}/{projectId}/board` + `RequireOrgScope`; **INT-2 fully closed** (routing leg `OrgIDByRepoFullName` + sink `lookupProjectByRepo`, both exact `repo_url =` match). dbtest two-org-same-slug green. Closes F1(core),F2,F3,F4,F7,IDOR-7,INT-2.
- **`gate` STRUCTURAL completion:** the Service-JWT/Task-JWT routes now bind a `tenant.Caller` and register through typed routers. `RequireOrgScope`/`RequireTaskBearer` augmented to bind `Caller{SourceServiceJWT/SourceTaskJWT}` (additive, behavior-preserving); `middleware.BindServiceOrgScope` (org-only) added; `api.ServiceRouter` (`RepoScoped`/`OrgScoped`/`Public`) wraps gsMux; `/repos` + `/internal/credentials` + board re-routed through it. **CI allowlist lock** `api/gate_invariant_test.go` fails the build if any `*_routes.go` registers a `/api/v1/organizations`|`/internal/credentials`|`/repos` pattern raw (one allowlisted exception: the intentional unauth `effective-key`, INT-1-pending). Live-verified: boot ok, same-org 200 / cross-org 404, create+requirements intact.
- **`credentials` (local parts):** `{ocOrgId}`→`{orgHandle}` route rename; `/internal/credentials/orgs/{orgHandle}/*` now `OrgScoped` (Caller-bound) via ServiceRouter.
- **Feature extraction STARTED — `gitrepo` + `artifacts` + `component` + `credentials` extracted (2026-06-20).** On branch `modularization/feature-extraction` (off `refac`). Committed slices: **(A)** decouple artifacts↔gitrepo behind a `GitWorkspace` consumer port (relocate the misplaced `*gitOpsService` methods, add exported accessors, drop the `NewArtifactService` panic-cast, export cross-feature `BuildIssueBody`/`IssueTitle`/`NormalizeOpenAPIYAML`); **(B)** move the gitrepo feature (19 files) → `internal/feature/gitrepo` (package `gitrepo`), split gitrepo error sentinels into `gitrepo/errors.go`; **(C)** move the artifacts feature (11 files incl. `external_api_catalog.go`) → `internal/feature/artifacts` (package `artifacts`); **(D1)** decouple component's inward edges in place — hoist `ResolveAPISecurity*` to `models`, replace `services.IDPService` with a narrow `OrgPublisher` port, replace `*BuildCredentialsService` with a `BuildSecretStager` port (+ a composition-root adapter mapping `*StageResult`→secretRef string), call `k8sname.ToK8sName` directly, drop the dead `taskService` from component_controller; **(D2)** move the component feature (9 files incl. the evacuated `trait_sync_watcher`) → `internal/feature/component` (package `component`) + `component/errors.go` (ErrComponentNotFound/NotService/LogsUnavailable + local ErrUnauthorized) + `component/validation.go` (local validator copies); **(E1)** decouple `org_disconnect`'s only inward edge (the pure `ApplyTaskEvent` task-state call) via an injected `applyDisconnect` func-port, wired at both `NewOrgDisconnectService` call sites; **(E2)** move the credential services + controllers (14 files) → `internal/feature/orgcreds` (package `orgcreds` — named to avoid colliding with the foundation `internal/credentials`, which STAYS): `orgcreds` carries the credential error sentinels, dead `commit_identity.go` deleted, `actorFromContext` duplicated (a copy left in `controllers` for the staying idp_controller); routes stay in `api`. Coupling invariant (`go list -deps`): gitrepo→models/credentials/repositories/utils; artifacts→+gitrepo; component→+openchoreo/observability/requests/k8sname; orgcreds→internal/credentials/gitrepo/models/repositories/clients/* (plus `services/codingagent`, a leaf — pre-existing via `sm_api_writer`'s `OrgBaseNamespace`, no cycle; §6.10c wants that helper in `platform/tenant` eventually). None import the flat `services`/`controllers` packages; all new edges are services→feature. **Verified:** `go build/vet ./...`, `go test ./...`, `go test -tags dbtest ./...` all green; **live smoke** on the rebuilt container each slice — clean boot (DI wired, all watchers started, `credential store` + `[SHAKEOUT:CRED]` resolver OK), pre-warm 5 clones, requirements read 200 (artifacts→GitWorkspace→gitrepo), components list 200 (component→OC), GitHub + Anthropic credential status 200 (orgcreds), cross-org 404 (gate preserved). **NOT committed to `refac`/`main`** — branch checkpoint only, pending wso2cloud reconcile.
- **`state-machine` phase DONE (2026-06-20, commit `0b54118`).** Created **`internal/contracts`** — the dependency-free algebra + cross-feature-hook layer — and hoisted the canonical task state machine into it: `TaskStatus` (+ `IsTerminal` + 11 constants), `TaskEvent` (+ constants), `EventCause`, the transition table, `ErrInvalidTransition`, the pure `ApplyTaskEvent`. **Cycle resolved by re-export, near-zero consumer churn** (vs repointing all ~18 `models.TaskStatus` consumers): `models.TaskStatus = contracts.TaskStatus` (alias — gorm model + every consumer unchanged); `services/task_state.go` is now a thin re-export shim (deleted at the `task` phase). `errors.Is(_, ErrInvalidTransition)` holds across the boundary (same sentinel). Added the **hook interface stubs** `TaskTransitions`/`BuildDispatcher`/`DesignChanged` (provisional signatures, primitives + contracts types only; wired in later phases). **Verified:** build/vet/`go test`/`-tags dbtest` green; `go list -deps` confirms `contracts` is a **pure leaf** (stdlib only — the depguard invariant satisfied structurally); live smoke — clean boot, all watchers (which drive `ApplyTaskEvent` via the shim) started, board read 200 (`ComponentTask.Status` path). This is the precondition for `projector/webhook`→`task`→`codingagent`.
- **`projector/webhook` DECOUPLE done (2026-06-20, commit `7c125b4`).** In-place decouple (no file moves): `services/webhook` no longer imports the flat `services` package (`go list -deps` clean). State-machine refs repointed `services.*`→`contracts.*` (webhook uses contracts directly, not the shim); new `services/webhook/ports.go` with `BuildOps` (services.WorkflowRunService satisfies it as a superset) + `OnHoldDispatcher` (count func adapting DispatchService.DispatchTasks, whose `[]DispatchResult` the on_hold watcher only `len()`s); handlers/build_watcher/on_hold_watcher hold the ports, main wires the concretes; `DispatchHook` stays webhook-owned. The reverse edge was already clean (services holds a `TaskStateProjector` consumer interface). **Verified:** build/vet/test/dbtest green; live smoke — clean boot, on_hold + build + coding-agent + trait_sync watchers all started, `/health` 200. **Deferred (deliberately, to avoid a holding-pen double-move):** the actual file moves — webhook ingestion → `internal/feature/webhook`, projector + handlers → `task`, the 3 watchers → their owners — land in the `task`/`codingagent` phases where those destination homes exist. INT-2 sink is already done (§11 item 5); the F-WP `webhook_payloads` org_id migration + `Router.Dispatch` org-threading ride with the eventual webhook move.
- **`task` phase — in-place prep T1 DONE (2026-06-20, commit `c6f8158`).** No file moves yet. **(1)** Reconciled `contracts.TaskTransitions` to the real projector status-write surface — `MarkBuilding(ctx,taskID,sha,runName)` + `ApplyBuildResult(ctx,taskID,event,errMsg)` (the provisional `MarkBuilt`/`MarkFailed` stub was wrong; nothing consumed it); `services/webhook/projector.go` asserts it satisfies the interface; `services.TaskStateProjector` is now `= contracts.TaskTransitions` (dispatch/workflowrun consume the canonical interface). **(2)** **Deleted `services/task_state.go`** (the state-machine re-export shim — a task-phase DoD item); repointed the last consumers (main disconnect closure, dispatch_service) to `contracts.*`. **(3) F8:** `loadBaselineBatch` raw SQL → `TaskRepository.GetBaselineBatch(ctx,orgID,projectID)` (gorm builder, adds the `org_id` predicate); orgID threaded from the caller. (Note: the version columns are `text` git-tags like `v1-2`, so the method returns them as strings, not ints.) **Verified:** build/vet/test/dbtest green; live smoke — clean boot, all watchers (consuming the projector via `contracts.TaskTransitions`) started, board read 200. **Deferred to the task-move slice (T2):** the package move (projector + handlers + TaskService + controllers → `internal/feature/task`) with its forward-ref consumer ports for symbols owned by features that extract *later* (skills `SkillService`, design `concatRequirementBundle`, codingagent `DispatchService`/`ProgressService`).
- **`task` phase — F6/F2t–F5t IDOR fix DONE (2026-06-20, commit `466abf1`).** In-place (no moves). Closed the by-UUID cross-org task IDOR: the operator routes (`/organizations/{orgHandle}/projects/{projectName}/tasks/{taskId}`) loaded by UUID only, so a user in org A could pass org B's `taskId` and the handler operated on B's task. **F6:** `TaskRepository.GetByIDScoped(ctx,orgID,id)` (WHERE org_id=? AND id=?; returns `(nil,nil)` for both no-such-task and cross-org — no existence leak) + `TaskService.GetTaskScoped` (→ `ErrTaskNotFound`); bare `GetByID` kept for the service-identity runner-callback/projector/watcher paths. **F2t–F5t:** `task_controller` GetTask/GetTaskStatus/Retry/ExecTask/RegenerateTaskBody load/pre-check via `GetTaskScoped(pathOrg, taskId)` → 404 on cross-org/unknown; runner-callback bare-UUID routes untouched. **Verified:** build/vet/test green; new `TestTaskRepository_GetByIDScoped_OrgIsolation` dbtest (two orgs, real PG — cross-org read returns nil) RUN→PASS; live smoke — GET task with a bogus UUID → 404 "task not found". Remaining task work: the package move, split into T2a (projector+handlers — done below) + T2b (TaskService+satellites+controllers+board).
- **`task` phase — T2a (projector + handlers MOVED) DONE (2026-06-20, commit `7494962`).** Created **`internal/feature/task`** (package `task`) with the lifecycle-write core: the `Projector` (sole `ComponentTask.Status` writer + advisory locks) + the PR/push/issue_comment transition handlers (`git mv` from `services/webhook/`). Behavior-preserving. **No task↔webhook cycle:** handlers expose `RegisterHandlers(registerFunc,...)` (main adapts the func onto `webhookRouter.Register` via `webhook.EventHandlerFunc`) so task imports nothing from webhook; the staying watchers (build/coding_agent) hold `contracts.TaskTransitions` (not the concrete projector); `installation_handlers` dropped its unused projector field (+ got a local `lookupProjectByRepo` copy). handlers use a task-local `BuildDispatcher` port (`services.WorkflowRunService` satisfies it). **Invariants (`go list -deps`):** `internal/feature/task` imports only contracts/models/gorm — no services/webhook/controllers; `services/webhook` does NOT import task. **Verified:** build/vet/test/dbtest green; live smoke — clean boot, all watchers started (wiring `task.Projector` via `contracts.TaskTransitions`), board read 200, no panic (a live webhook PR→merge transition is unsmokeable with the smee relay down — the moved projector/handler logic is unchanged). **T2b-board DONE (commit `2245327`):** the aggregated board (board_service + board_controller) moved → `internal/feature/task` (forward-ref-free; composes gitrepo.RepoBoardService + repositories.TaskRepository; board read 200 live). `internal/feature/task` now holds projector + handlers + board. **T2c prep DONE (commit `7d90dd1`):** the shared `Skill` DTO + pure `MaterializedName`/`PrefixedID` helpers relocated `services`→`models` (skills keeps a `type Skill = models.Skill` alias) — this removes the hardest task→skills forward-ref (the `[]Skill` return type), so task's `SkillResolver` port can return `[]models.Skill` without a skills-feature import. **T2c prep-2 DONE (commit `5972f41`):** `ErrSpecNotFound`/`ErrDesignNotFound` relocated `services`→`artifacts` (re-exported as services aliases). **T2c move DONE (commit `901eb9e`):** `TaskService` + `task_stream`/`task_diff`/`task_design`/`task_skills` (+ `task_diff_test`) moved → `internal/feature/task`; `task_repository` stays in `repositories`. Forward-refs resolved via: task-local `SkillResolver` port (`ResolveMany`→`[]models.Skill`; `SkillService` satisfies; main wires), `concatRequirementBundle` copied into task, `toK8sName`→`k8sname`, `ErrTaskNotFound`→`task/errors.go`, `ErrComponentRemovedAfterGeneration`→task, `ResolveDesignComponentVia` exported (dispatch calls it), and a narrow `taskReconciler` interface in `design_service` (task.TaskService satisfies it; main wires the design→task reconcile hook). **The HTTP `task_controller` STAYS in `controllers`** (repointed to task.*) — it has codingagent/auth return-type entanglements (`DispatchService`/`ProgressService`/`TaskTokenManager`/`PublisherTokenVerifier`) that move with those features. **Invariant (`go list -deps`):** `internal/feature/task` imports no flat `services`/`controllers`/`webhook`. `internal/feature/task` now = projector + handlers + board + TaskService + stream/diff/design/skills + errors. **Verified:** build/vet/test/dbtest green; clean boot (skill bootstrap, all watchers, server) — no panic. NOTE: the local user JWT (`/tmp/asdlc-usertok.txt`) expired mid-session, so authenticated HTTP smokes need a fresh playwright login; build/test/dbtest + clean-boot are the green signal meanwhile. **Remaining for full task DoD:** move `task_controller` → `internal/feature/task` (rides with the codingagent/auth extraction).
- **`codingagent` phase — EXTRACTED + cycle broken both ways DONE (2026-06-20, commits `87443ca`/`7d86963`/`aacefad`/`9887705`).** Created **`internal/feature/codingagent`** (package `codingagent`) folding the §4.10 merged scope: `WorkflowRunService` (build dispatch), `DispatchService` (coding-agent dispatch + WS2.3 proxy path), `ProgressService`, `DispatchCascadeHook`, the `Dispatcher`/`JobWatcher`/job+ES templates, and the **3 evacuated watchers** (`build_watcher`/`coding_agent_watcher`/`on_hold_watcher` + their `BuildOps`/`OnHoldDispatcher` ports) out of `services/webhook` (§9 folds the separate `watchers` phase's *structural* move in here; webhook keeps pure ingestion). Done as 4 build-green slices: **CA-1** relocate the pure `wc-` namespace helpers (`OrgBaseNamespace`/`RemoteWorkerNamespace`) `services/codingagent/namespace.go`→`internal/platform/tenant` (their §4.0/§6.10c home) — breaks the would-be `codingagent↔orgcreds` cycle (orgcreds/sm_api_writer consumed the helper); **CA-2** move `ResolveDesignComponentVia` `task`→`artifacts.ResolveDesignComponent` (kills dispatch→task forward edge #1; both task + codingagent now read design corpus via artifacts); **CA-3** in-place consumer ports so dispatch/progress import nothing forbidden once moved — progress `taskfeature.TaskService`→local `taskReader`; dispatch `taskTokenIssuer`/`OrgPublisherProvisioner`/`RuntimeConfigEmitter` (auth/idp/runtimeconfig extract later); **CA-4** the `git mv` (15 files, 3 pkgs→1) + repoint main/task_controller, `toK8sName`→`k8sname`, local `ocEntrypoint` copy, `cascade`'s `*RuntimeConfigService`→`projectSPARuntimeConfigEmitter` port. **The `task↔codingagent` cycle is broken in BOTH directions:** forward (task's merged-PR build trigger) via task's `BuildDispatcher` port satisfied by `codingagent.WorkflowRunService`; back (status write-back) via `contracts.TaskTransitions` — every codingagent `ComponentTask.Status` write (`WorkflowRunService.dispatchBuild` `MarkBuilding`, build_watcher `ApplyBuildResult`, dispatch `MarkVerificationFailed`/`RetryTask`) goes through the contract. **Regression caught in review (was introduced by CA-3):** main wires optional `SetIDPService`/`SetRuntimeConfig` on `dispatchSvc` via interface type-assertions naming the *old* concrete param types — CA-3's port switch silently broke the match at runtime (compiles fine, wiring skipped at boot). Fixed by exporting the two ports (`codingagent.OrgPublisherProvisioner`/`RuntimeConfigEmitter`) and repointing both assertions. **Invariants (`go list -deps`):** `internal/feature/codingagent` imports NO `feature/task`, `feature/webhook`, flat `services`, or `controllers` (its feature deps = artifacts/component/gitrepo/orgcreds); `feature/task` imports NO codingagent; `services/webhook` imports NO codingagent. **Verified:** build/vet/`go test`/`-tags dbtest` all green; **live smoke** on rebuilt container — clean boot, `dispatch: proxy-based coding-agent path enabled` (the optional-setter assertion idiom matches the new wiring), all 5 watchers started (on_hold/build/codingagent.JobWatcher/trait_sync/coding-agent), health 200, no panic (a live dispatch→build lifecycle is unsmokeable: smee relay down + would spend Anthropic tokens). **Deferred (cloud / cleanup):** the §9 `watchers`-phase *cloud* legs — **IDOR-6** impersonation fail-close + `SourceServiceIdentity` carve-out, `SweepAllOrgs` per-org watcher sweeps, **INT-7** namespace-from-`scope` hardening, and `RunnerAuthMode` replacing the `isGatewayPlatformURL`(`https://`-sniff) — all LEFT as-is (need wso2cloud / consumer coordination). `task_controller` still in `controllers` (now imports codingagent + services + task; final move + `ocEntrypoint` dedup ride with `cleanup`).
- **`req+design` phase — EXTRACTED + INT-8 closed DONE (2026-06-20, commits `7dc4317`/`338aee8`/`6d3c7cd`).** Created **`internal/feature/requirements`** (RequirementsService + RequirementsChatService + RequirementsDirLocker + requirements/chat **and collab** controllers) and **`internal/feature/design`** (DesignService(+test) + DesignController, owns `AssembleDesignFromFiles` [cut from requirements — design-only-consumed, §4.7] + `toK8sName`/`ocEntrypoint`). Slices: **RD-1** decouple design's two remaining concrete edges in place — `*component.TraitSyncService`→`traitSyncReconciler` port + `*SkillService`→`skillCatalog` port (design→task was already the `taskReconciler` port from T2c); **RD-2+RD-3** the moves (8 files) + feature-local `validation.go` (requireOrgHandle/requireProjectName copies) + `versioning.go` split (deleted `services/versioning.go`); `runtime_config_service` (stays in services) repointed off the departing `toK8sName`→`k8sname.ToK8sName`; moved-code error refs → `artifacts.ErrSpecNotFound`/`ErrDesignNotFound` + design-owned `ErrSpecNotApproved`. **RD-4** collab move + **INT-8 fix**: the raw S2S `GET /api/v1/collab/validate` (was `jwt.ParseUnverified`, no signature check, no access check — H-severity IDOR) is now (a) **wrapped with `jwt.Middleware`** (the gate's JWKS verifier — forged/unsigned/expired Bearers rejected before the handler) and (b) enforces the **§6.6g project-ownership oracle**: parse `X-Room-Id` (`spec-<org>-<project>`; the collab-server already sends it), require it belong to the *verified* caller's org (strip the known-org prefix → unambiguous project even with hyphens), and confirm the project's repo row exists for that org via a narrow `repoOracle` consumer port (gitrepo.RepoService satisfies it). `GetCollabSession` swapped off `services.ProjectService` onto the same oracle. `collab_controller_test.go` covers the matrix (no-claims→401, missing room→400, cross-org→403, ghost project→403, own+exists→200, hyphenated project→200) — pass. **F5 note:** the requirements dir-locker key already hashes `(orgID, projectID)` — F5-for-requirements was already satisfied; the gitrepo repo-lock F5 (the original §6.7 site) remains a low-severity `cleanup` item. **Latent-bug fix (from RD-1, caught in review):** RD-1 changed the `DesignServiceWithSkills` interface to the `skillCatalog` port but missed the `SetSkillService` *impl* signature → `*designService` silently stopped satisfying the interface (main's assertion would skip skills wiring at runtime, compiles fine) — same class as the CA-3 bug; impl corrected so all three design setters match. **Invariants (`go list -deps`):** `requirements` imports no design/task/component/codingagent/services/controllers (middleware/jwt is the shared auth layer); `design` imports no task/component/codingagent/requirements/services/controllers (its component/skills/task edges are all consumer ports). **Verified:** build/vet/`go test`/`-tags dbtest` green; INT-8 test green; clean boot on rebuilt container (all watchers, dispatch path enabled, health 200). **Deviations:** collab uses a `repoOracle` consumer port (not a direct gitrepo import); `AssembleDesignFromFiles`→design; error sentinels re-pointed to `artifacts` (unused copies left in `services/errors.go` until cleanup); per-feature `validation.go` duplicates (requireOrgHandle/requireProjectName) — same deviation as component/orgcreds; design's `ocEntrypoint` was dead (zero callers) and has since been DELETED in the 2026-06-21 post-audit pass — `codingagent.ocEntrypoint` is the only copy (see the Post-audit corrections bullet above). **Cloud/consumer deferred:** none specific to this phase (the collab-server already sends X-Room-Id, so INT-8 needed no cross-component change).

- **`project+org+idp+skills` phase — EXTRACTED DONE (2026-06-20, commits `cd13586`/`5f1f4a3`/`451340f`).** The last extraction phase. Created **`internal/feature/{project,organization,idp,runtimeconfig,skills}`**. The hard decoupling was already done in earlier slices (consumers reach these via consumer ports), so this was mechanical + build-green. Slices: **PO-1** decouple `orgensure` middleware off `services.OrganizationService` → a local `OrgEnsurer` port (middleware→flat-services was wrong-direction; `[SHAKEOUT:ORG]` log untouched); **PO-2** move project + organization + idp + runtimeconfig (subagent, verified) — IDOR-7 already closed (status methods scope via the org-scoped `gitrepo.RepoService.GetRepo`); `idp→orgcreds` kept (only `*orgcreds.SMAPIWriter`, acyclic); error sentinels feature-localized (`ErrProjectNotFound`→project; `ErrUnauthorized`/`ErrForbidden`/`translateHTTPError` duplicated into project+organization); **PO-3** move skills (embed-package collision resolved by aliasing the bundled `asdlc-service/skills` embed.FS as `embedskills`; skill_controller same-package `services.*` stripped; feature-local `validation.go`). **🔴 SHAKEOUT preserved verbatim** (the user's explicit constraint for the cloud reconciliation): `organization_service.go`'s `[SHAKEOUT:ORG]` block is byte-identical to HEAD (×4); main's `orgUUIDResolver` `[SHAKEOUT:OCAUTH]` (×3) untouched; orgensure's `[SHAKEOUT:ORG]` untouched. **Satisfies the pre-existing consumer ports unchanged:** organization→`orgensure.OrgEnsurer`+`tenant.Resolver`; idp→`codingagent.OrgPublisherProvisioner`+component's `OrgPublisher`; runtimeconfig→`codingagent.RuntimeConfigEmitter`+`projectSPARuntimeConfigEmitter`; skills→`design.skillCatalog`+`task.SkillResolver`. **Invariants (`go list -deps`):** each of the 5 imports no flat `services`/`controllers` and no sibling feature except allowed-lower (project→gitrepo+artifacts; idp→orgcreds; runtimeconfig→artifacts); no cycles among them. **Verified:** build/vet/`go test`/`-tags dbtest` green; clean boot on rebuilt container (tenant gate active=enforce, skill bootstrap, dispatch enabled, all watchers); **authenticated live smoke** — projects list renders (project feature), `[SHAKEOUT:CLAIMS]` gate fires (enforce, same-org), and the **moved organization feature's `[SHAKEOUT:ORG]` seam fires at runtime** (`ensured=true`); 0 BFF ERROR. **Deferred to `cleanup` (skills-phase DoD items):** F9 (`design_version_skill_snapshots` org_id + rematerialize — live migration touching task readers) + the SkillRepository raw-gorm wrap (forbidigo-gated). **Residual flat-package content after this phase** = the `cleanup` worklist: auth/platform (`task_token_manager`/`publisher_token_verifier`/`jwks_controller`), webhook ingestion (`services/webhook/*`+`webhook_controller`), `task_controller`, `external_url.go`, `api_security_test.go`, `services/errors.go` shims, `controllers/validation.go`.

- **`cleanup` phase — CORE DONE (2026-06-20, commits `7656ab3`/`38f690a`/`11300cb`/`f2bf7a8`/`c534b14`).** Drained the flat layers + locked the boundaries: **CL-1** auth (`task_token_manager`+`publisher_token_verifier`) → `internal/platform/auth` (clean leaves; main aliases it `authn` since `clients/auth` owns bare `auth`); **CL-2** dissolved the flat `services` package — `external_url`(+test)→`runtimeconfig`, `task_controller`'s last error refs→`artifacts`, deleted `services/errors.go`; **the flat `services` package no longer exists**; **CL-3** webhook ingestion (`services/webhook/*` + `webhook_controller`) → `internal/feature/webhook` — the last feature; **CL-4a** `jwks_controller` → `platform/auth` (JWKS publication is auth-owned); **CL-5** `internal/arch/arch_test.go` locks the import boundaries (no feature imports flat services/controllers; contracts/platform-tenant/platform-auth are leaves; task↔codingagent + design↔task cycles stay cut) — runs under plain `go test`, all pass. **Verified:** build/vet/`go test`/`-tags dbtest` green throughout; clean boot on rebuilt container (gate active=enforce, skill bootstrap, all watchers, health 200). **`controllers` package is down to just `task_controller.go` + `validation.go`** — task_controller is the documented composition-edge exception (its handlers RETURN codingagent's `DispatchResult`/`ProgressResponse` DTOs, so moving it into `task` requires first hoisting those DTOs to `contracts` — deferred). The remaining cleanup tail (task_controller move + validation.go delete, F9, SkillRepository, F-WP migration, depguard/forbidigo CI rules + runtime tenantdb guard, AppParams→Deps, INT-5, /credentials/refresh retire) is all cloud-/migration-coupled or polish — tracked in the RESUME CHECKPOINT.

- **`cleanup` phase — CL-6 (task_controller move) DONE (2026-06-21, 3 commits).** Drained the **last** flat package: `controllers/` no longer exists. Done as three build-green slices. **(1) DTO hoist** — `DispatchResult`, `ProgressResponse`, `ProgressEvent`, `ErrProgressUnavailable` hoisted to `internal/contracts` (codingagent + observer keep `type X = contracts.X` aliases so producers are byte-identical). `ProgressEvent` went into `contracts` itself, **not** `models` — `models` already imports `contracts` (the `TaskStatus` re-export), so `contracts→models` is a cycle; as a pure scalar it keeps `contracts` stdlib-only. **(2) ports + move** — `git mv controllers/task_controller.go` (+ its progress IDOR test) → `internal/feature/task`; the controller now drives dispatch/progress via **task-local consumer ports** `TaskDispatcher`/`ProgressReader` (`ports.go`), satisfied structurally by codingagent's `DispatchService`/`ProgressService` (assertion at the composition root). Added feature-local `task/validation.go` (`requireOrgHandle`/`requireProjectName`/`requireTaskID`); deleted `controllers/validation.go`. Wiring repointed at all three sites (`api/task_routes.go`, `api/app.go` `AppParams`, `main.go` builder + the three named optional-setter assertions `task.{SkillsService,PublisherVerifier,CredentialsRefresh}Setter`). **(3) arch-lock** — `arch_test.go` drops the controllers carve-out, asserts `cmd`/`api` import no `controllers`/`services`, and adds `TestFlatPackagesDeleted` (a re-created flat layer fails even before anything imports it). **Invariants:** `go list -deps internal/feature/task` imports **no** codingagent (cycle stays cut); `controllers`/`services` packages do not resolve. **Verified:** build/vet/`go test`/`-tags dbtest`(compile) green; arch_test fresh-pass. Behavior-preserving (handlers byte-identical bar import qualifiers). This **completes the controllers/services drain** — the flat horizontal layers are entirely gone.

### Deviations / deferred (MUST be completed before Phase-1 DoD)
1. **Feature extraction IN PROGRESS — `gitrepo` + `artifacts` + `component` + `credentials` done; remaining features pending.** Those four moved to `internal/feature/<x>/` (see "Done" above). **Remaining slices** (per §9 order): projector/webhook, task, codingagent, req/design, project+org+idp+skills, cleanup. (`state-machine` DONE — see "Done" above; **(j)** its `models.TaskStatus` alias + `services/task_state.go` re-export shim are kept rather than repointing all ~18 consumers now — the shim is deleted at the `task` phase, and the hook interfaces are provisional stubs until their owning phases wire them.) The `var _ port` assertions + per-feature `Deps` (composition-root rework) also remain. **Extraction-specific deviations vs the doc (decided 2026-06-20, all to reduce churn / preserve build-green; revisit in `cleanup`):** (a) `RepoRepository` + `ConfigRepository` stay in package `repositories`, `GitRepository` + `ComponentConfig`/`EnvVar`/`EnvVarSlice` + `models/{spec,design,tasks}.go` stay in `models` (shared foundation, wide consumers; §6.9 dissolution deferred to the `state-machine`/`cleanup` work where the `TaskStatus` cycle is handled); (b) `ExternalAPICatalog` moved **with artifacts** (its sole consumer), deferring §4.7 design-ownership until design extracts; (c) `board_*` (task-aggregate) + `org_github_*` (credentials) left in `services`/`controllers` for their owning feature's slice; (d) routes left in package `api` (controller refs repointed) — the `feature.Register(router)` composition-root move is deferred; (e) consumer ports realized concretely: `GitWorkspace` (artifacts→gitrepo, the §4.4 downcast-kill), `OrgPublisher` (component→idp's EnsureOrgPublisher/GetProfile — idp not yet extracted, idpService satisfies it structurally), `BuildSecretStager` (component→BuildCredentialsService, with a composition-root adapter mapping `*StageResult`→secretRef string); (f) F5 (org-qualified lock key) stays deferred to `req+design` — the `RepoLock(projectID)` accessor preserves today's keying; (g) `ResolveAPISecurityEnabled`/`CallerKind` hoisted to `models` (neutral home for the shared pure predicates; §4.7 wants them in design eventually); (h) `ErrUnauthorized` is duplicated (component-local copy + the original kept in `services` for project/org) — to be unified when `platform/apperr` lands; the `contracts.TraitSync`/`DesignChanged` hooks are still the concrete `*component.TraitSyncService` + `SetTraitSync` setter (the `contracts` package + real hook interfaces are deferred to `state-machine`); (i) **credentials:** `internal/credentials` (AES store / `Resolver` / `Credential` / `Identity` / `AppTokenMinter`) STAYS as the foundation package (imported by 22 files incl. the extracted features); the feature pkg is named **`orgcreds`** (the per-org credential services + controllers layer) to avoid the package-name collision — §4.2's "feature owns `internal/credentials`" + consumer-ports for `Resolver` are deferred to `cleanup` (would churn the already-extracted features). `org_disconnect`→task-state via an injected `applyDisconnect` func-port until the state machine lands in `contracts`. `actorFromContext` duplicated (orgcreds + a copy in `controllers` for idp_controller). `orgcreds`→`services/codingagent` is a pre-existing leaf edge (`sm_api_writer`'s `OrgBaseNamespace`) — relocate that helper to `platform/tenant` per §6.10c at cleanup. **INT-1** (unauth `effective-key` + `EffectiveKey`), **INT-3** (Service-JWT `aud`), and the `oc_org_id`→`org_id` column rename are LEFT UNTOUCHED (cloud-coordinated §9.2 + a live-cred-table migration) — confirmed the slice builds without them.
2. **`ocOrgID`→`org`/`orgHandle` parameter rename (§6.1d) deferred** (~552 call sites) — to land with each feature's extraction.
3. **`oc_org_id`→`org_id` column rename (§6.1d/§6.5) — status: pending** (credential/anthropic/secret/webhook tables). Needed for `TenantColumn()` uniformity + the `tenantdb` guard.
4. **`credentials` phase — local parts DONE; rest extraction/cloud-coupled:** route `{ocOrgId}`→`{orgHandle}` rename DONE (JSON contract keys `"ocOrgId"` preserved — webhook receiver reads them); `BindServiceOrg` typed-Router (`api.ServiceRouter` + `BindServiceOrgScope`) **DONE** (Service-JWT = scoping not authz). **Still outstanding:** `oc_org_id`→`org_id` **column** rename — **doc-coupled to the feature extraction** (§6.1d "in the same PR that extracts each feature"); deferring it standalone is doc-faithful AND avoids a risky migration on the live seeded cred tables for deferred (tenantdb-guard) payoff. apperr **adoption** rides with extraction too (§9 "adopted here at its moving controllers"). INT-1 (delete unauth `effective-key`; BFF-injects to agents-service — partially already live: agents-service has no `ANTHROPIC_API_KEY`, key injected per-call) + INT-3 (distinct Service `aud`) are **§9.2 consumer-coordinated** (agents-service + remote-worker) — need the dual-serve window + wso2cloud. NOTE: `BindRunnerScope` binds org from the signed task claim (`claims.OcOrgID`, RS256 BFF-minted) rather than re-loading the task row; the per-route handler still asserts `claims.TaskID==path` (INT-6). The org-from-row refinement is marginal defense-in-depth, deferrable.
5. **INT-2 sink DONE** — `services/webhook/handlers.go` `lookupProjectByRepo` rewritten from unanchored `ILIKE '%'+fullName` to exact `repo_url =` (canonical github.com URL, both `.git`/bare). INT-2 now fully closed (routing leg + sink). The additional `Router.Dispatch(Caller{validatedOrg})` org-scoping threading remains a `projector+webhook`-phase item.
6. **`helpers` remainder — mostly DONE:** `ToK8sName` hoisted to `internal/platform/k8sname` (in-package shim + external caller migrated); correlation-ID/slog hoisted to `internal/platform/obs` (leaf — stdlib+uuid only; `middleware` delegates via thin wrappers, no cycle). Still deferred (ride with their owning feature's extraction): bulk shared-helper relocations (`wp_naming`/`external_url`/`artifact_versioning`/mappers).
7. **`tenantdb` builder guard + `forbidigo` raw-SQL/`allow_global` bans NOT enabled** (cleanup phase, by design — would abort not-yet-migrated `services/` files).
8. **`TENANT_GATE_MODE` defaults to `enforce`** (code + compose) by explicit request, deviating from the doc's "ship `log` first on a new plane" (§9 gate DoD). Set `TENANT_GATE_MODE=log` for the observe-only canary. The wso2cloud claim-shape dry-run that the doc requires before enforcing is **still pending** — if cloud claims differ, enforce will 404 console traffic; the `[SHAKEOUT:CLAIMS]` capture is the diagnostic.
9. **§6.13 seam instrumentation: ALL 8 seams added** (build-green, secret-safe — presence/len/last4 only, `Info` level, plane discriminator per line): `:CLAIMS`(gate + jwtassertion `validateJWT`), `:ORG`(orgensure + organization_service deep), `:OCAUTH`(transport `authEditor` + main `orgUUIDResolver`), `:TOKEN`(oauth `token_provider`), `:CRED`(org_resolver `Resolve`), `:SMAPI`(sm_api_writer + secretmanagerapi provider), `:DISPATCH`(dispatch_service). Local dry-run captured (create flow shows CLAIMS=jwks-verified, OCAUTH=forward-user-jwt, CRED=user-pat — the values that will diverge on cloud per §6.10a). **Outstanding:** run the same flow on wso2cloud, diff+reconcile per §6.13 steps 3–7, then remove the lines at DoD. Two seams (`validateJWT`, `token_provider.fetchLocked`) log without ctx (no signature change) so correlation_id won't auto-attach there.
10. **Checkpointed to a feature branch; no wso2cloud run yet.** The Phase-1 seam fixes are committed as a single **`[LOCAL-ONLY · DO-NOT-MERGE]`** baseline on branch `modularization/feature-extraction` (off `refac`), purely to checkpoint the feature-extraction work on top — **not** a merge to `refac`/`main`. The §6.13 reconciliation loop (steps 3–7) and §10 dual-plane DoD remain outstanding for all of the above before anything merges.

### Feature-extraction findings (gitrepo + artifacts) — discovered 2026-06-20

Pre-move dependency survey of the first two feature slices (gitrepo, artifacts) surfaced structural facts the §4.5/§9 narrative did **not** capture. Recorded here so the extraction is doc-faithful where the doc is right and corrected where it is wrong.

1. **gitrepo and artifacts are entangled at the *concrete-struct* level — they must extract as a coordinated pair behind a port seam, not as two clean sequential phases.** Artifacts files define methods *on* gitrepo's concrete `*gitOpsService` (`prepareAuthedEnv` in `artifact_service.go`; `resolveSaveIdentities`/`bestEffortPullDefaultBranch`/dead `GitHubClient()` in `save_via_api.go`) and reach its private fields (`s.gitOps.gitHub`, `.resolver`) + unexported methods (`getRepoLock` ×38, `ensureCloneReady` ×18) across ~20 sites; `github_artifacts.go` defines 12 methods on the concrete `*githubClient`. Go forbids cross-package method definitions + private-field access, so the move requires: (a) **relocate** the three misplaced `*gitOpsService` methods back into gitrepo (delete the dead `GitHubClient()`); (b) move `github_artifacts.go` into gitrepo (it implements the gitrepo `githubClient`); (c) add **exported accessors** on `gitOpsService` (`GitHubClient()`, `Resolver()`, an exported repo-lock accessor, `EnsureCloneReady`, plus the relocated save helpers) and a **narrow `GitWorkspace` consumer port in artifacts** that `gitrepo.GitOpsService` satisfies (kills the `NewArtifactService` panic-cast); (d) **export** the GitHub wire types (`TreeEntry`/`CreateCommitRequest`/`CreateTagObjectRequest`/`GitIdentity`/`HTTPStatusError`) + CAS sentinels (`ErrSHAMismatch`/`ErrRefNotFastForward`) artifacts consumes. Direction stays acyclic: artifacts→gitrepo (per §4 graph).
2. **`models/design.go` does NOT move into artifacts — §4.5 is wrong here.** `DesignComponent` (+ `ExposesAPI`/`CallerIdentity`/`DependentAPI`) is consumed by **5 features + the agents wire client** (task, component, runtimeconfig, trait_sync, api_security, `clients/agents`), so moving it into artifacts inverts the dependency graph. Correct home is `internal/contracts` (shared value DTO, consistent with §4.0 placing `ArtifactVersion`/agents DTOs there) or it stays in `models`. **`models/tasks.go` (`Tasks`) belongs to the `task` feature, not artifacts.** Only **`models/spec.go` (`RequirementsBundle`) is artifacts-local** and safe to move. Net: defer the design/tasks DTO relocation to the `contracts`/`task` work; artifacts imports the shared types from their current home.
3. **`models/repository.go` (`GitRepository`) stays in `models`.** Referenced by `middleware/org_scope.go` (the gate's `ScopedRepo`), `project`/`dispatch`/`workflowrun` services, and migrations; moving it into gitrepo forces a wide repoint and a middleware→feature import direction. The gitrepo *repository* (`RepoRepository`) moves; the model stays in the shared `models` foundation pkg.
4. **Mixed-concern files needing a split (not a whole-file move):**
   - `services/errors.go` — gitrepo sentinels (`ErrRepoNotFound`/`ErrRepoNotReady`/`ErrAuthFailed`/`ErrPushConflict`/`ErrFileNotFound`/`ErrTagNotFound`/`ErrTagAlreadyExists`/`ErrRepoAlreadyExists`) sit in one `var` block with project/component/spec/design/task sentinels → split gitrepo's into `internal/feature/gitrepo/errors.go`.
   - `api/repo_routes.go` — registers gitrepo routes **and** the 21 artifact routes (`ac ArtifactController`) → split the artifact block into the artifacts feature.
   - `board_service.go`/`board_controller.go`/`board_routes.go` — the *aggregated* board composes gitrepo's `RepoBoardService` with `TaskRepository`+`ComponentTask` (task feature); it is a **task-feature** unit, distinct from the clean gitrepo `repo_board_*`. Assign the aggregated board to `task`, the repo board to `gitrepo`.
   - `org_github_controller.go`/`org_github_routes.go` — depend only on `CredentialService`/`OrgDisconnectService`/`BearerService`: they are **credentials-feature**, not gitrepo. Exclude from the gitrepo move.
5. **Cross-feature unexported funcs must be exported on the move:** `issue_body.go` `buildIssueBody`→`BuildIssueBody`, `issueTitle`→`IssueTitle` (called by `task_service`/`task_stream`); `openapi_normalize.go` `normalizeOpenAPIYAML`→`NormalizeOpenAPIYAML` (called by `task_diff.go`).
6. **F5 is NOT fixed in this extraction (correctly).** Per §6.7 F5 is a `req+design`-phase item. The repo-lock accessor exposed for the artifacts port preserves today's `projectID`-only keying; the org-qualified `ProjectLockKey(org, projectID)` lands later. The conflict-retry leaky bucket is *already* org-scoped (`org:project`) — do not conflate it with F5.
7. **`ExternalAPICatalog` is design-owned (§4.7), not artifacts.** `artifact_store.go` already accepts it via `SetExternalAPICatalog` injection; the package-global `splitDesignCatalogRef` it reads needs rehoming when design extracts. Artifacts keeps the injection seam, not the catalog.
