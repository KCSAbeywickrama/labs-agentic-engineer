# Dependency-Management ("Connections Story") Migration

**Upstream source:** `upstream/aep-rewrite` PR **#85** (branch `aep-rewrite-kaj`, author `kaje94`), tip `1076be7`.
**Our fork point (merge-base):** `dfe6f2a` (`Merge pull request #73 … projects-listing-71`).
**Diff size:** 323 files, ~36,342 insertions since the fork point.
**Integration mechanism:** **`git merge` (not rebase)** — see §4.

> This is an **executable playbook**, not just an analysis. §1–§3 characterize the upstream
> work and how it relates to ours. §4 is the integration strategy. §5 is the phased plan:
> each phase has a **work checklist** and a **"verify against the PR workspace" checklist**,
> and §6 is the **final completion gate** that must pass before the migration is marked complete.
> Tick the boxes as you go and keep the **progress tracker** (§0) current.

---

## 0. Progress tracker

Update this table as phases complete. The migration is **not complete** until §6 (Phase 8) passes and every row below is `DONE`.

| # | Phase | Build state at end | Status |
|---|---|---|---|
| 0 | Pre-flight: clean tree, PR workspace, integration branch (**no merge**) | 🟢 green | ✅ DONE |
| 1 | **PRE-MERGE** platform bump (OC 1.1.1 + CNPG + Thunder) + full auth-inclusive regression | 🟢 green | ✅ DONE |
| 2 | The merge (sole known-red checkpoint): keep-ours wholesale + take-theirs + skip-delete + resolve | 🔴 red-expected | ✅ DONE |
| 3 | Schema & contracts: `connections[]`→`dependencies[]` + additive OpenAPI (+ console-legacy type vocabulary) | 🟡 TS green / Go red | ✅ DONE |
| 4 | `dependencies/` **agnostic subset** + OC client (task ports **trimmed**, provisioning routes **absent**) | 🟢 green | ✅ DONE |
| 5 | Design-time read-resolution + proceed-gate + main-agent MCP discovery | 🟢 green | ✅ DONE |
| 6 | **Provisioning-as-issues + funnel gates + declarative wiring** — real `aep:provision` adapters (the crux) | 🟢 green | ✅ **DONE + behavioral e2e PASSED live** — 6.1–6.4 + post-audit (0 dead code, runner-secret wiring finished) committed; a fresh design authors `dependencies[]` → approve → 2 `aep:provision` gate issues → masked status, no leaked secrets (verified on the OC 1.1.1 cluster). Two e2e-found bugs fixed (Bug A write-path `connections[]`; Bug B unregistered migration). Build→deploy leg + golden-fixture regen = tracked follow-ups |
| 7 | Frontend: merge console-legacy dep UI + re-point CTAs to `aep:provision` | 🟢 green | ☐ TODO |
| 8 | **Completion verification & sign-off** | 🟢 green | ☐ TODO |

Status legend: `☐ TODO` → `◐ IN PROGRESS` → `✅ DONE`. A phase is `DONE` only when **both** its work checklist and its verify-against-workspace checklist are fully ticked and its exit criteria hold.

> **⏸️ Planned compaction checkpoint:** compact at the **Phase 5 → Phase 6** boundary (before the crux) — see the **COMPACTION CHECKPOINT** block just above §Phase 6. Fallback: end of Phase 4 if context passes ~75% sooner.

> **Sequencing invariants** (verified by a multi-agent design pass, 2026-07-06 — see §5 for the why):
> 1. **The platform bump is PRE-merge (Phase 1).** "Prove the platform with zero feature code" is only satisfiable *before* the merge — so any post-merge red is unambiguously feature code, never the OC upgrade.
> 2. **The merge (Phase 2) resolves EVERY conflict to commit** — files we don't fully rework yet (`design_service.go`, `artifact_store.go`, `design_huma.go`, console `types.ts`, `docker-compose.yml`, helm) are resolved **keep-ours-temporarily**, then *grafted onto* in later phases (never "resolved from scratch later").
> 3. **The whole `codingagent/` + `task/` + `execution/` packages are keep-ours; upstream's `component_tasks`-based net-new files there are `git rm`'d** (skip-delete) and their capability **re-implemented from scratch in Phase 6**, never merged.
> 4. **No stub adapters.** The task-coupled ports (`TaskCompleter`/`RedispatchFunc`/`TaskStore`) have **no consumers** at Phase 4 (their two caller files are git-rm'd until Phase 6), so they are **trimmed out**, not stubbed; provisioning HTTP routes nil-guard to **503** until Phase 6 wires the rebuilt services.

> **Principle — no permanent half-migration.** The end-state is a **complete** migration: every dependency-management capability working on **our** architecture, the platform **fully on OC 1.1.1** (no patched-around state), no capability silently dropped. Deferred items (e.g. console convergence onto `apps/console`) are **tracked in §8, not abandoned**. The §6/Phase-8 gate enforces this before sign-off.

> **Design locked (grilling + design-pass, 2026-07-06):** provisioning/gate work = **`aep:provision` GitHub issues** + a **`provision` Execution kind** on our funnel — **no** SYSTEM rows, projector, or gate table (§3.6, Phase 6); proceed-gate in `SaveAndProceed` at the tag-cut (Phase 5); merge-first keep-ours+take-theirs+re-implement (§4).

> ### ▶ Resume after compaction (read this first if you're a fresh context)
> This migration is executed **phase-by-phase, committed incrementally** onto branch **`rewrite-improve`** (working directly on it — no separate integration branch). To continue:
> 1. **Where am I?** — the §0 tracker above shows each phase's status; **§8 "Execution progress"** has the per-phase commit SHA + decisions/refinements. `git log --oneline -15` shows the phase commits (messages are `feat(dependencies): Phase N …` / `build(deployments): …` / `Merge upstream/aep-rewrite …`). Resume from the **first non-`✅ DONE`** row.
> 2. **Fixtures (already set up):** the **PR workspace** (read-only upstream tip `1076be7`, the parity oracle) is a worktree at **`../aep-pr-workspace`** — every phase verifies against it. The **merge** is done (`upstream/aep-rewrite` is an ancestor of HEAD). Scratchpad has the **merge playbook** (`.../scratchpad/phase2-merge-playbook.md`) with the full conflict inventory + the 5 grounded refinements.
> 3. **Gate to re-establish green** after a compact: `cd services/aep-api && go build ./... && go vet ./... && go test ./...` (dbtests SKIP without Docker — that's expected, not failure); `pnpm turbo run typecheck` (green **except** `@aep/console`/apps-console, a tracked deferral); `cd console-legacy/console && pnpm run typecheck` (SOURCE green; vitest tests are Phase 7). The **cluster** is up (OC 1.1.1) from Phase 1 — `docker ps` for the 7 `aep-*` services; a fresh teardown→setup→start→seed reproduces it (Colima 6–7cpu/8gb).
> 4. **Live e2e** uses the **playwright-cli skill** (UI at `http://localhost:8090`, admin/admin) or REST (mint a Thunder token per `deployments/scripts/seed-dev.sh`). Two tracked follow-ups block a *real* build→deploy e2e (Phase 8): rebuild/repin the `aep-coding-agent-runner` image (stale vs the 2026-07-05 creds-refresh route) + add the missing `coding_agent_logs` migration.
> 5. **In-depth review / large mechanical sweeps → use subagents** (Sonnet); verify their claims (build/test) before trusting.

---

## 1. What each change is (complete catalog)

PR #85 bundles **two intertwined stories**:

1. **The "connections story"** — dependency management: rename `connections[] → dependencies[]`, four dependency kinds, external-resource registry, platform-resource provisioning, cross-project access requests, an MCP discovery surface, read-time resolution, a proceed-gate, declarative workload wiring. **This is the net-new value.**
2. **Upstream's own platform migration** — moving generation onto a new `services/agents` (structured-output agents + URL-swap cutover from `agents-legacy`), a typed DB task graph, and a brand-new `apps/console`. **This overlaps — divergently — with work our branch already did.**

Story 2 is built on **two foundations we deliberately replaced** (a DB-backed `component_tasks` graph, and structured-output generation), while story 1 mostly sits *on top of* those foundations and can be re-based onto ours.

### 1.1 Vocabulary & domain model: `connections[]` → `dependencies[]` (breaking)

- **The rename** (`a7b976c`, coordinated across schema owners). Old per-component `connections: [{to, type: http|datastore|connector, onPlatform?}]` → single kind-discriminated `dependencies: Dependency[]`.
- **Four dependency kinds:** `component` (sibling in same project), `org-service` (another project's org-published component, addressed by catalog name), `external` (third-party service consumed via configured values/secrets), `platform-resource` (platform-provisioned infra from a typed catalog, e.g. `postgres-cnpg`).
- **`Dependency` shape** (one struct, `kind` selects meaningful fields): common `{kind, name, description}`; external `{needsSpec, specPath, specUrl, config: ConfigKey[]}`; platform-resource `{resourceType, parameters}`; ambiguity UI `{candidates: DependencyCandidate[]}`. `ConfigKey = {key, secret, credentialClass}`.
- **Read-time-only fields:** `status` (`resolved|blocked|unresolved|ambiguous`) and `reason` (`access-required|not-found|needs-spec|…`) are **never authored, never persisted** — computed on read (ADR-0003); a schema violation if present on disk.
- The word **"connection" is banned** for these concepts (in OpenChoreo it means the *consumed-endpoint* side).
- Mirrors updated in lockstep: Go `models.Dependency` + `design_json.go` codec (ground truth), TS `contracts/component-design.ts`, the file-mutation agent's Zod validator, the architect's discriminated-union schema, `@aep/design-projection`, `high-level-architecture/SKILL.md`.

### 1.2 aep-api — the new `internal/feature/dependencies/` feature (green-field, ~5.7k lines)

Mirrors OpenChoreo's `Workload.spec.dependencies.{endpoints,resources}` split.

- **Parent = authenticated MCP discovery server.** `POST /internal/v1/mcp`, JSON-RPC 2.0 (non-streaming), audience `aep-api-mcp`, org bound **solely** from the verified token claim (`ocOrgId`). Four read-only tools the design agent calls before inventing a dependency:
  - `list_external_resources` → `[{name, description, configKeys:[{key,secret}]}]`
  - `get_external_resource_schema {name}` → one resource's config-key schema
  - `list_org_endpoints` → `[{name, project, endpoint, type, namespaceVisible}]`
  - `list_platform_resource_types` → `[{name, parameters, outputs}]`
  - **Auth nuance** (`bb4bde1`): `tools/call` re-wraps ctx with the BFF's **OC service identity**, else OC lookups treat the MCP bearer as a user JWT and 401 (caught live in E2E).
- **`endpoints/`** (component + org-service kinds): org endpoint catalog reading deployed Workloads; `OrgServiceURLEnv(name)` → `<UPPER_SNAKE>_URL`; single-owner access-request state machine (`requested → in_progress → granted`/`→ rejected`); HTTP `POST …/dependencies/{depName}/access-request` (201), `GET …/dependencies/access-requests`.
- **`resources/`** (external + platform-resource kinds): external value collection (secrets → SM-API/OpenBao `extres-<name>-<env>`, never the DB; value-backed per-org `ResourceType` + per-project `Resource` + per-env `ResourceReleaseBinding`); platform provisioner (discovers `ClusterResourceType`s, provisions a `Resource` + binding, async). HTTP `GET /dependencies/external-resources`, `DELETE …/{name}` (409 if in use), `POST …/{name}/values`, `POST …/dependencies/{depName}/provision` (202), `GET …/dependencies/{depName}/status` (masked outputs).

### 1.3 aep-api — design codec, read-time resolution, proceed-gate, spec pipeline, readiness watcher

- **`design.json` codec** (`c3ff3b2`, `6ff6f4e`): authored per-component file is now `design.json` (per-component `design.md` **removed**; prose → `description`). Strict decode rejects `status`/`reason`/unknown keys. Adds platform-owned blocks `exposesAPI`, `callerIdentity`, `componentAgentInstructions`.
- **Read-time resolution** (`6ef9213`): on every design read, org-service deps resolved 4-state against the **live** org endpoint catalog; external deps flagged `needs-spec`. Fail-open. Static `ExternalAPICatalog` deleted.
- **Proceed-gate** (`e3a67f0`): `POST /projects/{p}/design/save` (`SaveAndProceed`) returns **409** if any dependency is unresolved/blocked/ambiguous, naming component+dep+status. **Draft autosave never gated.** (The 409 flows through the generic error path — **not** modeled as a `409` response in the OpenAPI.)
- **Spec pipeline** (`1b359d8`, `e3a67f0`): SSRF-guarded HTTPS OpenAPI fetch → validate → normalize → store to draft; `POST …/dependencies/{depName}/spec`; auto-fetch on save; external-resource registration on generate/save; org-published durability (`exposesAPI.orgPublished` committed directly to `main` on grant, no new tag).
- **Resource readiness watcher** (`6f7f537`): claims `resource-provisioning` `component_tasks` rows in `building`, reads the OC binding's Ready condition, drives `resource.ready` / `resource.provision_failed` (30-min stale bound) **through the projector**.

### 1.4 aep-api — typed task graph, dispatch gating, contracts, OC client, teardown, migration

**Most coupled to the DB task model.**

- **Typed `ComponentTask`** (`1f1ac45`): one table, four kinds via `type` — `component`, `org-publish` (WORKER), `config-collection`, `resource-provisioning` (**SYSTEM, no GitHub issue**, resolved in the UI drawer). Three JSONB gate columns `depends_on_{external_resources,org_services,resources}` + single-target `external_resource_name`/`resource_name`.
- **Models:** unified `Dependency`, `ExternalResource` (org catalog), `AccessRequest` (`ProviderTaskID` → a `component_tasks` row).
- **Migration** `phase9_dependency_mgmt.go` (`5d2227c`): `CREATE external_resources`, `CREATE access_requests`, **`ALTER component_tasks`** (+6 columns). No `DROP`.
- **Generation + board** (`37ae86a`): `persistAndIssue` writes a `component` row per plan item + mints deduped SYSTEM rows (no issue). Board = GitHub Project board **joined** with `component_tasks` + a DB-only lane for issue-less rows. Access-reject hook on PR-closed-unmerged for `org-publish` rows.
- **3-way dispatch gating** (`53cca29`): `depsAllDeployed` blocks a task until every component/external-resource/resource dep maps to a `deployed` row (org-service gated at proceed, not dispatch). Sets `on_hold` / clears to `pending`.
- **Declarative-wiring comment (ADR-0004):** at dispatch the platform resolves all dep targets and **posts a "Platform-resolved dependencies" YAML block as a GitHub issue comment**; the coding agent copies it into `workload.yaml`. **The platform never patches the CR.**
- **Grant cascade** (`dispatch_cascade_hook.go`): on `deployed`, under a per-project advisory lock — trait/CORS sync, env-config re-emit, `GrantByProviderComponent`, re-dispatch held siblings. **Runner secrets** materialized via per-run `ExternalSecrets`.
- **Contracts events** (`0893544`, `23fb7c0`): `values.provisioned`, `provision.started`, `resource.ready`, `resource.provision_failed` + `EventCause` strings; **Projector is the sole status writer**, per-task advisory-locked.
- **OC Resource-model client** (`cf08846`): `resource_client.go` (RT/Resource/ResourceReleaseBinding CRUD, `ListClusterResourceTypes`, `ListWorkloadEndpoints`, release pinning) + `external_resource_type.go`. **Task-model-agnostic.**
- **Teardown** (`dcbb52b`): `DeleteProject` reads `component_tasks` to deprovision resources before purging rows.

### 1.5 agents service — upstream's parallel migration (overlaps ours, divergently)

- **Structured-output / prose route family** on `services/agents`, each reproducing an `agents-legacy` SSE contract for a **URL-swap cutover**: `architect` (`deef767`), `task-planner` (`/plan`+`/detail`, renamed from `techlead`, `09e6f67`/`28dceb9`), `document-generation` (`1808782`), `dsl-render` (`7b6ebe8`).
- **File-mutation `main` agent extensions (lands on ours):** unified `dependencies[]` Zod schema + **caller-supplied MCP discovery in `TurnRequest`** (`mcp:{url,token}`, `2a6ffd3`) + **shadow-guard** (`fe5d126`) + **`isError` surfacing** (`4c22d81`); `mcp-client.ts`.
- **`agents-legacy` kept alive** and brought to dependency parity (`b187ee2`, `09e6f67`). **(We deleted `agents-legacy`.)**
- **Skills:** `high-level-architecture/SKILL.md` rewritten for `dependencies[]` + "discover before you invent"; new `task-breakdown/SKILL.md` (vendored byte-identically into aep-api with a drift-guard test); repo-root Docker context; `services/agents` now needs `ANTHROPIC_API_KEY` at boot.

### 1.6 Frontend — `console-legacy` dependency UI

- **Four API clients** (`77d5b99`) under org-implicit `/dependencies/*`: `accessRequests.ts`, `externalResources.ts`, `provisioning.ts`, `specs.ts`. (`openapi.gen.ts` **not** regenerated — types hand-authored.)
- **Contract-exact types** + **cell-diagram edges** (`fbc8388`): `dependencies[]` drives sibling edges (`component`) and external chain-link nodes (`external`/`org-service`/`platform-resource`).
- **Dependency drawer + resolution panels** (`1b37c38`) under `pages/architecture/`: `DependenciesSection`, `DependencyDrawer`, `OrgServiceResolution`, `ExternalResourceValues`, `ProvideSpec`, `PlatformResourcePanel`. Old "Dependencies tab" retired.
- **Typed-task CTAs** (`e3da4dc`): `Task` gains `type`/`externalResourceName`/`resourceName`/three `dependsOn*` arrays; `TaskDetailPanel` SYSTEM-task CTAs; `TaskRow` gate aggregation; org-level `ExternalResourcesSettings` page. **Coupling flag:** retry (`componentTaskId`), SYSTEM task type, gate arrays, `AccessRequest.providerTaskId` all assume DB tasks.

### 1.7 `apps/console` — the newer console (coexists with console-legacy)

- **A newer console** (React 19 + TanStack + `@wso2/oxygen-ui` v0.11). **Correction:** upstream did **not** delete `console-legacy` — both `console-legacy/` and `apps/console/` coexist in upstream, and **upstream built the entire dependency UI inside `console-legacy`** (§1.6), not in `apps/console`. `apps/console` remains a thin shell (overview + read-only spec view). We **accept-theirs** for `apps/console` (we made only trivial changes to 2 files); the dependency work all lands in `console-legacy` (§1.6, Phase 7).
- **Project overview** (#77): `ProjectLayout`, `ProjectOverview`, three pipeline `StatusCards` from one `ProjectStatus` aggregate (**ADR-0006**), `ComponentsList`.
- **Spec view** (#80): full-screen `SpecView` off `GET /projects/{name}/spec` → `SpecBundle`; a **Build** button gated on presence of design files (**ADR-0007** — the design gate *is* the build trigger; no separate approve; currently UI-only).

### 1.8 Deployments / infra (required to run the feature)

- **OpenChoreo 1.0.1 → 1.1.1** — brings the Resource-model CRDs. Hard prerequisite.
- **CloudNativePG operator** (`b573350`) — Helm release `cnpg`, owns `postgresql.cnpg.io/v1 Cluster`.
- **`postgres-cnpg` `ClusterResourceType`** + RBAC (`single-cluster/postgres-cnpg-*.yaml`).
- **`workload-publisher-binding` ClusterAuthzRoleBinding** (`57cac31`).
- **Thunder security-gate handling** (`49e3536`, `8c14fbc`).
- **`docker-compose` / helm:** repo-root Docker context for `@aep/agents`, `ANTHROPIC_API_KEY` at boot, new `AEP_API_INTERNAL_BASE_URL`.

### 1.9 HTTP contract (`packages/contracts/api/v1/openapi.yaml`), +773/−32

- **9 new paths** + `GET /projects/{name}/spec` (`SpecBundle`).
- **18 new schemas** — `Dependency` (replaces `DependentAPI`), `DependencyCandidate`, `ConfigKey`, `DependencyStatusOutputBody`, `ExternalResourceDTO`/`ConfigKeyDTO`/`Consumer`, `AccessRequest`, provision/save/collect in/out bodies, `SpecBundle`/`SpecFile`.
- **Modified schemas** — `ComponentTask`/`BoardTask` gain typed-task fields (`type` now **required**); `Design`/`DesignComponent` swap `dependsOn`/`dependentApis` → `dependencies` (+`description`/`exposure`/`version`); `Component` gains `endpointUrl`; `ExposesAPI` gains `orgPublished`; `ProjectStatus` gains `specVersion`/`specDirty`/`deployedVersion`/`deployStatus`.
- **Breaking removals (collide with our #72 handshake):** `CreateProjectRequest.prompt`, `ProjectList.nextCursor`, `list-projects` `search` param — all **removed** upstream.
- **Not in the contract:** the proceed-gate 409 (generic error path), the MCP server (`/internal/v1/mcp`), the platform-resource catalog.

### 1.10 Docs & ADRs

- **ADR-0003** — dependency status computed at read time, never persisted. **ADR-0004** — dependency wiring authored by the coding agent (declarative-wiring comment), never patched by the platform.
- `docs/glossary.md` + `CONTEXT.md` "Dependency management" block; `services/aep-api/design/dependencies.md`.
- `apps/console` **ADR-0006** (status aggregates extend `ProjectStatus`) + **ADR-0007** (design gate = build trigger).

---

## 2. Overlap with what we've already done

PR #85 re-does several things our branch already did — by a different route.

| Area | Upstream (PR #85) | Our branch (`rewrite-improve`) | Verdict |
|---|---|---|---|
| **Agent-service migration** | Structured-output agents (`architect`/`task-planner`/`document-generation`/`dsl-render`), URL-swap parity, `agents-legacy` **kept**. | Single **file-mutation `main` agent** + **committed-truth**; `agents-legacy` **retired**. | **Overlap, divergent. Keep ours.** |
| **File-mutation `main` agent** | Exists; taught `dependencies[]` + MCP **additively** (not the generation path). | Exists; **is** the generation path. | **Overlap, compatible.** Take upstream's *additions*. |
| **`connections[] → dependencies[]`** | Renamed everywhere. | Still `connections[]` (http/datastore/connector). | **We're behind. Adopt.** |
| **Task model** | DB-backed typed graph; `component_tasks` **extended**; issue-less SYSTEM rows; DB status projector; 3-way gating over DB status. | GitHub-native; Task = issue + machine block; executions-only DB; `component_tasks` **dropped**; `aep:hold`/`aep:execute` labels. | **Overlap, hard conflict. Keep ours; re-express gates.** |
| **Task planning** | Structured `task-planner` (streamObject) + BFF cutover. | GitHub-native `plan.go` + `plan_tap` mid-stream tap. | **Overlap, divergent. Keep ours.** |
| **Board** | GitHub board **joined** with `component_tasks` + DB-only SYSTEM lane. | GitHub-native board. | Keep ours; add gate lane differently. |
| **Committed-truth / shared-volume** | Absent (drafts + structured architect). | Present. | **Ours only. Keep.** |
| **Console** | Both `console-legacy/` **and** `apps/console/` exist; dependency UI built **in `console-legacy`**. | `console-legacy` island (+ trivial `apps/console` edits). | **Merge their console-legacy into ours**; **accept-theirs** `apps/console` (§5 Phase 7). |
| **OpenAPI #72 handshake** | **Removes** `prompt`/`search`/`nextCursor`. | **Added** those three. | **Direct collision. Keep ours.** |
| **Dependency-management domain** | Full feature. | **None.** | **Net-new. Take.** |

**Bottom line:** do **not** re-import upstream's agent-service migration (`deef767`/`1808782`/`28dceb9`/`7b6ebe8`/`09e6f67`/`b187ee2`) — it exists only to preserve the legacy contract during a URL-swap we already superseded. **Do** adopt the additive `main`-agent pieces (`2a6ffd3`/`fe5d126`/`4c22d81`). Do **not** adopt the `component_tasks` `ALTER`.

---

## 3. Categorization: TAKE / ADAPT / KEEP / SKIP / RECONCILE

### 3.1 TAKE — port largely as-is (net-new, foundation-neutral)

1. **`dependencies[]` schema + the whole rename** (agent-stream schema, wire contract, `@aep/design-projection`, `high-level-architecture/SKILL.md`, main-agent validator, `exposesAPI.orgPublished`).
2. **The `internal/feature/dependencies/` feature** (MCP server + `endpoints/` + `resources/`). Only its *callers* touch `component_tasks` (adapted in §3.2).
3. **OC Resource-model client** (`resource_client.go`) + `external_resource_type.go` + mocks. Task-model-agnostic.
4. **MCP discovery into the `main` agent turn** — `mcp-client.ts`, `TurnRequest.mcp`, shadow-guard, isError + the BFF-side `aep-api-mcp` token minter.
5. **Read-time resolution + proceed-gate** (reconciled with committed-truth — §5 Phase 5).
6. **Spec pipeline** — SSRF-guarded fetch, `StoreConsumedSpec`, `collect-dependency-spec`, auto-fetch-on-save.
7. **External-resource registry + registration-on-save** + the `external_resources` and `access_requests` tables (new tables, no conflict).
8. **Declarative-wiring comment (ADR-0004)** — already posts a GitHub issue comment; only its trigger reads a `component_tasks` row (re-key).
9. **Deployments/infra** — OC 1.1.1, CNPG operator, `postgres-cnpg` CRT + RBAC, Thunder gate handling, workload-publisher binding, `AEP_API_INTERNAL_BASE_URL`.
10. **Docs/ADRs** — ADR-0003, ADR-0004, glossary/CONTEXT, `dependencies.md`.
11. **FE dependency UI** — clients, drawer, panels, settings, cell-diagram edges (minus typed-task CTA coupling — §3.2).

### 3.2 ADAPT — re-express on our foundations (task-coupled)

Recurring problem: upstream answers "is dep X ready?" / "where does a gate live?" by reading a `component_tasks` row. We have none. **The resolved design (§3.6) re-bases each of these onto `aep:provision` GitHub issues + a `provision` Execution kind + our funnel gate — no SYSTEM rows, no projector, no gate table.** The list below maps each upstream construct to its home on our model:

1. **The two SYSTEM gate kinds** (`config-collection`, `resource-provisioning`) → **`aep:provision` GitHub issues** (§3.6), one per external/platform-resource dep, deduped per project. Resolved by a platform/user action, not the coding agent; closed with a no-secrets reference.
2. **3-way dispatch gating** (`depsAllDeployed`) → extend the funnel's existing **`depsGate`** to be dependency-kind-aware: a consumer coding task holds until its resource-dep `aep:provision` issues derive ready (uniform with how `depsGate` already holds on `dependsOn` component deps).
3. **Status projector + contract events** → **dropped.** Provisioning status is **derived** (`deriveStatus` over the issue + its `provision` Execution), matching our read-time model; the readiness watcher's completion calls `Reevaluate` (the existing build-success/unhold hook) to release held tasks.
4. **Readiness watcher** → a new watcher cloned from the build-success watcher, polling the OC `ResourceReleaseBinding` `Ready` condition, `Finish`ing the `provision` Execution and closing the issue with a reference.
5. **Access-request ↔ provider linkage** (`AccessRequest.ProviderTaskID`) → re-key to the provider **org-publish `aep:provision` issue** number/URL.
6. **Grant/reject cascade + reject hook** → fire on our deploy/webhook signals; grant commits the `orgPublished` marker and closes the org-publish issue **with the commit SHA**; reject closes it unmerged.
7. **`ExternalResource.Consumers`** → scan design artifacts (`dependencies[]` of kind `external`) instead of JSONB-querying `component_tasks`.
8. **Teardown on project delete** → enumerate OC `Resource`s by `spec.owner.projectName` (+ close any open `aep:provision` issues) instead of reading `component_tasks`.
9. **Board SYSTEM lane** → `aep:provision` issues are ordinary issues, so they appear on our GitHub-native board natively (distinguished by the class label) — no special lane needed.
10. **FE typed-task CTAs** (`TaskDetailPanel`, `TaskRow`) → the "Provide configuration / Provision resource" CTAs live in the architecture drawer (Phase 7), driven by the design's `dependencies[]` + live resolution + the `aep:provision` issue status.

### 3.3 KEEP — ours; do **not** adopt upstream's counterpart

1. **Committed-truth generation + shared-volume clone.**
2. **GitHub-native task model** (Task = issue, executions-only DB, `component_tasks` dropped).
3. **Single file-mutation `main` agent as the generation path** (do **not** add the structured-output route family).
4. **`agents-legacy` retirement.**
5. **Our #72 contract additions** (`prompt`/`search`/`nextCursor`).

### 3.4 SKIP — do not port

1. Upstream's `services/agents` structured-output routes (`deef767`/`1808782`/`28dceb9`/`7b6ebe8`).
2. `agents-legacy` parity commits (`b187ee2`/`09e6f67`).
3. The `component_tasks` `ALTER` migration step.
4. Board-join-with-`component_tasks` logic.

### 3.5 RECONCILE — explicit collisions

1. **`component_tasks` migration** — take the two `CREATE`s (`external_resources`, `access_requests`); **drop** the `ALTER component_tasks` step entirely (no gate columns — gates live on `aep:provision` issues per §3.6).
2. **OpenAPI** — cherry-pick 9 paths + 18 schemas + additive fields; **do not** take the `prompt`/`search`/`nextCursor` removals; hand-merge (spec-first-regen hazard), then regen TS.
3. **`ComponentTask`/`BoardTask` shapes** — do **not** adopt upstream's `type`-required + gate-array columns; instead surface a task's unmet resource-dep gate reasons through our **derived** task read model (`reads.go`/`deriveStatus`).
4. **Console** — **accept-theirs** on `apps/console` (our 2 edits are trivial); **merge** upstream's `console-legacy` dependency UI into ours (net-new files clean; 7 shared files need conflict resolution — §5 Phase 7). No "which console" decision — both are taken, each its own way.

---

### 3.6 Resolved design — the provisioning-as-issues model (grilling, 2026-07-06)

**Decision.** Upstream's issue-less **SYSTEM task rows + projector + `component_tasks` ALTER** exist to do — in a DB task graph — what our **funnel gate + read-time `deriveStatus`** already do natively. So we do **not** port them. Instead:

- **`aep:provision`** — a **new executor class** (sibling to `aep:coding`), routed by the funnel's `registry.Lookup(class)` to a *provisioner* executor, **not** the coding agent. Config-collection, resource-provisioning, and org-publish gate work each become an **ordinary GitHub issue** in this class, carrying a machine block (`GateKind` + the resource/param facts) but **no secret values**.
- **`provision`** — a **new Execution `Kind`** (alongside `coding`/`build`/`ops`), so a provisioning run reuses `TryAdmit`/`Finish`/retry/progress. Triggered through the funnel by a drawer action (values/params), never auto-dispatched (it needs human input first).
- **Gate** — the funnel's existing `depsGate` is extended to be dependency-kind-aware: a consumer coding task holds until its `external`/`platform-resource` deps' `aep:provision` issues **derive ready**. `Reevaluate` (the existing build-success/unhold hook) releases held tasks; a **readiness watcher** (cloned from the build watcher) polls OC bindings and closes the provision issue on `Ready`.
- **Close with a reference, no secrets** — on success the platform comments the reference and closes: a **commit SHA** when we committed something declarative (org-publish marker), an **OC resource/binding name** when the artifact lives in OpenChoreo. Secrets always go to **SM-API/OpenBao**; only paths/names appear in issues/API responses.
- **Status is derived**, never persisted (`deriveStatus`) — no projector, matching ADR-0003's spirit at the task layer.

**Worked flow** — project `storefront`: `web` (web app) → `orders`; `orders` (service) → `orders-db` (platform-resource `postgres-cnpg`), `stripe` (external), `inventory` (org-service from project `warehouse`).

1. **Design** (committed-truth, file-mutation `main` agent). The agent calls MCP discovery (`list_platform_resource_types` / `list_external_resources` / `list_org_endpoints`) first, then authors `orders/design.json` `dependencies[]` with the three deps. Auto-commits to `main`; **no `status`/`reason` on disk**.
2. **Read-time resolution** (architecture view): `orders`→resolved; `stripe`→resolved-needs-values; `orders-db`→unresolved (provisioned post-approval); `inventory`→resolved or blocked/access-required.
3. **Proceed / approve** = our `SaveAndProceed` cutting the `v<N>-<M>` **tag**. Proceed-gate (409) blocks only on **org-service unreachable** and **external needs-spec** (Phase 5). `orders-db`/`stripe`-values are **not** proceed-blockers.
4. **Planning** mints coding issues (`#10 orders` [`aep:coding`, DependsOn=[orders-db, stripe]], `#11 web` [DependsOn=orders]) **and** provisioning issues (`#12 orders-db`, `#13 stripe`, both `aep:provision`, deduped per project). `#10` holds in the funnel until `#12`/`#13` derive ready.
5. **Provisioning** (drawer CTA → funnel → provisioner executor): user provides `stripe` values → secrets to SM-API + OC external RT/Resource/binding → `provision` Execution → close `#13` with binding reference. User confirms `orders-db` params → OC `Resource`+binding (async) → readiness watcher observes `Ready` → close `#12` with the OC binding reference. Each close fires `Reevaluate`.
6. **Release + dispatch + wiring**: `Reevaluate` clears `#10`'s gate → dispatch to coding agent. At dispatch the platform posts the **ADR-0004 "Platform-resolved dependencies" comment** on `#10`; the coding agent copies it into `orders/workload.yaml` → PR → build → deploy.
7. **org-service**: if `inventory` is project-only, "Request access" creates an access-request + a provider-side `aep:provision` (org-publish) issue on `warehouse`; on publish the platform **commits** the `exposesAPI.orgPublished` marker and closes the issue **with the commit SHA**; access flips to `granted`; `storefront`'s proceed-gate passes.

**Mapping to existing seams:** class → `aep:provision` label + `registry.Lookup`; run → `Kind: provision` Execution; gate → extended `depsGate`; release → `Reevaluate`; readiness → build-watcher clone; status → `deriveStatus`; audit → reply-with-reference-then-close.

---

## 4. Integration strategy — **git merge, not rebase**

We integrate upstream's PR by **merging** `upstream/aep-rewrite` into our line, producing a **merge commit with `upstream/aep-rewrite` as the second parent**. We do **not** rebase our commits onto upstream.

**Why merge, not rebase:**
- **Provenance** — the merge commit records that PR #85 was integrated, so future `git merge upstream/aep-rewrite` pulls see the advanced common ancestor and **stop re-surfacing these 323 files**. A rebase would rewrite our history, hide the relationship, and make every future upstream sync re-conflict.
- **Our history is public/shared** (`rewrite-improve` on `origin`) and large; rebasing it is destructive and rewrites shared commits.
- The divergence is deep and **resolved by keeping ours** in the task/agent/#72 areas — merge semantics express that cleanly (a merge commit that documents "took theirs for the dependency feature, kept ours for tasks/agents/contract").

**Branch topology:**
```
rewrite-improve ──●──────────────────────●  (integration branch: feat/dependency-management)
                   \                     /
upstream/aep-rewrite ●───────────────── ●   (merged in — second parent, Phase 2; platform bumped in Phase 1 first)
```

**Grounded conflict-resolution posture (drives the Phase 2 merge — verified against the real divergence).** Five postures: **keep-ours** (resolve conflict to ours), **take-theirs** (accept upstream, mostly net-new), **skip-delete** (`git rm` upstream's net-new file after the merge — won't compile / not wanted), **resolve-union** (both changed a shared file; keep both intents), **take-theirs-EDIT** (accept then hand-trim).

- **keep-ours — WHOLESALE on the rebuilt packages:** the **entire** `internal/feature/{codingagent,task,execution}` and `internal/contracts/taskmeta/**` (our GitHub-native dispatch core; `execution/` and `taskmeta/` are ours-only, nothing to merge). Conflicting shared files (`codingagent/{dispatcher,ports,watcher,…}.go`, `task/{errors,ports,task_huma,…}.go`, `project/project_service.go`) resolve to ours. Also `packages/contracts/api/v1/openapi.yaml` (keep our `#72` `prompt`/`search`/`nextCursor`; don't take upstream's `ComponentTask.type`-required). **Temporarily keep-ours** (grafted onto later, not re-resolved from scratch): `internal/feature/{design/design_service.go, design/design_huma.go, artifacts/artifact_store.go}` (Phase 5), and console `services/api/types.ts` (its task-coupled half → Phase 7).
- **skip-delete (`git rm` after merge — cannot compile on our model / not wanted):**
  - all upstream net-new `codingagent/` files: `resource_watcher.go`, `dispatch_service.go`, `dispatch_cascade_hook.go`, `build_watcher.go`, `on_hold_watcher.go`, `coding_agent_watcher.go`, `progress_service.go`, `workflowrun_service.go` (+ their `*_test.go`) — all `component_tasks`-based; **capability re-implemented in Phase 6**.
  - all upstream net-new `task/` files: `projector.go`, `board_service.go`, `board_huma.go`, `task_service.go`, `task_stream.go`, `handlers.go`, `planner_skill.go`, `task_design.go`, `task_diff.go` (+ tests).
  - `models/{component_task.go, tasks.go}` (we deleted them → keep deleted; `tasks.go` is a hidden-breaker sibling), `internal/contracts/{dispatch,hooks,task_state}.go` (we deleted → keep deleted; the `contracts.TaskEvent` seam is re-expressed on `taskmeta` in Phase 6).
  - `services/agents-legacy/**` (retired → keep deleted); `services/agents/src/agents/{architect,taskplanner,document-generation,dsl-render}/**` (structured-output routes we skip).
- **take-theirs (net-new, clean adds):** `internal/feature/dependencies/**` **agnostic subset** (MCP server/tools, catalogs, `naming`, `external_provisioner`, `platform_provisioner`, `resources_huma`, `endpoints/access_*`), `internal/clients/openchoreo/{resource_client,external_resource_type}.go`, `models/{external_resource,access_request,design,component}.go`, `internal/feature/artifacts/{design_json,spec_collect,commit_design_file}.go`, `packages/design-projection/*`, `console-legacy/.../services/api/{accessRequests,externalResources,provisioning,specs}.ts` + `pages/architecture/*` + `pages/ExternalResourcesSettings.tsx`, `deployments/single-cluster/postgres-cnpg-*.yaml`, `docs/**`, `skills/**`, and **accept-theirs `apps/console/**`** (our 2 edits are trivial).
- **take-theirs-EDIT:** `internal/database/migrations/phase9_dependency_mgmt.go` — keep the two `CREATE TABLE` steps (`external_resources`, `access_requests`); **strip the `ALTER component_tasks` columns step** (that table is dropped — would fail at runtime). `internal/feature/dependencies/resources/{ports.go}` — **trim out** the `TaskCompleter`/`RedispatchFunc`/`TaskStore` interfaces (their only callers, `external_values.go` + `resources_service.go`, are git-rm'd until Phase 6).
- **resolve-union (both changed — keep both):** `internal/database/migrations/run_all.go` (our registrations + the edited phase9), `internal/app/app.go` (wire only the agnostic dependency ports in Phase 4), `internal/contracts/progress.go`, `deployments/docker-compose.yml` + `helm .../aep-api/deployment.yaml` (**keep our agents block**, re-assert `AEP_API_INTERNAL_BASE_URL` — do **not** take upstream's agents-service/agents-legacy context), and the console-legacy shared files `{App.tsx, ProjectArchitecturePage.tsx, package.json, pnpm-lock.yaml}`.

> The Phase 2 merge is the **sole known-red checkpoint** — but it still **resolves every conflict to commit** (a merge cannot be committed half-resolved). "Temporarily keep-ours" files are committed as ours and *grafted onto* in later phases; skip-deleted files are `git rm`'d before the commit. The integration branch stays **off the main line** until §6 passes. If you need a green merge commit instead, see §7 (`-s ours`).

---

## 5. Phased plan

Each phase: **Goal → Work checklist → Verify against the PR workspace → Exit criteria.** The "PR workspace" is a **read-only worktree at the upstream tip**, created once in Phase 0 and used by every phase to confirm parity (for TAKE), behavioral equivalence (for ADAPT), or intentional divergence (for KEEP).

### Phase 0 — Pre-flight: clean tree, PR workspace & integration branch (NO merge) · 🟢 green

**Goal:** reach a clean, mergeable tree and stand up the two fixtures every later phase needs — the read-only PR workspace (the parity oracle) and the integration branch — without touching a single upstream byte. **No merge yet** (the platform bump, Phase 1, must run first).

**Work checklist:**
- [ ] Commit or set aside the ~26 untracked `docs/` files (incl. this doc) so the working tree is clean (the tracked tree is already clean/mergeable).
- [ ] `git fetch upstream` — confirm `upstream/aep-rewrite` at `1076be7`.
- [ ] Create the **PR workspace** (read-only parity oracle, used by every phase): `git worktree add ../aep-pr-workspace upstream/aep-rewrite`.
- [ ] Create the **integration branch** off our line: `git switch -c feat/dependency-management rewrite-improve`.

**Verify:**
- [ ] `git status` clean; `git worktree list` shows the pinned `../aep-pr-workspace`; current branch is `feat/dependency-management`.

**Exit criteria:** clean tree; PR workspace + integration branch up; no upstream bytes taken.

---

### Phase 1 — PRE-MERGE platform bump (OpenChoreo 1.1.1 + CNPG + Thunder) + full auth-inclusive regression · 🟢 green

**Goal:** land ONLY the `deployments/` infra upgrade onto the clean branch and prove our EXISTING stack (project/design/tasks/build/deploy + auth) is fully green on OC 1.1.1 with **zero dependency-feature code present**. That precondition is only satisfiable **before the merge** — so this runs pre-merge and is the last phase before the merge, making any post-merge red unambiguously feature code, never the OC upgrade. The feature needs 1.1.1's Resource-model CRDs, so the bump is non-optional; the isolation is the risk control.

**Work checklist:** (cherry-pick just these files from the PR workspace — do **not** merge)
- [ ] `deployments/scripts/env.sh` — `OPENCHOREO_VERSION` `1.0.1-hotfix.1` → **`1.1.1`** (match upstream exactly — the `postgres-cnpg` CRT + provisioner code target 1.1.1's Resource-model API shape).
- [ ] Thunder security-gate handling (`setup-thunder-client.sh`) — bootstrap-probe + `THUNDER_SKIP_SECURITY` flip (**touches our one-shared-Thunder topology + gateway keymanager**).
- [ ] `workload-publisher` `ClusterAuthzRoleBinding` re-assert (`setup-aep.sh`).
- [ ] CNPG operator (`setup-prerequisites.sh`) + `single-cluster/postgres-cnpg-{resourcetype,rbac}.yaml`.
- [ ] `AEP_API_INTERNAL_BASE_URL` (compose + helm). **KEEP-ours:** do **not** inherit upstream's boot-time `ANTHROPIC_API_KEY` requirement — our agents service builds the model per-turn from `X-Anthropic-Key`.
- [ ] **Full fresh-cluster regression e2e, feature code absent:** teardown → setup → start → `seed-dev.sh`; project create → design generate (committed-truth) → tasks plan/dispatch → build → deploy; **and auth: login, M2M, impersonation, gateway keymanager**.

**Verify against the PR workspace:**
- [ ] `diff` our `setup-thunder-client.sh` + `postgres-cnpg-*.yaml` vs the workspace — parity.
- [ ] CNPG operator Running; `postgres-cnpg` `ClusterResourceType` present + `readyWhen` CEL applied.
- [ ] Regression e2e **green with zero dependency-feature code** — the platform upgrade alone did not regress project/design/tasks/build/deploy **or auth**; agents service boots keyless.

**Exit criteria:** OC 1.1.1 + CNPG + Thunder + workload-publisher live; existing flows + auth fully green on the upgraded platform. Only now perform the merge (Phase 2).

---

### Phase 2 — The merge (sole known-red checkpoint) · 🔴 red-expected

**Goal:** run `git merge upstream/aep-rewrite` onto the proven-green platform and mechanically resolve **every** conflict per the §4 grounded posture. A merge cannot commit half-resolved — so temporarily-keep-ours files are committed as ours and grafted onto later; skip-deleted files are `git rm`'d before the commit.

**Work checklist:**
- [ ] `git merge --no-ff --no-commit upstream/aep-rewrite`; record the conflict inventory (`git diff --name-only --diff-filter=U`) into §8.
- [ ] **keep-ours WHOLESALE:** entire `internal/feature/{codingagent,task,execution}` + `internal/contracts/taskmeta`; conflicting shared files there + `project/project_service.go`; `openapi.yaml` (#72 fields). **Temporarily keep-ours** (grafted onto in Phases 5/3): `design/{design_service,design_huma}.go`, `artifacts/artifact_store.go`, console `services/api/types.ts`.
- [ ] **skip-delete (`git rm`):** all upstream net-new `codingagent/` files (`resource_watcher`, `dispatch_service`, `dispatch_cascade_hook`, `build_watcher`, `on_hold_watcher`, `coding_agent_watcher`, `progress_service`, `workflowrun_service`, +tests); all upstream net-new `task/` files (`projector`, `board_service`, `task_service`, `task_stream`, `handlers`, `planner_skill`, `task_design`, `task_diff`, +tests); `models/{component_task,tasks}.go`; `contracts/{dispatch,hooks,task_state}.go`; `services/agents-legacy/**`; `services/agents/src/agents/{architect,taskplanner,document-generation,dsl-render}/**`.
- [ ] **also `git rm` the two task-coupled `resources` files** (rebuilt in Phase 6): `dependencies/resources/{external_values.go, resources_service.go}` (+tests) — they reference the deleted projector/`TaskEvent`.
- [ ] **take-theirs-EDIT:** `migrations/phase9_dependency_mgmt.go` — keep the two `CREATE TABLE`s, **strip the `ALTER component_tasks` step**; `dependencies/resources/ports.go` — **trim out** the `TaskCompleter`/`RedispatchFunc`/`TaskStore` interfaces (their only callers are the two files git-rm'd above).
- [ ] **resolve-union:** `migrations/run_all.go`, `app.go`, `contracts/progress.go`, `deployments/docker-compose.yml` + helm `aep-api/deployment.yaml` (**keep our agents block**, re-assert `AEP_API_INTERNAL_BASE_URL`; these RE-conflict — do not auto-resolve), console `{App.tsx, ProjectArchitecturePage.tsx, package.json, pnpm-lock.yaml}`.
- [ ] `git commit` the merge (second parent = `upstream/aep-rewrite`).

**Verify against the PR workspace:**
- [ ] `git log --merges -1 --format='%P'` shows two parents, the second `1076be7`.
- [ ] `ls services/agents/src/agents/` shows `main` only; `services/agents-legacy` absent; `git grep -n component_tasks -- services/aep-api` returns nothing in code (only migration-drop history).
- [ ] `git grep -n 'CreateProjectRequest' -- packages/contracts/api/v1/openapi.yaml` still shows our #72 `prompt`.

**Exit criteria:** one merge commit on `feat/dependency-management`; conflict inventory logged; skip-list gone; #72 retained. Tree is **red** (expected) — brought green over Phases 3–4.

---

### Phase 3 — Schema & contracts: `connections[]`→`dependencies[]` + additive OpenAPI · 🟡 TS green / Go red

**Goal:** migrate the `dependencies[]` vocabulary across the TS/contract side + land the additive OpenAPI, no #72 regressions. Upstream's contract sources were OUR-deleted (re-homed to `@aep/agent-stream`), so this is **port-into-new-home**, not resolve-in-place. Brings `packages/*` + `services/agents` **and console-legacy** typecheck green; the aep-api Go build stays red until Phase 4. Vocabulary only.

**Work checklist:**
- [ ] `packages/agent-stream/src/component-design-schema.ts` — `connections` → `dependencies` (4 kinds, `ConfigKey`, `candidates`); update the drift-guard type. Re-home upstream's deleted `component-design.ts` / zod / `McpConfig` content here.
- [ ] `packages/design-projection/src/project-design.ts` — `connections()` → `dependencyEdges()` + `DEP_KIND_EDGE`.
- [ ] `skills/high-level-architecture/SKILL.md` — `connections` → `dependencies` block + "discover before you invent"; re-sync any vendored copy.
- [ ] `main` agent authoring validator (Zod) accepts `dependencies[]`; add `exposesAPI.orgPublished` where authored.
- [ ] OpenAPI: hand-merge the **9 paths + 18 schemas** + additive fields (`exposesAPI.orgPublished`, `Component.endpointUrl`, `ProjectStatus.*`, `Design.dependencies`); **keep** `prompt`/`search`/`nextCursor`; **omit** upstream's `ComponentTask.type`-required. Regen TS clients (spec-first flow, not `make openapi` clobber) → `openapi.gen.ts`.
- [ ] **console-legacy `services/api/types.ts` — VOCABULARY half NOW** (graft onto the kept-ours file): add `Dependency`/`DependencyKind`/`ConfigKey`/`DependencyCandidate`; switch `DesignComponent` to `dependencies[]`, drop `dependsOn`/`dependentApis`. *(The task-coupled `Task` gate fields stay for Phase 7.)* Without this the take-theirs dep-UI pages + `buildProjectModel` don't typecheck.
- [ ] `make typecheck` green for `packages/*`, `services/agents`, **and console-legacy**.

**Verify against the PR workspace:**
- [ ] `diff` our `Dependency` shape + `DEP_KIND_EDGE` vs workspace — kinds/fields match.
- [ ] OpenAPI: every dependency schema present; `prompt`/`search`/`nextCursor` **only** differ (intentional).
- [ ] console-legacy typechecks (the merged-in `pages/architecture/*` + `buildProjectModel` compile against the new `types.ts`).
- [ ] No `connections` token: `git grep -ni 'connections\b' -- packages services/agents skills` = comments/history only.

**Exit criteria:** vocabulary migrated; TS side (packages + agents + console-legacy) typecheck green; OpenAPI parity except the 3 intentional #72 retentions. (Go still red — Phase 4.)

---

### Phase 4 — `dependencies/` agnostic subset + OC client — REAL adapters, provisioning inert · 🟢 green

**Goal:** bring **aep-api Go green** by wiring the net-new, task-model-**agnostic** dependency backend. The task-coupled ports were **trimmed** at the merge and their two caller files git-rm'd — so there is **nothing to stub**; the build is green by **absence of consumers**, and the provisioning HTTP routes **nil-guard to 503** until Phase 6. (Upstream itself passes `RedispatchFunc` as nil and never stubs these — no stub layer is warranted.)

**Work checklist:**
- [ ] OC client: `internal/clients/openchoreo/{resource_client,external_resource_type}.go` + mocks compile and pass unit tests.
- [ ] `internal/feature/dependencies/**` **agnostic subset** present: MCP server/tools, `endpoints/` (catalog, naming, access), `resources/` provisioner cores (`external_provisioner`, `platform_provisioner`, `platform_catalog`, `naming`) + `resources_huma` — **routes nil-guard to 503** (`ValueService`/`ResourceService` are NOT wired; rebuilt in Phase 6).
- [ ] `models/{external_resource,access_request}.go` + the two repositories; edited `phase9` migration (`external_resources` + `access_requests` only, no ALTER).
- [ ] BFF `aep-api-mcp` token minter + `AgentsScopedVerifier` (aud check) + `/internal/v1/mcp` mount.
- [ ] `app.go` — wire **ONLY the agnostic ports with REAL adapters** (`DesignReader` over `ArtifactStore`, `ExternalResourceRegistry`=repo, `SecretWriter`=`SMAPIWriter`, catalogs, `ResourceClient`, MCP surface). **No stub adapters** — the trimmed `TaskCompleter`/`RedispatchFunc`/`TaskStore` ports have no callers here.
- [ ] `make build test lint typecheck` **green** across Go + TS.

**Verify against the PR workspace:**
- [ ] `git diff HEAD ../aep-pr-workspace -- internal/clients/openchoreo/resource_client.go` empty; the agnostic dependency files match (modulo the trimmed ports).
- [ ] `git grep -n 'TaskCompleter\|RedispatchFunc\|TaskStore' -- internal/feature/dependencies` returns **nothing** (ports trimmed; consumers rebuilt in Phase 6).
- [ ] MCP surface answers `tools/list` with the four discovery tools; provisioning routes return **503** (inert, by design).

**Exit criteria:** aep-api green; MCP discovery + catalogs live; provisioning deliberately inert (503); no stub code exists.

---

### Phase 5 — Design-time read-resolution, proceed-gate & main-agent MCP discovery · 🟢 green

**Goal:** authored `dependencies[]` resolve 4-state at read time (fail-open); the proceed-gate fires at the `SaveAndProceed` tag-cut; specs collect (SSRF-guarded); the file-mutation `main` agent discovers over MCP during generation. Stays green — no provisioning yet.

**Work checklist:**
- [ ] **Graft** upstream's `resolveOrgServices` 4-state read-resolution + the `design.json` codec onto our **temporarily-kept-ours** `artifacts/artifact_store.go` + `design/design_service.go` (hand-merge upstream's logic onto our committed-truth versions — do NOT resolve-from-scratch). `OrgServiceResolver` = the endpoints catalog.
- [ ] Spec pipeline: SSRF-guarded fetch + `StoreConsumedSpec` + `collect-dependency-spec` route (graft onto our `design_huma.go`) + auto-fetch-on-save.
- [ ] External-resource registration on generate/save (`Upsert` into the org catalog).
- [ ] **Proceed-gate** in `design_service.SaveAndProceed` (our tag-cut; already 409s via `ErrSpecNotApproved` + runs `ReconcilePendingForDesignChange`). Add `ErrUnresolvedDependency` → 409 from read-time resolution over the design being tagged. **Block set:** only **org-service unreachable** + **external needs-spec**; external-values / platform-resource are **dispatch**-gated (Phase 6). Never gate the per-turn autosave — only the tag-cut.
- [ ] `main` agent turn: MCP discovery (`mcp:{url,token}` on `TurnRequest`, `mcp-client.ts`, shadow-guard `{...mcpTools, ...baseTools}`, `isError` → tool-error); BFF passes the minted MCP block on the generation turn.
- [ ] Evals/tests for resolution + gate + discovery green.

**Verify against the PR workspace:**
- [ ] `diff` our `resolveOrgServices` states/reasons vs workspace `artifact_store.go`; `diff` `mcp-client.ts` + shadow-guard vs workspace.
- [ ] Behavioral: tagging a design with an unresolved org-service dep (or external needs-spec) returns **409** naming component+dep+status; external-values/platform-resource do **not** block the tag.
- [ ] Behavioral: during generation the agent calls `list_external_resources` before inventing an external dep.

**Exit criteria:** read-resolution + tag-time proceed-gate + spec collect + MCP discovery working; agnostic parity confirmed; still green.

---

> ## ⏸️ COMPACTION CHECKPOINT — stop here before Phase 6
>
> **Reached when:** Phase 5 has exited green (read-resolution + proceed-gate + MCP discovery working, tree green), immediately **before** starting Phase 6.
> **Why here:** Phase 6 is the crux and the heaviest phase (provisioning-as-issues, funnel gates, declarative wiring — the §3.6 rebuild). Compacting at the 5→6 boundary hands Phase 6 a fresh, near-empty context budget. Both Phase 4 and Phase 5 exit on a **green** tree, so the resume state is clean and cheap to summarize.
> **Fallback:** if context passes ~75% during Phase 4 or 5, compact at the nearest green boundary instead — **end of Phase 4** (whole tree green, provisioning inert at 503) — rather than pushing into a nearly-full window.
>
> **Compaction notes — fill in when reached (delete this italic line):**
> - _Current commit / tree state (SHA, branch, green/red):_
> - _Phases done vs remaining; what's green, what (if anything) is red and why:_
> - _Open threads / TODOs carried into Phase 6 (e.g. `external_resource_repository.Consumers` still on `component_tasks` → design-scan; deferred runner-image repin; `coding_agent_logs` migration):_
> - _Anything discovered in Phases 4–5 that changes the Phase 6 plan (§3.6 seam surprises, `depsGate`/`Reevaluate` realities, funnel/`taskmeta` gotchas):_
> - _PR-workspace parity notes still owed:_

---

### Phase 6 — Provisioning-as-issues + funnel gates + declarative wiring — the crux · 🟢 green

**Goal:** implement the §3.6 model on our funnel/issue substrate and **replace the inert provisioning** with real behavior. **Rebuild** the task-coupled files git-rm'd at the merge (do NOT resurrect upstream's) and **fold in declarative wiring** (posted at dispatch, which this phase rebuilds, and resolves OC outputs that exist only after provisioning). No SYSTEM rows, projector, or gate table.

**Work checklist:**
- [ ] **`aep:provision` executor class** (`taskmeta`): new class label sibling to `aep:coding`; machine block gains `GateKind` (`config-collection`/`resource-provisioning`/`org-publish`) + resource/param facts — **no secret values**.
- [ ] **`provision` Execution kind** (`taskmeta` + `execution/model.go`): rides `TryAdmit`/`Finish`/retry/progress; a provisioner executor registered in the funnel `Registry`.
- [ ] **Rebuild `dependencies/resources/{external_values.go, resources_service.go}` on our model** (the files git-rm'd in Phase 2) with **real** completion ports: instead of `TaskCompleter.ApplyBuildResult`/projector, the completion adapter **closes the `aep:provision` issue + records the `provision` Execution result + calls `Funnel.Reevaluate`**. Wire them into `resources_huma` (routes 503 → live).
- [ ] **Planning mints provisioning issues** (`plan_tap`/task feature): one `aep:provision` issue per distinct `external`/`platform-resource` dep in the approved design, deduped per project; the consumer coding task's machine block references them.
- [ ] **Extend `depsGate`** (`execution/funnel.go`) to be dependency-kind-aware: `external`/`platform-resource` deps resolve to their `aep:provision` issue's **derived** status; keep the `component` → `deriveStatus==deployed` path; cycle detection unchanged.
- [ ] **Drawer-triggered provisioning** via a funnel intent (`OnProvisionIntent`): external → secrets to SM-API + OC external RT/Resource/binding; platform-resource → OC `Resource`+binding (async). Both admit a `provision` Execution.
- [ ] **Readiness watcher** cloned from our build-success watcher: polls OC `ResourceReleaseBinding` `Ready`; on ready → `Finish` Execution, **comment reference + close issue** (OC binding name / commit SHA — never secrets), then `Reevaluate`.
- [ ] **Declarative wiring (ADR-0004), folded in:** at consumer dispatch, resolve all dep targets (sibling endpoints, org-service URLs, external + platform-resource **outputs** from OC binding `status.outputs`) and post the "**Platform-resolved dependencies**" comment on the coding issue; the coding agent copies it into `workload.yaml`. **Platform never patches the CR.**
- [ ] **Access-request ↔ org-publish issue**, **grant/reject cascade**, **`ExternalResource.Consumers`** (scan design), **teardown** on project delete (enumerate OC `Resource`s by `spec.owner.projectName` + close open `aep:provision` issues), **reconcile stale provision issues** on re-approval (`ReconcilePendingForDesignChange`). Preserve **org-service-gated-at-proceed-not-dispatch**.
- [ ] Tests: provision-issue lifecycle, gate hold/release via `Reevaluate`, declarative-wiring comment, grant/reject, teardown — green.

**Verify against the PR workspace (behavioral parity, not code parity — the substrate intentionally differs):**
- [ ] external dep → consumer **held** until values saved+provisioned, then dispatches; platform-resource dep → held until OC binding `Ready`.
- [ ] declarative-wiring comment format matches upstream byte-for-byte ("**Platform-resolved dependencies** … copy it verbatim"); no `spec.dependencies` CR-patch path exists.
- [ ] cross-project org-service blocks at **proceed**, granted (commit-SHA ref) on provider publish; project delete deprovisions OC `Resource`+bindings + closes provision issues.
- [ ] **no secrets** in any issue body/comment or API response (spot-check `aep:provision` issues + `get-dependency-status` outputs — names/paths only).
- [ ] **Divergence log (§8):** SYSTEM rows/projector/gate-table replaced by `aep:provision` issues + `provision` Execution + `depsGate`.
- [ ] `component_tasks` still **absent**: `git grep -ni 'component_tasks' -- services/aep-api` returns only migration-drop history.

**Exit criteria:** all parity scenarios behave as in the workspace on our substrate; provisioning routes live (no 503); no-secrets invariant holds; declarative wiring folded in; no stub/inert code remains.

---

### Phase 7 — Frontend: merge console-legacy dep UI + re-point task coupling · 🟢 green

**Goal:** finish the `console-legacy` half of the merge. The net-new dep UI (take-theirs, Phase 2) + type vocabulary (Phase 3) are already in and typechecking; here we resolve the remaining shared-file conflicts and drive the **task-coupled** CTAs off our `aep:provision` model. `apps/console` is accept-theirs; both consoles coexist (convergence = §8 follow-up).

**Work checklist:**
- [ ] Confirm the net-new dep UI is live (came in take-theirs at Phase 2; typechecks since Phase 3): `services/api/{accessRequests,externalResources,provisioning,specs}.ts`, `pages/architecture/{DependenciesSection,DependencyDrawer,OrgServiceResolution,ExternalResourceValues,ProvideSpec,PlatformResourcePanel}.tsx`, `pages/ExternalResourcesSettings.tsx`, cell-diagram `dependencyEdges` + platform-resource nodes.
- [ ] **Resolve the remaining shared-file conflicts:** `App.tsx` (register the 4 client token accessors + external-resources route/nav), `ProjectArchitecturePage.tsx` (mount `DependenciesSection` + `?dep=` deep-link).
- [ ] **Re-point the task-model coupling** (the real work): `services/api/types.ts` **`Task` gate fields** + `components/tasks/{TaskDetailPanel,TaskRow}.tsx` — drive the "Provide configuration / Provision resource" CTAs + gate captions off our **derived** task read model + `aep:provision` issue status (Phase 6), **not** `componentTaskId`/SYSTEM rows.
- [ ] **Accept-theirs `apps/console`** — resolve our `ProjectCreate.tsx` / `projects.$projectName.tsx` edits in favor of upstream.
- [ ] FE component tests green (the vitest suites upstream added come in with the take-theirs files).

**Verify against the PR workspace:**
- [ ] `git diff HEAD ../aep-pr-workspace -- console-legacy/console/src/pages/architecture console-legacy/console/src/services/api/{accessRequests,externalResources,provisioning,specs}.ts` empty (byte-parity of the net-new UI).
- [ ] `git diff HEAD ../aep-pr-workspace -- apps/console` empty (accept-theirs).
- [ ] Behavioral (Playwright): open the dependency drawer for each kind; request access; save external values; attach a spec; provision a platform-resource; observe status flips; a held task shows its gate reason.
- [ ] Cell diagram renders `component` sibling edges + external/org-service/platform-resource nodes.

**Exit criteria:** the dependency UI works in `console-legacy` against the live backend; net-new files byte-parity; `apps/console` accept-theirs; task CTAs driven by our `aep:provision` model.

---

## 6. Phase 8 — Completion verification & sign-off

**The migration is complete only when every box below is ticked.** This re-verifies the whole migration against the PR workspace and the project's quality bars **after** all phases, then records completion.

**Full-stack quality gates:**
- [ ] `make build` green (turbo + go.work).
- [ ] `make test` green (turbo + go test) — including the new dependency/gate tests.
- [ ] `make lint` green (eslint + golangci-lint).
- [ ] `make typecheck` green (tsc + go vet).
- [ ] `make license-check` green (Apache headers on all new source).
- [ ] Arch-tests green (no illegal feature edges; `dependencies/resources` keeps its empty allowlist).

**Fresh-cluster E2E (per the project's E2E discipline — full teardown → fresh spawn, Playwright via a Sonnet agent, streaming verified from mid-stream screenshots, fix → re-test → repeat until zero issues):**
- [ ] FULL cluster teardown → fresh setup → start → `seed-dev.sh` with the new infra (OC 1.1.1 + CNPG + `postgres-cnpg`).
- [ ] End-to-end happy path: create project → generate design with a `dependencies[]` of **all four kinds** → resolve each (external values, spec attach, platform-resource provision, org-service access) → proceed past the gate → tasks dispatch in dependency order → declarative-wiring comment appears → components deploy.
- [ ] Streaming/generation verified from mid-stream screenshots (no truncation/flicker regressions).
- [ ] Cross-project org-service flow: publish a provider, request access from a consumer, grant on provider deploy.
- [ ] Project delete deprovisions external + platform resources (verify OC `Resource`/binding gone).

**Final cross-check against the PR workspace (capability completeness — "no permanent half-migration"):**
- [ ] Every dependency-management capability present in `../aep-pr-workspace` is present here (walk §1.1–§1.10; each is TAKEN, ADAPTED, or consciously KEPT-divergent — **none silently dropped**).
- [ ] **All four dependency kinds** work end-to-end on our model (component, external, platform-resource, org-service) — the §3.6 worked flow reproduced live.
- [ ] Platform is **fully on OC 1.1.1** — no lingering 1.0.1 pin, no undocumented workaround left as a permanent state (any temporary shim has a tracked follow-up in §8).
- [ ] The **divergence log** (§8) accounts for every place our behavior differs from the workspace, each with a reason.
- [ ] Any **deferred** item (e.g. console convergence onto `apps/console`) is **tracked as explicit follow-up in §8**, not abandoned — the "no permanent half-migration" principle (§0) holds.
- [ ] No skip-list artifact leaked in (structured-output agent routes, `agents-legacy`, `component_tasks` ALTER, #72 removals).

**Merge finalization & sign-off:**
- [ ] Confirm the integration is a **merge** (second parent = `upstream/aep-rewrite` `1076be7`), not a rebase: `git log --merges --format='%h %p %s' | head`.
- [ ] Confirm a subsequent `git merge upstream/aep-rewrite` is a no-op / clean (common ancestor advanced — future syncs won't re-surface PR #85).
- [ ] Remove the PR workspace worktree: `git worktree remove ../aep-pr-workspace`.
- [ ] PR the integration branch; land per normal review.
- [ ] **Mark every row in §0 `✅ DONE` and set this document's status to COMPLETE.**

> Do **not** mark the migration complete until all of §6 is green. A phase looking done is not the same as the migration being done — the final E2E + capability cross-check is the gate.

---

## 7. Alternative integration flow (if a green merge commit is required)

The §4/§5 flow lands a **known-red merge commit** at Phase 2 and brings the tree green over Phases 3–4. If a **green merge commit** is mandatory (e.g. CI blocks red commits even on feature branches):

- Still do the pre-merge platform bump (Phase 1) first; then do all the feature/resolution/gates/FE work (the substance of Phases 3–7) as normal green commits **on the integration branch first** (cherry-pick/re-implement, each verified against the workspace).
- Then record the merge **last** with `git merge -s ours upstream/aep-rewrite` — this creates the merge commit (second parent recorded, future syncs clean) **without** taking any upstream bytes, since you've already hand-integrated everything wanted.
- Trade-off: loses line-level provenance of which code came from upstream (acceptable — most of it is re-implemented anyway), and you must be disciplined that "everything wanted" really was hand-integrated before the `-s ours` merge (the §6 capability cross-check is what guarantees this).

Pick one flow at Phase 0 and record the choice in §8.

---

## 8. Execution log

**Decisions locked (grilling, 2026-07-06):**
- **Integration flow:** ✅ **merge-first** (§4/§5) — keep-ours + take-theirs-now + migrate-coupled-later. (`-s ours`, §7, not chosen.)
- **Gate / provisioning model (Phase 6):** ✅ **`aep:provision` GitHub issues + `provision` Execution kind + extended funnel `depsGate`** (§3.6). **No** SYSTEM rows, **no** projector, **no** gate table. Close-with-reference, no secrets.
- **Proceed-gate placement (Phase 5):** ✅ **`design_service.SaveAndProceed`** (the `v<N>-<M>` tag-cut). Block set: **org-service unreachable + external needs-spec**; external-values + platform-resource are **dispatch**-gated.
- **OC bump:** ✅ **1.1.1**, isolated as **Phase 1** (pre-merge) with a full auth-inclusive regression before feature code; agents service stays **keyless-boot** (per-turn `X-Anthropic-Key`).
- **Console (Phase 7):** ✅ dependency UI stays in **`console-legacy`** (upstream built it there; both consoles coexist — upstream did **not** delete console-legacy). **Accept-theirs** on `apps/console`. Converging the two consoles is a deferred follow-up (below).

**Verified by the multi-agent design pass (2026-07-06) — corrections already folded into §4/§5:**
- **No stub adapters (Phase 4).** The task-coupled ports (`TaskCompleter`/`RedispatchFunc`/`TaskStore`) are consumed **only** by `resources/{external_values,resources_service}.go`, which are git-rm'd at the merge until Phase 6 — so there is nothing to inject a stub into (a stub passed to nothing = "declared and not used"). The ports are **trimmed out**; provisioning routes nil-guard to **503**; real ports+adapters land with the rebuilt services in Phase 6.
- **The merge (Phase 2) must resolve EVERY conflict to commit.** `design_service.go`/`artifact_store.go`/`design_huma.go` and console `types.ts` are both-sides conflicts resolved **keep-ours-temporarily** at the merge, then **grafted onto** in Phases 5/3 — never "resolved from scratch later."
- **`types.ts` vocabulary lands in Phase 3** (not 7), else the take-theirs dep-UI pages don't typecheck; only the task-coupled `Task` gate fields stay for Phase 7.
- **`docker-compose.yml` + helm `aep-api/deployment.yaml` RE-conflict** at the merge (upstream agents block vs ours) — resolve-union keep-ours, do not expect auto-resolve.

**Execution progress (live):**
- **Phase 0 (2026-07-06) ✅** — Flow chosen: **merge-first** (§4/§5). **Integration branch decision (user):** work **directly on `rewrite-improve`** — no separate `feat/dependency-management` branch; the pre-merge tip `429d5b5` stays recoverable via `origin/rewrite-improve` + reflog. Committed 26 untracked design docs (`8f9d2ef`) → clean tree. PR workspace worktree up at `../aep-pr-workspace` (detached `1076be7`). merge-base confirmed `dfe6f2a`; `rewrite-improve` = `aep-rewrite` + committed-truth commit `429d5b5`.
- **Phase 1 (2026-07-06) ✅ regression PASS** — commit `e394f11`. Full fresh teardown→setup→start→seed on OC 1.1.1 green; webhook-race fix fired once then succeeded. **Regression e2e (Sonnet agent, real OAuth code+PKCE login):** auth ✅ (Thunder 1.1.1 gate: 401 no-token / 200 admin JWT), project-create ✅ (OC project CR + GitHub repo), design-gen ✅ (101 live SSE frames mid-stream, committed-truth: GitHub main HEAD == commitSha), approve→plan→dispatch ✅ (tag cut, 2 issues w/ `aep:execute`). **Build→deploy leg BLOCKED by a PRE-EXISTING, non-1.1.1 issue** (stale runner image `aep-coding-agent-runner:v4` predates the 2026-07-05 creds-refresh route rename → runner 404s at workspace_provisioning; OC 1.1.1 itself accepted the Component CR + all dispatch 201'd). No CRD rejections, no auth breakage, CNPG healthy. **Verdict: OC 1.1.1 bump did not regress the platform → safe to merge.**
  - **Deferred follow-ups (before Phase 8 real deploy):** (a) rebuild/repin `aep-coding-agent-runner` image to match the current `/internal/v1/executions/{id}/credentials/refresh` route; (b) add the missing `coding_agent_logs` table migration (JobWatcher log-persist 42P01, cosmetic).
- **Phase 2 (2026-07-06) ✅** — commit `0e2b7db`, merge (2nd parent `1076be7`); `upstream/aep-rewrite` now an ancestor (future syncs clean). 94 conflicts resolved per §4 + the merge-tree inventory below; **the conflict-only script missed clean-added skip-list files** (structured-output agent dirs, agents-legacy leftovers, codingagent `resource_watcher`/dispatch tests, `task/planner_skill`, `clients/agents/client_mcp_test`) — caught via a provenance scan (in-`rewrite-improve`=keep, upstream-only=rm) and `git rm`'d. Critical keep-ours verified byte-identical to `rewrite-improve` (openapi #72, component-design-schema, design_service, app.go, console types.ts). Our GitHub-native packages intact (task/execution/codingagent/taskmeta). phase9 ALTER stripped; resources/ports.go trimmed. Expected-red residual: connections→dependencies vocab (P3), dependencies wiring (P4), `external_resource_repository.Consumers` still queries component_tasks (→ design-scan in P6).
- **Phase 1 file-level detail** — Cherry-picked platform infra (all unchanged-by-us → clean): `env.sh` (OC `1.1.1` + `CNPG_VERSION=0.29.0`), `setup-prerequisites.sh` (CNPG operator), `setup-aep.sh` (postgres-cnpg CRT+RBAC + workload-publisher binding), `setup-thunder-client.sh` (THUNDER_SKIP_SECURITY lift/restore). Hand-added `AEP_API_INTERNAL_BASE_URL` to compose + helm aep-api (kept our agents block — did NOT inherit upstream's boot-time `ANTHROPIC_API_KEY`). **Platform-bump robustness fix (proper, in-scope):** a cold OC 1.1.1 control-plane install races the controller-manager validating webhook (chart applies `ClusterAuthzRoleBinding` CRs before the webhook pod has endpoints → `no endpoints available for service controller-manager-webhook-service`, release left `failed`). Fixed `setup-openchoreo.sh`: skip only when status is `deployed` (not merely present) + retry `helm upgrade --install` after waiting for the webhook endpoints. Re-running full teardown→setup→start→seed to validate on a cold pull.

**Phase 0 merge dry-run conflict inventory (`git merge-tree`, 94 paths):**
- **48 modify/delete** (we deleted, upstream modified → `git rm`, keep our deletion): all upstream net-new `codingagent/{dispatch_service,dispatch_cascade_hook,*_dbtest_test,dispatch_helpers_test}`, `task/{board_service,handlers,task_diff,task_stream,task_service_test,*_test}`, `contracts/{dispatch,task_state,task_state_test}`, `models/component_task.go`, `artifacts/{save_via_api,*_test}`, `design/design_service_test.go`, `gitrepo/issue_body{,_test}.go`, `clients/agents/client.go`, `testdata/harvest/golden/get_{board,task,tasks,tasks_generated}.json`, ALL `services/agents-legacy/**`, `console-legacy/.../tasks/TaskDetailPanel.tsx`, `services/agents/src/contracts/sse-events.ts`.
- **~42 content** — keep-ours (agents main-agent files, task_huma, project_service, artifacts tests, arch_test, api/{huma_register,surfaces}), **temporarily-keep-ours→graft** (design_service, design_huma, artifact_store [P5]; console types.ts [P3/P7]; component-design-schema.ts, openapi.yaml, SKILL.md [P3]), **accept-theirs** (apps/console/*), **resolve-union** (run_all, app.go, .env.example, compose+helm, console-legacy shared, lockfiles, CONTEXT.md, Makefile).
- **2 add/add** (agents Dockerfile, .env.example → keep-ours) · **2 implicit-dir-rename** (agents-legacy mcp-client → drop; MCP take-theirs content ported P5).
- **ALSO git rm** (clean-added upstream but task-coupled → rebuild P6, NOT in conflict list): `dependencies/resources/{external_values,resources_service,resources_component_test,*_test}.go`; **REFINEMENT vs doc §4:** `dependencies/resources/resources_huma.go` (its provisioning handlers structurally reference the deleted `ValueService`/`ResourceService` types → can't 503-guard; provisioning/values/status routes are ABSENT until P6) **and** the entire `dependencies/endpoints/access_*` set (`access_service.go` is HARD-coupled: imports `repositories`, creates `models.ComponentTask` rows, `ProviderTaskID` state machine → NOT agnostic; rebuild on `aep:provision` org-publish issues in P6). So **Phase 4 endpoints/ = catalog + naming only.** Full playbook: `scratchpad/phase2-merge-playbook.md`.
- **take-theirs-EDIT:** `phase9_dependency_mgmt.go` (keep 2 CREATE, strip ALTER); `resources/ports.go` (trim `TaskStore`/`TaskCompleter`/`RedispatchFunc`, keep `externalResourceLookup`/`SecretWriter`/`ExternalResourceRegistry`/`DesignReader`).

- **Phase 3 (2026-07-06) ✅** — commit `044bb96`. TS vocab migrated: agent-stream zod `connections[]`→`dependencies[]` (drift-guard vs the already-merged `ComponentDesign` contract passes; `gen` regenerated `component-design.schema.json`), barrel exports, console-legacy `types.ts` DesignComponent→`dependencies[]` + Dependency/ConfigKey/AccessRequest/ExternalResource types, `high-level-architecture/SKILL.md` take-theirs (dependencies + discover-before-invent) + vendored sync. Fixed 2 pre-existing agents breaks (removed unused broken `mcp-client.ts`→P5; fixed `main/component-design.test.ts` import). **Green: packages + @aep/agents + console-legacy SOURCE typecheck.** **OpenAPI refinement (vs doc):** our branch is **code-first** (`make gen`→`make -C aep-api openapi` exports the spec from Go Huma; upstream went spec-first). So dependency paths/schemas are NOT hand-edited — they register in Go Huma and regenerate in **Phase 4**; code-first also preserves #72 naturally. **Deferred:** apps/console typecheck (upstream's #77/#80 files need `/board`,`/spec`,`ProjectStatus.spec*`,`Component.endpointUrl` backend APIs our Go lacks → two-console **convergence** follow-up); console-legacy **vitest** suites + task-coupled gate fields → Phase 7.

- **Phase 4 (2026-07-06) ✅** — commit `00955b1`. aep-api Go **green** (`build`/`vet`/`test`; dbtests skip w/o Docker). Design-codec reconciliation: `artifact_store.go` delegates to `design_json.go`'s dependencies codec + `SplitDesign` (write inverse); dropped `ExternalAPICatalog` + the per-component design.md path (design.json is sole authored model). designspec validator: `additionalProperties` bool-or-subschema; synced go:embed'd schema. `external_resource_repository.Consumers`→empty (design-scan rebuilt P6). **MCP surface LIVE:** `surfaces.go` mounts `POST /internal/v1/mcp` behind `AgentsScopedVerifier`; `app.go` wires real readers (ExternalResourceRepository + endpoints.Catalog + resources.ResourceTypeCatalog over `openchoreo.NewResourceClient`). Arch-lock: added `dependencies → dependencies/resources`. Test-seed migration (subagent, verified) connections→dependencies + design.md→design.json across design/component packages. **Refinement confirmed:** provisioning routes ABSENT (not 503) — the coupled resources_huma/access were git-rm'd at merge. **Deferred:** `commit_design_file`/`StoreConsumedSpec` spec-commit path → P5; apps/console typecheck + the license-check `$param`-filename Makefile quirk (pre-existing; apps/console-convergence follow-up).

- **Phase 5 (2026-07-06) ✅** — TS half `44a77c8`, Go half `111ed8d`; both green, integrate on the shared `mcp:{url,token}` wire shape. **TS (agents):** re-added `mcp-client.ts` (JSON-RPC, bearer, tools/list→dynamicTool, isError→tool-error), `McpConfig`+`TurnRequest.mcp`, shadow-guard `{...mcpTools, ...baseTools}`, `server.ts` wire-validation (128/128). **Go (aep-api):** `OrgServiceResolver`+`resolveOrgServices` (4-state, **fail-open**) wired via `endpoints.Catalog` at the composition root (no new feature edge); proceed-gate `ErrUnresolvedDependency`→409 in `SaveAndProceed` (block set = **org-service-unreachable + external-needs-spec ONLY**); external-resource `Upsert` registration on save; BFF **MCP-mint** on the design-generate turn (`MCPBlock{url,token}`, aud `aep-api-mcp` via `TaskTokenManager`, `AEP_API_INTERNAL_BASE_URL`). Tests: `resolve_org_services_test` + `proceed_gate_test` (service + component-tier 409). **Two `TODO(Phase 6)` deferrals** (committed-truth writes go via the Files API — no single-file commit surface yet, so no gitOps invented): (a) `StoreConsumedSpec` single-file **spec-commit** to `components/<c>/dependencies/<dep>.openapi.yaml`; (b) **auto-fetch-on-save** (depends on (a)). **Delegation note:** implementation subagents now use the capable/default model; Sonnet reserved for test-heavy sweeps.
- **⏸ Compaction checkpoint (2026-07-06):** Phases 0–5 complete + committed (`8f9d2ef` … `111ed8d`); paused here for context compaction per the "Resume after compaction" callout in §0. **Next: Phase 6** (provisioning-as-issues + funnel gates + declarative wiring — the crux; §3.6). First Phase-6 sub-item can absorb the two Phase-5 spec-commit deferrals above (they need the same committed-truth write path).

- **Phase 6 (2026-07-06) ◐ CODE DONE — committed in 4 green sub-commits; live e2e pending.** Built the whole §3.6 model directly (subagents used only for the initial substrate mapping); each sub-commit is build/vet/test/arch green.
  - **6.1 `54b2843` — vocabulary + gate.** taskmeta: `ClassProvision` (`aep:provision`) + `KindProvision`; a succeeded provision run derives `StatusDeployed` (extended the ops arm), so the UNCHANGED `depsGate` treats it as satisfied. `Block.GateKind` (config-collection/resource-provisioning/org-publish) round-trips. execution funnel: `projectView` indexes `aep:provision` issues by dep name; `depsGate` is dependency-kind-aware (a consumer coding task holds until each design external/platform-resource dep's provision issue derives deployed — design-augmented in Go, `DesignReader.ProvisionDepNames`; org-service stays proceed-gated). `OnExecuteIntent` no-ops a stray `aep:execute` on provision issues.
  - **6.2 `0959205` — provisioning service package.** New `internal/feature/provisioning` (arch row `{dependencies/resources, gitrepo}`): `EnsureProvisionIssues` (mint/dedup on design approval via `design_service.SetProvisionIssueMinter`), `ValueService.SaveValues` (external, split-by-schema secrets→SM-API, synchronous complete — readyWhen:${true}), `ResourceService.Provision` (platform-resource, async → RUNNING run pinned to the dev binding), `ResourceWatcher` (cloned from ExecWatcher, keyed on `KindProvision`+binding `IsReady` → Finish+close+Reevaluate, 30m stale), `StatusService` (masked outputs), `resources_huma` (list/delete-409/values/provision-202/status; nil→503). Provisioner cores wired in app.go; provision rows carry the gate issue's repo full name so the gate resolves them.
  - **6.3 `6a5270f` — declarative wiring (ADR-0004).** `codingagent.DependencyWiring` port (primitives) + `WithDependencyWiring` + best-effort call in `runCoding`; `provisioning.WiringResolver` re-expresses the upstream builder byte-for-byte (org-service+component endpoints, external verbatim + platform `<UPPER(dep)>_<UPPER(out)>` outputs → `dependencies: {endpoints, resources}` YAML). Platform never patches the CR.
  - **6.4 `e4813cf` — access + grant/reject + consumers scan + teardown.** `RequestAccess` (validate org-service dep → resolve provider `FindByComponent` → mint deduped provider-side org-publish issue; `ProviderTaskID` re-keyed to `<project>#<issue>`), GET access-requests, `OnComponentDeployed` grant cascade (wired to ExecWatcher build-success via `codingagent.DeployObserver`) + `RejectByProviderTask`; `Consumers` via committed-design scan (`ProjectLister`, §3.2 item 7) → in-use DELETE 409; `DeprovisionProject` on project delete (`project_service.SetResourceDeprovisioner`, before OC/repo delete). `NewService(Deps{})`.
  - **OpenAPI `dd2eb83`** — code-first export (`make -C aep-api openapi`) added the 7 provisioning ops + finalized connections→dependencies in the contract; #72 search/nextCursor retained.
  - **DIVERGENCE LOG (vs the PR workspace):** (1) provisioning is driven by the `ProvisioningService` from the drawer HTTP action (not a funnel registry `Executor`) — external secret values arrive in the request body and CANNOT be persisted for a deferred executor; the provision Execution still reuses `TryAdmit`/`Finish`/derive/gate and is Finished by the readiness watcher. (2) SYSTEM `component_tasks` rows + projector + gate-array columns → replaced by `aep:provision` GitHub issues + `KindProvision` Executions + the extended `depsGate` (no DB gate state). (3) `depsGate` reads provision deps from the committed **design** (Go augmentation), not from a task row's gate columns. (4) `ExternalResource.Consumers` → committed-design scan, not a `component_tasks` JSONB query.
  - **Follow-ups carried out of Phase 6 (tracked, not abandoned):** (a) **orgPublished durability marker commit** — `GrantByProviderComponent` flips status + closes the issue but does NOT yet commit `exposesAPI.orgPublished` to the provider design; needs the single-file committed-truth write path (the same Phase-5 spec-commit deferral). The FUNCTIONAL org-service gate already works via Phase 5's live-catalog proceed-gate. (b) The two Phase-5 spec-commit deferrals (`StoreConsumedSpec` single-file commit + auto-fetch-on-save) remain — same write-path dependency. (c) **reject cascade** (flip open riders to `rejected` on a declined org-publish) is UNBUILT — it needs a "declined" signal on our model (an org-publish gate issue is not a PR, so there is no PR-closed-unmerged webhook to key on); the `AccessRequestStatusRejected` state + the grant-path skip guard are in place, and the method re-lands with the trigger. (d) **builtin-skill vocab drift** (observation, pre-existing on BOTH branches — upstream PR #85 also left it): `services/aep-api/skills/builtin/{api-management,react-webapp}/SKILL.md` still say `dependentApis` (only `high-level-architecture/SKILL.md` was in the §1.1 rename scope, and it IS migrated). Low-priority coding-agent guidance tidy, not a backend capability drop.
  - **Post-Phase-6 audit (2026-07-06, multi-agent + golangci-lint):** completeness/wiring audit vs the PR workspace found **no silently-dropped upstream capability and nothing built-but-unwired** (all 12 provisioning `Deps`, `SetProvisionIssueMinter`/`SetResourceDeprovisioner`/`WithDependencyWiring`/`WithDeployObserver`/`WithRunnerSecrets`, the watcher, and the MCP mount are all constructed AND registered). golangci-lint (v2.12.2/go1.26, incl. the `unused` linter) = **0 issues**. Dead-code audit → removed `resources.ExternalResourceRegistry` + its assertion, `repositories.…Consumers` (superseded by the design-scan), and the orphan `RejectByProviderTask` (`877d1f2`); fixed 5 stale doc/comment blocks. **Finished the one real half-wired capability** — external-resource → coding-runner **secret injection** (producer `resources.ResolveRunnerSecrets` + consumer `Inputs.ExternalResourceSRs` were both built but never connected): now wired via `provisioning.Service.ResolveComponentRunnerSecrets` + `codingagent.RunnerSecretResolver` + `WithRunnerSecrets` + the composition-root adapter (guarded/best-effort). This was §1.4's "runner secrets materialized via per-run ExternalSecrets."
  - **Post-Phase-6 behavioral e2e (2026-07-06, Sonnet Playwright, verify-first) — PASSED.** Rebuilt+redeployed aep-api+agents, verified each fix live, then ran the full flow: create project → generate design (Postgres + Stripe requirement) → the authored `payments-service/design.json` uses **`dependencies[]`** (`platform-resource` orders-db/postgres-cnpg + `external` stripe, `secret:true` config) with **no `connections[]`** → Publish (`/design/bundle` **200**, tags `v1`+`v1-1`) → **2 `aep:provision` gate issues minted** (resource-provisioning + config-collection, `designTag` lineage) → per-dep status **200** masked → **no leaked secrets**. Everything up to the (runner-blocked) build/deploy leg works end-to-end on the OC 1.1.1 cluster.
    - **Two bugs the e2e caught + fixed (committed):** **Bug B `14469f5`** — `RunPhase9DependencyMgmt` was coded but never added to `run_all.go`'s steps, so `external_resources`/`access_requests` never got created → the list endpoints 500'd; registered it (verified live: tables created on boot). **Bug A `c3a9f5b`** — a PRE-EXISTING Phase-3 gap: the agent WRITE path still authored `connections[]` (the read side + TS zod were migrated in Phase 3, but `agentfold/designgate.go` + the agent `prompt.ts` example + the seeded `high-level-architecture` skill were not), 500-ing every fresh design. Migrated the write-gate, fixed the prompt, bumped the skill `aep.version` 1→2 (re-synced via the explicit `POST /org/skills/sync` — project-create does NOT reconcile versions). **The golden-parity tests (`TestFoldGoldens_*`, `TestComponentDesignGate`, `TestFrontmatterAndGuard_MatchFileBundleFixture`) are `t.Skip`'d** (per user) pending regeneration of their recorded cassettes + TS-fold goldens + `frontmatter_bundle.json` to the `dependencies[]` schema — the **golden-fixture-regen fast-follow**.
    - **Lazy-snapshot note (for future live verification):** per-SHA org-skills snapshots materialize LAZILY on the first read-turn (not at sync time), so a `snapshots/<sha>/…/SKILL.md` grep can false-negative right after a sync; verify via `git -C <org-skills mirror> show HEAD:…/SKILL.md` instead.
  - **Live verification (2026-07-06):** rebuilt the aep-api image with the Phase-6 code + redeployed to the running OC 1.1.1 compose stack. **Boots clean** (no panic; **7** background watchers — the new `ResourceWatcher` registered, up from 6). The running app's served `/openapi.yaml` lists **all 7 provisioning operationIds** (list/delete-external-resources, collect-values, provision, dependency-status, access-request, access-requests) — routes registered against the wired (non-nil) `ProvisioningSvc`; unauth calls return 401 (auth-gated, never 503). **Routes are LIVE, not inert.** The full authed behavioral e2e (design-approve mints `aep:provision` gate issues → gate holds a consumer → values/provision → readiness release → declarative-wiring comment → deploy, across all four kinds) is unit-tested on our substrate (funnel_provision_test + provisioning_test) and is exercised live by the **Phase 8 fresh-cluster gate** (also where the runner-image + `coding_agent_logs` deploy blockers from Phase 1 are cleared) — deliberately not duplicated here.

**Fill in during the migration:**
- **Divergence log:** _every behavior that differs from the workspace, with reason (esp. Phase 6: SYSTEM-rows/projector → `aep:provision`/`depsGate`)_

**Deferred follow-ups (tracked, not abandoned — §0 principle):**
- _Console convergence onto `apps/console` (if Phase 7 lands in console-legacy) — file/track here._
- _Any temporary OC 1.1.1 shim to fully resolve — file/track here._

---

## Appendix — key upstream files (by area)

- **dependencies feature:** `services/aep-api/internal/feature/dependencies/{mcp_server,mcp_tools,ports}.go`, `endpoints/{catalog,naming,access_service,access_huma}.go`, `resources/{external_values,external_provisioner,platform_catalog,platform_provisioner,resources_service,resources_huma}.go`
- **design/codec:** `internal/feature/artifacts/{design_json,artifact_store,spec_collect,commit_design_file}.go`, `internal/feature/design/{design_service,design_huma}.go`, `models/design.go`
- **tasks/dispatch/contracts:** `models/{external_resource,access_request,component_task}.go`, `internal/database/migrations/phase9_dependency_mgmt.go`, `repositories/{external_resource,access_request}_repository.go`, `internal/feature/task/{task_stream,board_service,projector,handlers}.go`, `internal/feature/codingagent/{dispatch_service,dispatch_cascade_hook,resource_watcher}.go`, `internal/contracts/{task_state,dispatch}.go`, `internal/clients/openchoreo/{resource_client,external_resource_type}.go`, `internal/feature/project/project_service.go`
- **agents:** `services/agents/src/agents/{architect,taskplanner,document-generation,dsl-render}/` (SKIP), `services/agents/src/shared/mcp-client.ts` (TAKE), `services/agents/src/contracts/component-design.ts`, `skills/{high-level-architecture,task-breakdown}/SKILL.md`
- **FE:** `console-legacy/console/src/services/api/{accessRequests,externalResources,provisioning,specs}.ts`, `console-legacy/console/src/pages/architecture/*`, `console-legacy/ui-components/cell-diagram-view/src/buildProjectModel.ts`
- **console/infra/contract/docs:** `apps/console/src/{routes,features}/*`, `deployments/single-cluster/postgres-cnpg-*.yaml`, `deployments/scripts/{setup-prerequisites,setup-aep,setup-thunder-client,env}.sh`, `packages/contracts/api/v1/openapi.yaml`, `packages/design-projection/src/project-design.ts`, `docs/decisions/ADR-000{3,4}.md`, `docs/glossary.md`, `CONTEXT.md`, `services/aep-api/design/dependencies.md`
