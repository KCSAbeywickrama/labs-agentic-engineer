# Dependency-Management Migration — File-Level Verification

**What this verifies.** A completeness cross-check of upstream PR **#85** ("connections story" /
dependency-management) against our integrated result. For every dependency-management-relevant
upstream file, this confirms the file (or its intended equivalent) actually landed in our
implementation, in the bucket the migration playbook assigned it (TAKE / ADAPT / KEEP / SKIP /
RECONCILE). This is a **completeness audit only** — no production code was changed.

**When / against which SHAs.**
- Verified **2026-07-06**.
- Our integrated repo: `/Users/wso2/repos/labs-agentic-engineer`, branch `rewrite-improve`, HEAD
  `580beef` (`feat(dependencies): fast-follows …`). The PR #85 merge commit is `0e2b7db` (second
  parent = upstream tip `1076be7`).
- Parity oracle: read-only worktree `/Users/wso2/repos/aep-pr-workspace`, detached at PR tip
  **`1076be7`**.
- Fork point / merge-base: **`dfe6f2a`**. Full PR file set:
  `git diff --name-only dfe6f2a 1076be7` = **323 files**.
- Classification source: `docs/design/dependency-management-migration.md` (§1 catalog, §3
  categorization, §4 conflict posture, §8 execution/divergence log, Appendix).

**Method.** For **TAKE**: file exists at the same path and `git diff HEAD 1076be7 -- <path>` is empty
(byte-parity) or only cosmetic. For **ADAPT**: the capability is found by grepping for the equivalent
symbol/route/behavior in our packages (`internal/feature/{provisioning,execution,codingagent,design,
artifacts}`, `internal/contracts/taskmeta`, console-legacy) — not the upstream filename. For **SKIP**:
confirmed correctly absent (`ls`/`git grep` return nothing live). For **RECONCILE / take-theirs-EDIT**:
the surviving parts match and the stripped parts are gone.

**Status legend.** ✅ PRESENT (byte-parity) · ✅ ADAPTED (equivalent found — named) ·
✅ SKIPPED (correctly absent) · ⚠️ GAP (should be here / can't find the equivalent).

Files that are pure agent-tooling / infra noise unrelated to dependency-management
(`.agents/skills/**`, `.dockerignore`, `.gitignore`, `skills-lock.json`, lockfiles, `Makefile`s,
`config.go`) are covered in the Noise section, not row-by-row.

---

## A. aep-api — `internal/feature/dependencies/` + design/artifacts codec + OC client

| upstream path | bucket | status | evidence |
|---|---|---|---|
| `dependencies/mcp_server.go` (+`_test`), `mcp_tools.go`, `ports.go` | TAKE | ✅ PRESENT (byte-parity) | `git diff HEAD 1076be7` empty for all four; the four discovery tools present. |
| `dependencies/doc.go` | TAKE | ✅ PRESENT | 20-line diff; ours documents the MCP server accurately (upstream's own doc.go is stale). |
| `dependencies/endpoints/{catalog,naming,doc}.go` | TAKE | ✅ PRESENT (byte-parity) | diff=0. |
| `dependencies/endpoints/catalog_test.go` | TAKE | ✅ PRESENT | diff=20, only an arch-test doc-comment reworded. |
| `dependencies/endpoints/access_service.go`, `access_service_test.go`, `access_huma.go`, `access_component_test.go` | ADAPT | ✅ ADAPTED | task-coupled (created `models.ComponentTask`); git-rm'd at merge, rebuilt as `provisioning.Service.RequestAccess` (`internal/feature/provisioning/access.go:38`), `ProviderTaskID` re-keyed via `providerTaskKey(project, issue.Number)` → `<project>#<issue>`; HTTP `registerAccess` (`access_huma.go:46`); test `TestRequestAccess_CreatesRequestAndProviderIssue`. |
| `dependencies/resources/{external_provisioner,platform_catalog,platform_provisioner}.go` (+`_test`) | TAKE | ✅ PRESENT (byte-parity) | diff=0 for all six. |
| `dependencies/resources/{errors,naming}.go`, `naming_test.go` | TAKE | ✅ PRESENT (byte-parity) | diff=0. |
| `dependencies/resources/ports.go` | take-theirs-EDIT | ✅ TRIMMED correctly | diff=72; `TaskCompleter`/`RedispatchFunc`/`TaskStore`/`ExternalResourceRegistry` gone from code (only named in a comment); `SecretWriter`/`DesignReader` retained. |
| `dependencies/resources/doc.go` | take-theirs-EDIT | ✅ PRESENT | diff=59, rewritten consistent with the ports trim. |
| `dependencies/resources/external_values.go`, `resources_service.go` (+`_test`, `resources_component_test`) | ADAPT | ✅ ADAPTED | git-rm'd at merge, rebuilt as `provisioning.Service.SaveValues` (`value_service.go:38`) + `.Provision` (`resource_service.go:38`); 14 tests in `provisioning_test.go`. |
| `dependencies/resources/resources_huma.go` | ADAPT | ✅ ADAPTED + wired | rebuilt at `internal/feature/provisioning/resources_huma.go`; 5 routes (list/delete-external-resources, values, provision, status) wired via `provisioning.RegisterResources(...)` at `internal/api/huma_register.go:89`. |
| `artifacts/design_json.go` (+`_test`) | TAKE | ✅ PRESENT (byte-parity) | diff=0 (test has one extra local helper, non-functional). |
| `artifacts/artifact_store.go` (+`_api_test`) | TAKE (grafted) | ✅ PRESENT | `resolveOrgServices` (line 194): 4-state resolved/blocked(access-required)/unresolved(not-found); `DependencyStatusAmbiguous` reserved in `models/design.go:68`. |
| `artifacts/resolve_org_services_test.go` | TAKE | ✅ PRESENT (byte-parity) | diff=0, same filename + content. |
| `artifacts/spec_collect.go` (+`_test`) | TAKE (adapted for committed-truth) | ✅ ADAPTED | `StoreConsumedSpec` now validates+normalizes and hands the blob to the caller for an atomic Files-API commit (committed-truth); divergence documented in-file. |
| `artifacts/commit_design_file.go` (+`_test`) | TAKE/ADAPT | ✅ ADAPTED | equivalent atomic-commit primitive = `files.FilesService.Apply` (`internal/feature/files/files_service.go:240`) + `design.designFileCommitter.Commit` (per-file BaseSHA CAS), used by `design.CollectSpec`. |
| `artifacts/external_api_catalog.go` | SKIP (upstream deleted) | ✅ SKIPPED | `grep ExternalAPICatalog` → only 2 explanatory comments, no live type. |
| `artifacts/save_via_api.go` | SKIP (modify/delete → keep ours) | ✅ SKIPPED | absent. |
| `design/design_service.go` (+`_more_test`) | TAKE (grafted) | ✅ PRESENT | `ErrUnresolvedDependency` (L45), `SaveAndProceed` (L579), `firstUnresolvedDependency` (L723) gate exactly org-service-unreachable + external-needs-spec. |
| `design/design_huma.go` | TAKE (grafted) | ✅ PRESENT | `collect-dependency-spec` op (L146) → `svc.CollectSpec`. |
| `design/design_component_test.go` | TAKE (grafted) | ✅ PRESENT | diff=458 (expected — arch divergence). |
| `design/design_service_test.go` | (test) | ⚠️ minor | no same-named file; coverage likely folded into `design_service_more_test.go` / `proceed_gate_test.go` (not line-for-line confirmed). Low severity. |
| `internal/clients/openchoreo/resource_client.go` (+`_test`, `mocks/resource_client_mock.go`) | TAKE | ✅ PRESENT (byte-parity) | diff=0. |
| `internal/clients/openchoreo/external_resource_type.go` (+`_test`) | TAKE | ✅ PRESENT (byte-parity) | diff=0. |
| `internal/clients/openchoreo/{component_client,errors,transport}.go` | pre-existing | ✅ PRESENT | diff=0, no regression. |
| `models/external_resource.go`, `access_request.go` | TAKE | ✅ PRESENT (byte-parity) | diff=0; `access_request.go` comment documents the `ProviderTaskID`→issue re-key. |
| `models/design.go` (+`_test`), `models/component.go` | TAKE | ✅ PRESENT | diff=27 (ours adds `ProvisionDependsOn()` — additive); `Dependency`/`DependencyKind` types present. |
| `models/component_task.go` | SKIP | ✅ SKIPPED | file absent; all `ComponentTask` hits are comments/history. |
| `repositories/external_resource_repository.go` | TAKE (`Consumers` adapted) | ✅ ADAPTED | CRUD byte-identical; JSONB `Consumers()` gone, replaced by design-scan `externalConsumersByName` (`provisioning/external_catalog.go:91`). |
| `repositories/external_resource_repository_dbtest_test.go` | TAKE | ⚠️ GAP | dropped entirely — the still-valid CRUD tests lost coverage (see Gaps). |
| `repositories/access_request_repository.go` (+`_dbtest_test`) | TAKE | ✅ PRESENT (byte-parity) | diff=0. |
| `internal/database/migrations/phase9_dependency_mgmt.go` | take-theirs-EDIT | ✅ PRESENT, trimmed | `CREATE external_resources` + `CREATE access_requests`; ALTER `component_tasks` stripped (documented). |
| `internal/database/migrations/run_all.go` | take-theirs-EDIT | ✅ REGISTERED | `ctxStep("phase9_dependency_mgmt", RunPhase9DependencyMgmt)` at L98 (prior "coded-but-unregistered" bug B is fixed). |
| `internal/api/surfaces.go`, `mcp_surface_test.go` | TAKE | ✅ WIRED | `POST /internal/v1/mcp` mounted (L136-139) behind `AgentsScopedVerifier`; `mcp_surface_test.go` diff=0. |
| `internal/api/{app,huma_register,huma_registration_test}.go` | TAKE | ✅ PRESENT | moderate diffs from broader wiring; core mounting intact. |
| `internal/app/app.go` | TAKE | ✅ REAL adapters | `openchoreo.NewResourceClient`, `endpoints.NewCatalog`, `NewExternalResourceRepository` → `params.MCP*` (L748-753); no stubs. |
| `internal/platform/auth/agents_scoped.go` (+`_test`) | TAKE | ✅ PRESENT (byte-parity) | diff=0; `AgentsScopedVerifier` aud `aep-api-mcp`. |
| `internal/platform/auth/task_token_manager.go` | TAKE | ✅ PRESENT (byte-parity) | diff=0; `AudienceMCP="aep-api-mcp"`, `IssueMCPToken`. |
| `internal/clients/agents/client.go` (→ `agentsvc`) | TAKE | ✅ ADAPTED | package renamed `agentsvc`; `MCPBlock`/`MCP` field (`client.go:88-96`); `mcpForTurn` (`genai/turn_runner.go:132`) builds it nil-safe/best-effort. |
| `internal/clients/agents/client_mcp_test.go` | TAKE | ⚠️ GAP | no test anywhere exercises MCP-block attach/omit/mint-failure on our turn payload (see Gaps). |
| `services/aep-api/skills/planner/task-breakdown/SKILL.md` | TAKE | ⚠️ GAP (orphaned) | byte-identical (diff=0) but never embedded/referenced by Go (`embed.go` lacks `PlannerFS`); see Gaps. |
| `services/aep-api/skills/embed.go` | TAKE | ⚠️ GAP | ours lacks upstream's `PlannerFS` + `TaskBreakdownSkillPath`. |
| `services/aep-api/skills/embed_test.go` | TAKE | ⚠️ GAP | absent — upstream's task-breakdown drift-guard test has no counterpart. |

## B. aep-api — task / execution / provisioning (the ADAPT crux) + SKIP of the DB task graph

**SKIP verification** (upstream's `component_tasks`-based files, correctly absent):

| upstream path | status | evidence |
|---|---|---|
| `codingagent/{dispatch_service,dispatch_cascade_hook,resource_watcher,*dbtest_test,dispatch_*_test,retry_guard_test,dispatcher_extres_test}.go` (11 files) | ✅ SKIPPED | all absent. Ours instead: `dispatcher.go`, `coding_executor.go`, `exec_watcher.go`, `watcher.go`, `job_template.go`, `externalsecret_template.go`, `build_auth.go` — independently built, GitHub-issue-based, no DB graph. |
| `task/{board_service,handlers,planner_skill,task_diff,task_stream,task_service_test,task_dbtest_test,*_test}.go` (12 files) | ✅ SKIPPED | all absent. Ours: `commands.go`, `reads.go`, `plan.go`, `plan_tap.go`, `projections.go`, `issue_compose.go`, `events.go`, `task_huma.go`, `repo_resolve.go`. `task_huma.go` exists in both but `git diff HEAD 1076be7` shows a full rebuild (`ComponentTask`/UUID ops → issueNumber `plan/list/get/execute/hold/unhold` over `PlanService`/`Reads`/`Commands`). |
| `contracts/{dispatch,task_state,task_state_test}.go` | ✅ SKIPPED | absent; `contracts.TaskEvent` seam re-expressed in `internal/contracts/taskmeta` (`block.go`, `derive.go`, `execution.go`, `labels.go`). |
| `testdata/harvest/golden/{get_board,get_task,get_tasks,get_tasks_generated}.json` | ✅ SKIPPED | absent (upstream's board/task-shape goldens). |
| `services/aep-api/internal/feature/gitrepo/issue_body.go` (+`_test`) | ✅ SKIPPED | fully deleted; role absorbed into `task/issue_compose.go` (over the taskmeta encoding). |
| Board-join-with-`component_tasks` logic | ✅ SKIPPED | `git grep component_tasks -- services/aep-api` → only guarded migration files + comments; no live read-model query. |

**ADAPT verification** (provisioning-as-issues capability, per §3.6):

| upstream capability | our equivalent | status | evidence |
|---|---|---|---|
| SYSTEM gate kinds (config-collection / resource-provisioning) | `taskmeta.ClassProvision` + `LabelProvision="aep:provision"` (`taskmeta/labels.go`); `KindProvision` (`execution.go:33`) | ✅ LIVE | minted in `provisioning/access.go` + `design_service.go` (`provisionMinter`), consumed by `execution/funnel.go`. |
| `depsAllDeployed` 3-way dispatch gating | `Funnel.depsGate` + `depDeployed` (`execution/funnel.go:284-337`) | ✅ LIVE, kind-aware | iterates `facts.DependsOn` (component) **and** `view.provisionDepsByComponent` (external/platform-resource), each checked `deriveStatus == StatusDeployed`; `ClassProvision` issues excluded from `aep:execute` admission. |
| Status projector | ABSENT — `deriveStatus` | ✅ CONFIRMED ABSENT | no `Projector` type/file; status computed on read (`execution/taskio.go:96`). |
| Readiness watcher | `provisioning.ResourceWatcher` (`readiness_watcher.go`) | ✅ LIVE | polls `bindings.GetBinding().IsReady()` (OC `ResourceReleaseBinding` Ready) → `Finish` + `CloseIssue` + `Reevaluate`. |
| `AccessRequest.ProviderTaskID` linkage | `providerTaskKey(project, issue)` → `<project>#<issue>` (`provisioning/access.go:249-253`) | ✅ LIVE, re-keyed | `ProviderIssueNumber`/`ProviderIssueURL` carry the GitHub ref. |
| Grant/reject cascade | `Service.OnComponentDeployed`→`GrantByProviderComponent` + `OnIssueClosed` (reject) | ✅ LIVE, wired | `app.go:825` `execWatcher.WithDeployObserver(provisioningSvc)`; grant fires on a succeeded build run (`exec_watcher.go:169`); reject on `registerWebhook("issues","closed", …)` (`app.go:809`). |
| `ExternalResource.Consumers` | design-scan `externalConsumersByName` (`provisioning/external_catalog.go:88-119`) | ✅ LIVE | repository has zero `Consumers`/`component_tasks` hits; scans committed design via `ProjectLister` + `DesignReader`. |
| Teardown on project delete | `Service.DeprovisionProject` (`provisioning/teardown.go:36`) | ✅ LIVE, invoked | `app.go:812` `SetResourceDeprovisioner`; `project_service.go:187-193` calls it in `DeleteProject` before OC/repo delete. |
| Declarative-wiring comment (ADR-0004) | `WiringResolver.PostResolvedDeps` (`provisioning/wiring.go:84-104`) via `codingagent.DependencyWiring` | ✅ LIVE, not dead | `app.go:819` `WithDependencyWiring(...)`; `coding_executor.go:201-208` posts it in the dispatch path; body starts `**Platform-resolved dependencies** …`. Platform never patches the CR. |
| `project/project_service.go` (+`_test`) | keep-ours + teardown graft | ✅ PRESENT | kept-ours, `DeprovisionProject` grafted cleanly (see teardown row). |

## C. agents service (TS) — SKIP the structured-output routes, TAKE the main-agent MCP additions

**SKIP verification:**

| upstream path | status | evidence |
|---|---|---|
| `services/agents-legacy/**` (entire dir) | ✅ SKIPPED | `ls` → no such dir; only historical design-doc prose remains. |
| `services/agents/src/agents/architect/**` | ✅ SKIPPED | dir gone; no architect route anywhere. |
| `services/agents/src/agents/document-generation/**` (+`skills/`) | ✅ SKIPPED | dir gone; zero repo hits. |
| `services/agents/src/agents/dsl-render/{route,route.test}.ts` | ✅ SKIPPED | dir gone. |
| `services/agents/src/agents/taskplanner/**` (8 files) | ✅ SKIPPED | deleted by the merge relative to upstream's own parent (`git diff 0e2b7db^2 0e2b7db`); our side never had them. |
| `services/agents/design/task-planner-contract-parity.md` | ⚠️ GAP | still present (net-new from merge, never removed) — documents deleted taskplanner code as live. |
| `services/agents/evals/taskplanner/**` | ⚠️ GAP | still present and **broken** — imports deleted `taskplanner/{schema,run,validator}.js`; `tsc -p tsconfig.playground.json` fails (TS2307). |
| `services/agents/playground/{tasks,tasks.test}.ts` | ⚠️ GAP | still present and broken — import deleted `taskplanner/run.js` + `contracts/sse-events.js`; orphaned (not wired into `playground.ts`). `playground.ts` itself is legitimately kept (general harness). |

**TAKE verification:**

| upstream path | bucket | status | evidence |
|---|---|---|---|
| `main/component-design.ts` (+`.test`) | TAKE | ✅ ADAPTED | re-homed to `@aep/agent-stream` (`checkComponentDesign`); test asserts `dependencies[]` works + `connections` rejected as SCHEMA_VIOLATION. |
| `main/prompt.ts` | TAKE (Bug A fix) | ✅ PRESENT | `grep -i connection` → 0 hits; `SEED_FILES` example uses `"dependencies": []`. Bug A stays fixed. |
| `main/bundle.test.ts` | TAKE | ✅ ADAPTED | re-homed to `packages/agent-stream/test/bundle.test.ts`; covers `kind:"platform-resource"`. |
| `shared/mcp-client.ts` (+`.test`) | TAKE | ✅ PRESENT (near-parity) | diff=25 (added doc-comment + `McpConfig` import-path swap to `@aep/agent-stream`) — cosmetic. |
| `server.ts` (+`.test`) | TAKE | ✅ PRESENT | `isMcpConfig()` guards `{url,token}` → 400 on malformed; test present. |
| `conversation/run-conversation-turn.ts` (+`.test`) | TAKE | ✅ PRESENT | shadow-guard `tools = {...mcpTools, ...tools}` (base wins); 3 explicit tests (merge / built-in-shadowing / absent). |
| `contracts/component-design.ts` | TAKE | ✅ ADAPTED | superseded/re-homed to `packages/agent-stream/src/{contracts/component-design.ts, component-design-schema.ts}` — 4-kind enum + `ConfigKey` + `candidates`. |
| `contracts/sse-events.ts` | TAKE | ✅ ADAPTED | re-homed to `packages/agent-stream/src/contracts/sse-events.ts` (imported by 17 files). |
| `shared/mock-model.ts` | TAKE | ✅ PRESENT | generic step-based mock; dependency scenarios composed via tool-call steps in fixtures. |
| `.env.example`, `Dockerfile`, `package.json` | KEEP-ours (keyless boot) | ✅ PRESENT | `ANTHROPIC_API_KEY` commented ("Evals/playground only … model per turn from X-Anthropic-Key"); Dockerfile/pkg have zero `ANTHROPIC`. Upstream's boot-time requirement correctly NOT adopted. |
| `evals/{cli,harness,harness.test}.ts`, `evals/main/fixtures/mcp-*.json`, `evals/mocks/mcp-server.ts` (+`.test`), `evals/{skills,skills.test}.ts` | TAKE | ✅ PRESENT | present + dependency-schema-shaped (`org-service`/`platform-resource`/`external` fixtures; mock MCP mirrors `mcp_server.go`'s 4 tools). |
| `skills/high-level-architecture/SKILL.md` | TAKE | ✅ PRESENT | 0 `connection` hits; 4 kinds + "Discover before you invent." naming the 4 discovery tools. |
| `skills/task-breakdown/SKILL.md` ↔ `aep-api/skills/planner/task-breakdown/SKILL.md` | TAKE | ✅ PRESENT (byte-identical) | `diff` → empty. (But the aep-api copy is orphaned on the Go side — see A / Gaps.) |

## D. Frontend (console-legacy dep UI + task-coupled CTAs) + apps/console

| upstream path | bucket | status | evidence |
|---|---|---|---|
| `services/api/{accessRequests,externalResources,provisioning,specs}.ts` | TAKE | ✅ PRESENT (byte-parity) | diff=0 for all four. |
| `pages/architecture/{DependenciesSection,DependencyDrawer,OrgServiceResolution,ExternalResourceValues,ProvideSpec,PlatformResourcePanel}.tsx` (+ tests, `buildProjectModel.test.ts`) | TAKE | ✅ PRESENT (byte-parity) | diff=0. |
| `pages/ExternalResourcesSettings.tsx` (+`.test`), `pages/OrgSettingsLayout.tsx` | TAKE | ✅ PRESENT (byte-parity) | diff=0. |
| `ui-components/cell-diagram-view/src/buildProjectModel.ts` | TAKE | ✅ PRESENT (byte-parity) | diff=0; reads `comp.dependencies`, `kind==='component'` → sibling edges, `external/org-service/platform-resource` → chain-link nodes. No `connections[]` remnant. |
| `ProjectArchitecturePage.tsx` (mount) | resolve-union | ✅ MOUNTED | imports (L71-72) + renders `<DependenciesSection>` (L787) + `<DependencyDrawer>` (L965); `?dep=` deep-link effect (L572-589). |
| `App.tsx` (client registration) | resolve-union | ✅ MOUNTED | registers all four token accessors (L50-53) + `external-resources` route under `OrgSettingsLayout` (L134). |
| `components/tasks/TaskDetailPanel.tsx` (+`.test`) | ADAPT | ✅ SKIPPED (correctly absent) | `ls` → absent; `grep componentTaskId` → 0 hits; CTA responsibility moved into the DependencyDrawer panels (byte-parity in row 1). |
| `components/tasks/TaskRow.tsx` (+`.test`) | ADAPT | ✅ ADAPTED | `status = task.derivedStatus`; renders `Waiting for: {task.dependsOn.join(', ')}` off the derived read model, not DB gate-array columns. |
| `services/api/types.ts` (`Dependency`/`DependencyKind`/`ConfigKey`/`DependencyCandidate` + `Task` gate fields) | TAKE + ADAPT | ✅ ADAPTED | dep vocabulary present (L96-119); `TaskView`/`TaskDetail` carry `dependsOn: string[]` + `derivedStatus` (our shape); zero hits for upstream's `externalResourceName`/`resourceName`/`dependsOn*`/`componentTaskId`. |
| `apps/console/**` (whole tree) | KEEP / accept-theirs | ✅ PRESENT (byte-parity) | `git diff HEAD 1076be7 --stat -- apps/console` **empty** — 100% identical to upstream tip (incl. our former `ProjectCreate.tsx` / `projects.$projectName.tsx` edits resolved to theirs). |

## E. Contracts, deployments/infra, docs

| upstream path | bucket | status | evidence |
|---|---|---|---|
| `packages/contracts/api/v1/openapi.yaml` — dep schemas | RECONCILE | ✅ PRESENT | `AccessRequest`, `ConfigKey`/`ConfigKeyDTO`, `Dependency`, `DependencyCandidate`, `ExternalResourceDTO` all present with real bodies; `SpecBundle` → equivalent `CollectSpecInput/OutputBody` (code-first naming). |
| `openapi.yaml` — #72 `nextCursor` | KEEP-ours | ✅ PRESENT | `grep -c nextCursor` = 1 (Go `ProjectList.NextCursor`). |
| `openapi.yaml` — #72 `search` param | KEEP-ours | ✅ PRESENT | `grep -c "name: search"` = 1 (Go `project_huma.go` `Search string query:"search"`). |
| `openapi.yaml` — #72 `prompt` on `CreateProjectRequest` | KEEP-ours | ⚠️ GAP | `grep -c prompt` = **0**; no `Prompt` field in the Go model. Lost at `429d5b5` (a code-first `make openapi` regen — pre-dates the #85 merge). See Gaps. |
| `packages/design-projection/src/project-design.ts` (+test) | TAKE | ✅ ADAPTED | `DEP_KIND_EDGE` (L63) + `dependencyEdges()` (L70); old `connections(` gone; test exercises all 3 kinds. |
| `deployments/scripts/env.sh` | TAKE | ✅ PRESENT | `OPENCHOREO_VERSION="1.1.1"` (L22). |
| `deployments/scripts/setup-aep.sh` | TAKE | ✅ PRESENT | applies `postgres-cnpg-{rbac,resourcetype}.yaml` + `workload-publisher-binding` ClusterAuthzRoleBinding. |
| `deployments/scripts/setup-prerequisites.sh` | TAKE | ✅ PRESENT | CNPG operator install (`cloudnative-pg`). |
| `deployments/scripts/setup-thunder-client.sh` | TAKE | ✅ PRESENT | `THUNDER_SKIP_SECURITY` save/restore around bootstrap. |
| `deployments/single-cluster/postgres-cnpg-{rbac,resourcetype}.yaml` | TAKE | ✅ PRESENT (byte-parity) | both exist, diff empty. |
| `deployments/docker-compose.yml` + helm `aep-api/deployment.yaml` | resolve-union | ✅ CORRECT | `AEP_API_INTERNAL_BASE_URL` present; agents block has **no** boot-time `ANTHROPIC_API_KEY` (kept ours). |
| `docs/decisions/ADR-0003-read-time-dependency-resolution.md`, `ADR-0004-declarative-dependency-wiring.md` | TAKE | ✅ PRESENT | substantive content. |
| `docs/glossary.md` | TAKE | ✅ PRESENT | `## Dependency management` block + "connection is banned" note. |
| `services/aep-api/design/dependencies.md` | TAKE | ✅ PRESENT | detailed feature design doc. |
| `CONTEXT.md` (root) — Dependency-management block | resolve-union | ⚠️ GAP | `grep -ic dependenc` = **0** (upstream = 6). Our `## Tasks` kept; upstream's `## Dependency management` glossary section never unioned in. See Gaps. |

**Noise / out of dependency-management scope** (existence-checked, not row-verified): `.agents/skills/{console-feature,domain-modeling,grill-with-docs,grilling}/*`, `.dockerignore`, `.gitignore`, `skills-lock.json` (Claude Code's own skill lock), root + `services/aep-api` `Makefile`, `services/aep-api/.env.example`, `pnpm-lock.yaml` (root + console-legacy — no conflict markers), `internal/config/{config,config_loader}.go` (diff is unrelated drift; `AEPInternalBaseURL` present). All present and intact.

---

## Gaps / anomalies (every ⚠️)

1. **`CreateProjectRequest.prompt` missing (openapi.yaml + Go model).** One of the three #72
   fields did **not** survive. Root cause: commit **`429d5b5`** (a code-first `make openapi` regen)
   clobbered the hand-authored field — the exact "OpenAPI spec-first regen hazard" already recorded
   in memory. **Predates the #85 merge** (not a merge regression), but it is currently live and
   user-visible: `apps/console/.../ProjectCreate.tsx:126` still sends `prompt` in the create-project
   mutation body (silently dropped server-side; also a `tsc` TS2353 error in `apps/console`). The
   other two #72 fields (`search`, `nextCursor`) survived. **Real gap — but pre-existing, not a
   dependency-management capability loss.**

2. **Confirmed-broken dead code in `services/agents` (SKIP leftovers).** The merge deleted upstream's
   taskplanner *implementation* but left its *support* files: `services/agents/evals/taskplanner/**`,
   `services/agents/playground/{tasks,tasks.test}.ts`, and the doc
   `services/agents/design/task-planner-contract-parity.md`. The first two import deleted modules
   (`taskplanner/{schema,run,validator}.js`, `contracts/sse-events.js`) and fail `tsc -p
   tsconfig.playground.json` (~18 TS2307/TS7006). This is invisible to `make typecheck`/`make test`
   because those only run the package.json scripts literally named `typecheck`/`test`, never the
   `:playground`/`:eval` variants. **Cleanup gap** (these belong to the intentionally-SKIP'd
   taskplanner route) — no capability impact, but broken files + a stale doc should be removed.

3. **`aep.version: "2"` skill-bump fragility (latent regression on the Bug A fix).** The vendored
   copy `services/aep-api/skills/flow/high-level-architecture/SKILL.md` carries a hand-added
   `metadata: aep.version: "2"` (added by `c3a9f5b`, the Bug A fix, so the version-gated reconcile
   re-pushes the migrated skill). The **root** source `skills/high-level-architecture/SKILL.md` does
   **not** have it, and `embed.go`'s `go:generate` regenerates `flow/` via a blind `rm -rf flow &&
   cp -R ../../../skills flow`. The next `make build` (which runs `make gen` first) will silently
   wipe the bump and revert the reconcile trigger. **Fix: add the same `metadata: aep.version: "2"`
   to the root `skills/high-level-architecture/SKILL.md`.** Highest-signal finding — a live fix is
   one `make build` away from silently regressing.

4. **`CONTEXT.md` missing the "Dependency management" glossary block.** `grep -ic dependenc` = 0 (vs
   6 upstream). Our `## Tasks` section was kept; upstream replaced its (absent) Tasks section with a
   `## Dependency management` terms block that was never unioned in. `docs/glossary.md` **does** carry
   the equivalent vocabulary, so the terms exist in the repo — but the root ubiquitous-language file
   is missing them. **Docs gap** — needs a manual union, not a regen.

5. **`skills/planner/task-breakdown/SKILL.md` vendored but orphaned (Go side).** The file is
   byte-identical to both upstream and the repo-root copy, but our `embed.go` lacks upstream's
   `PlannerFS` + `TaskBreakdownSkillPath`, and no Go code references it. The TS side
   (`services/agents/evals/skills.ts`, `playground/tasks.ts`) still documents an expectation that
   aep-api pushes this skill's raw bytes — a contract not fulfilled today. Our `task/plan.go` instead
   loads a differently-named `task-planning` flow skill from the org-skills git repo via `loadSkill`
   — **plausibly a deliberate supersession** by the GitHub-native tasks / org-skills-repo model
   (commit `495d066`), but it isn't documented anywhere. **Decide + record:** either wire the embed
   or delete the orphaned file + its missing drift-guard test (`embed_test.go`). Same root as the two
   task-breakdown embed rows.

6. **Test-coverage drops (2 items, low severity).**
   - `repositories/external_resource_repository_dbtest_test.go` was dropped whole at the merge. Its
     `Consumers()` tests were correctly obsolete, but its generic CRUD tests (`Upsert/Get/List/
     Delete`, byte-identical live code) lost coverage.
   - No test anywhere exercises the MCP-block attachment on the outbound turn payload (`mcpForTurn`
     in `genai/turn_runner.go`) — upstream's `client_mcp_test.go` had 3 cases (attach / omit-
     unconfigured / omit-on-mint-failure). Production code reads correct on inspection; only the
     regression test is missing.

7. **Minor / verified-harmless.** `design/design_service_test.go` (upstream, 47 lines) has no
   same-named file — coverage likely folded into `design_service_more_test.go`/`proceed_gate_test.go`
   (not line-for-line confirmed). `services/agents/evals/task-plan/task-plan.eval.ts`'s `designJson()`
   helper still emits legacy `connections[]` — 7/7 tests pass (that toolset treats seed design.json
   as inert context), but it's stale vocabulary worth updating.

---

## Divergences confirmed (intentional — per §8 divergence log, NOT gaps)

These are the ADAPT items where our behavior intentionally differs from the workspace. All match the
§3.6 resolved design and the §8 Phase-6 divergence log:

1. **Provisioning driven by a service, not a funnel Executor.** External secret values arrive in the
   drawer HTTP request body and cannot be persisted for a deferred registry Executor; so
   `provisioning.Service` drives provisioning directly, while the `provision` Execution still reuses
   `TryAdmit`/`Finish`/derive/gate and is Finished by the readiness watcher.
2. **SYSTEM `component_tasks` rows + projector + gate-array columns → `aep:provision` GitHub issues +
   `KindProvision` Executions + extended `depsGate`.** No DB gate state, no projector; status is
   `deriveStatus`-computed (matches ADR-0003 at the task layer).
3. **`depsGate` reads provision deps from the committed design** (Go augmentation via
   `DesignReader.ProvisionDepNames`), not from a task row's gate columns.
4. **`ExternalResource.Consumers` = committed-design scan**, not a `component_tasks` JSONB query.
5. **Access-request `ProviderTaskID` re-keyed to `<project>#<issue>`** (an org-publish `aep:provision`
   issue), not a DB task row.
6. **Teardown** enumerates OC `Resource`s / closes provision issues on project delete instead of
   reading `component_tasks`.
7. **Contracts / codec re-homed:** the `component-design` + `sse-events` contracts and
   `checkComponentDesign` live in `@aep/agent-stream`, not `services/agents/src/contracts/` — a
   packaging divergence, capability preserved.
8. **Agents service stays keyless-boot** (per-turn `X-Anthropic-Key`) — upstream's boot-time
   `ANTHROPIC_API_KEY` requirement deliberately not adopted.
9. **Trait/CORS sync scoped narrower than upstream's grant cascade** (dispatch-time + a standalone
   drift-watcher ticker, not re-fired on the deploy/grant moment) — an explicit `app.go` NOTE records
   dropping the `component_tasks`-keyed periodic watcher. Behavioral, intentional.

---

## Verdict

**Every dependency-management capability in upstream PR #85 is accounted for** — TAKEN (byte-parity
for the whole agnostic `dependencies/` feature, MCP server, OC Resource-model client, models,
migrations, FE dep UI, infra, ADRs), ADAPTED (the entire task-coupled provisioning surface rebuilt on
our GitHub-native substrate as `aep:provision` issues + `KindProvision` Executions + extended
`depsGate` + readiness watcher + declarative-wiring comment — all wired and live, no stubs, no dead
provisioning code), or consciously SKIPPED (upstream's `component_tasks` DB task graph, structured-
output agent routes, and `agents-legacy` are cleanly absent). **No dependency-management capability
was silently dropped.**

The ⚠️ items are **not capability gaps** in the dependency feature: (1) the missing #72 `prompt` field
is a pre-existing code-first-regen regression unrelated to #85; (2)/(5)/(7) are SKIP-leftover dead
code, an orphaned vendored skill, and stale eval vocabulary — cleanup, not lost function; (4) is a
docs union owed in `CONTEXT.md` (the vocabulary already lives in `docs/glossary.md`); (6) is two
missing regression tests over otherwise-correct live code. The one finding that warrants prompt action
is **(3)**: the `aep.version: "2"` skill bump exists only on the vendored copy and the next `make
build` will `go:generate`-overwrite it, silently reverting the Bug A reconcile trigger — a one-line
fix to the root `skills/high-level-architecture/SKILL.md`. None of these block the migration's
completeness claim; they are tracked follow-ups consistent with the playbook's "no permanent
half-migration" principle.
