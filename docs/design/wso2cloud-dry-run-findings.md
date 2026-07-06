# wso2cloud Dry-Run Findings — Flow Traces & Fixes

> Working record of the wso2cloud (`development` env) dry run, June 2026. Cluster reached via the
> control-plane kubeconfig (`cloud-cp` context). Two test orgs: `anjanas` and `anjana112`.
> Pairs with `wso2cloud-dual-path-pr-analysis.md` (the dual-path canon) and
> `asdlc-service-modularization.md` §6.10/§7.13 (the seam list this dry run exercises).

## Topology (control plane, `dp-wso2cloud-*` namespaces)

| Component | Namespace | Pod |
|---|---|---|
| BFF (`asdlc-api`) | `dp-wso2cloud-app-factory-development-bad5f211` | `app-factory-api-development-*` |
| agents-service | same | `app-factory-agents-service-development-*` |
| console | same | `app-factory-console-development-*` |
| platform-api | `dp-wso2cloud-core-development-54e3d6ff` | `platform-api-service-development-*` |

- The BFF reaches OpenChoreo **only** through `platform-api` (`https://development-wso2cloud.gateway.dev.cloud.wso2.com/platform-api-service-platform-api-endpoint/...`), which resolves the org **handle** → canonical namespace `wc-<ouId8>-<hash8>` and forwards to the DP OC API (`https://api.openchoreo.dp.dev.cloud.wso2.com`).
- Org workload namespaces (`wc-*`) and coding-agent runner Jobs live on the **data plane**, NOT reachable from the `cloud-cp` kubeconfig. The CP-side signal for "is org X provisioned" is the platform-api proxy response (404 vs 200) and the BFF `[SHAKEOUT:ORG]` lines.

## Dry-run issue ledger

| # | Symptom | Root cause | Status |
|---|---|---|---|
| 1 | `anjanas`: create-project 500; projects list empty | Org namespace `wc-019edfce-f6886445` never provisioned on the DP (platform-api onboarding gap — modularization §7.13) | Platform-side; provision the OU |
| 2 | `anjanas`: skills list 0; `/skills/updates` 500 | Org GitHub PAT (`xlight05`) rejected by GitHub (401 Bad credentials) → `org-skills` repo can't be ensured | **FIXED** by re-supplying a valid PAT |
| 3 | `anjana112`: runner logs `skill pull/materialize failed … task skills endpoint returned 404` | Runner builds the skills URL with `new URL(absolutePath, base)`, which **drops the gateway path prefix** on `AGENT_PLATFORM_URL`. Cloud-only. | **FIXED** (see below) |
| — | `stage-build-secret … create git secret: not found: status 404` | Known ADR-0006 interim: cloud `/gitsecrets` unrouted (wso2cloud#319) → degrade to public-repo clone | Expected |
| — | kaje orgs: trait_sync `decrypt: gcm: cipher: message authentication failed` | Credential-encryption-key mismatch on older rows (not `anjanas`/`anjana112`) | Pre-existing; out of scope |

The `anjana112` happy path otherwise works end-to-end: project create → component → **proxy dispatch via publisher-cc** (`[SHAKEOUT:DISPATCH] proxy dispatch proceeding`, remote-worker ns `wc-019eef3c-5217de26-remote-worker`) → trait_sync reconciling. UI verified by the operator.

---

## Flow: per-task skills pull (the issue #3 path)

When a coding-agent task is dispatched, the runner pulls the task's resolved skills from the BFF and
materialises them into an AgentSkills plugin tree, so the agent has the org's custom/builtin skills.
It is **best-effort** — a failure logs and the agent continues with only the base `asdlc` plugin.

```
BFF dispatch (asdlc-service)                          Runner pod (remote-worker, oneshot.ts)
─────────────────────────────                        ──────────────────────────────────────
dispatch_service.go → job_template.go                main()
  ASDLC_TASK_ID       = task.ID                         taskId      = env ASDLC_TASK_ID
  ASDLC_PLATFORM_URL  = cfg.AgentPlatformURL  ───────►  platformURL = env ASDLC_PLATFORM_URL
  (publisher cc envs for gateway auth)                  bearer      = publisher cc token (cloud)
                                                              │
                                                        pullTaskSkills()  [lib/skills_pull.ts]
                                                          GET {platformURL}/internal/v1/tasks/{id}/skills
                                                              │  Authorization: Bearer <cc|taskJWT>
                                                              ▼
GET /internal/v1/tasks/{taskId}/skills  ◄──────────────────  (via cloud gateway → BFF)
  api/app.go:164 → taskController.Skills
    authorizeRunnerCallback (TaskJWT OR publisher cc)
    TaskSkillsService.SkillsForTask:
      taskRepo.GetByID → ErrTaskNotFound ⇒ 404
      store.ReadDesign(org, project) → design.SkillsApplied
      skillSvc.ResolveMany(org, names) @ HEAD of org-skills repo
    → 200 { data: { skills: [{ id, materializedName, kind, skillMd, references }] } }
                                                              ▼
                                                        materializeSkills() → .asdlc/skills-plugin/
                                                        runClaudeQuery({ skillsPluginDir, preloadBuiltinNames })
```

### Why it 404'd in cloud (and not locally)

`AGENT_PLATFORM_URL` differs per plane:

| Plane | `AGENT_PLATFORM_URL` | Has path prefix? |
|---|---|---|
| local (`deployments/docker-compose.yml:68`) | `http://host.k3d.internal:9090` | no |
| wso2cloud (BFF pod env) | `https://development-wso2cloud.gateway.dev.cloud.wso2.com/app-factory-api-app-factory-api-endpoint` | **yes** — `/app-factory-api-app-factory-api-endpoint` |

The cloud gateway routes the BFF under the prefix `/app-factory-api-app-factory-api-endpoint` (and
strips it before forwarding to the BFF service). Every runner→BFF callback must keep that prefix:

- `credentials/refresh` — `oneshot.ts:140`: `` `${base}/internal/v1/tasks/${id}/credentials/refresh` `` (string concat) → **keeps** prefix ✓
- `verification-failed` — `runner.ts`/`credhelper.ts`: `` `$ASDLC_PLATFORM_URL/internal/v1/tasks/$id/verification-failed` `` (shell concat) → **keeps** prefix ✓
- **skills pull** — `skills_pull.ts:61`: `new URL("/internal/v1/tasks/${id}/skills", base)` → an **absolute path replaces the whole path of `base`**, so the prefix is **dropped**:

```
base = https://…gateway…/app-factory-api-app-factory-api-endpoint
new URL("/internal/v1/tasks/<id>/skills", base)
  ⇒ https://…gateway…/internal/v1/tasks/<id>/skills      ← prefix gone
  ⇒ gateway has no route at "/api/v1/..." root ⇒ 404 (never reaches the BFF)
```

Locally there is no prefix, so `new URL` happens to produce the correct path — which is exactly why
this is a silent cloud-only break (the §6.13 "behavior not knowable from code alone" class). It is the
same failure family as webhook PR #31 (gateway forwards `/api/v1/webhooks/github`, BFF only mounted
`/webhooks/github`): a path-prefix mismatch that single-plane testing masks.

Confirmation from cloud logs: the BFF logged the `anjana112` **dispatch** (`task d2a42549-…`) but never
logged a `GET /tasks/<id>/skills` — consistent with the request 404ing at the gateway before reaching
the BFF, while the dispatch/trait_sync calls (which use the correctly-prefixed platform-api URL) all
arrived.

### Fix

Build the skills URL by **appending to the base path** (preserving any prefix), matching the
string-concat pattern used by every other runner callback. Isolated to `remote-worker/src/lib/skills_pull.ts`:

```ts
// before
const base = new URL(args.platformURL);
const url = new URL(`/internal/v1/tasks/${encodeURIComponent(args.taskId)}/skills`, base);

// after — keep the base path prefix (gateway routes under it in cloud)
const base = args.platformURL.endsWith("/") ? args.platformURL.slice(0, -1) : args.platformURL;
const url = new URL(`${base}/internal/v1/tasks/${encodeURIComponent(args.taskId)}/skills`);
```

Requires rebuilding + pushing the runner image
(`docker.io/xlight05/app-factory-coding-agent-runner:latest`) for the cloud runner to pick it up.

---

## Improvement opportunities (beyond the one-line fix)

1. **Centralise runner→BFF URL building.** Three call sites independently concatenate
   `${ASDLC_PLATFORM_URL}/api/v1/tasks/{id}/...` (skills, credentials/refresh, verification-failed) in
   TS and shell. One `taskCallbackURL(base, taskId, suffix)` helper (prefix-safe, trailing-slash-safe)
   would have prevented this and prevents the next one. The shell credhelper should derive from the
   same convention.
2. **Make `/skills/updates` degrade like `list`.** `skillController.Updates` returns 500 on a GitHub/repo
   failure while `List` degrades to an empty catalog (issue #2). The updates badge should never 500 the
   page; degrade to "no updates" on resolver/repo error.
3. **Surface the org-provisioning gap as a first-class error** (issue #1). The BFF already returns
   `ErrOrganizationNotProvisioned`, but the console shows a generic 500 on create-project. A typed
   "organization not provisioned yet" response (with the §7.13 onboarding hint) would make dry-run
   onboarding self-diagnosing. Tie to resolving the §7.13 open item: the cloud per-tenant namespace
   bootstrap trigger.
4. **Contract-test the runner callbacks against a prefixed base.** A unit test that builds each runner
   callback URL from `https://host/PREFIX` and asserts the prefix survives would lock all three paths
   and any future addition.
