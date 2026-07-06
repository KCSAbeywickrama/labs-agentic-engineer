# Handover — implement the four-surface S2S API refactor

> **Status: IMPLEMENTED** on `feat/s2s-identity-refactor` (one PR, 5 green commits). This runbook is retained for context; the as-built result and the deviations taken (leaner than the literal plan where the codebase argued for it) are recorded in `docs/design/internal-s2s-api.md` › *As-built*, and the operator summary is in `AGENTS.md` › Service-to-Service Auth.

**Audience:** an implementing agent (or engineer) picking this up cold.
**Source of truth (the *why* + full design):** `docs/design/internal-s2s-api.md`. Read it first — this doc is the *how* and the *acceptance*, it does not re-derive the design.
**Companion analysis:** `docs/api-routes-review.md` Part II (per-route inventory the design is built on).

## 0. Locked decisions (do not re-litigate)

- **Auth consolidation = clean move** (option a): relocate verifiers/minters/resolvers into `internal/auth/` and update every importer. No alias/shim layer.
- **One PR / one branch** for the whole thing (P0→P4). Keep phases as ordered, individually-green commits for reviewability, but ship as one PR.
- **Verification (no live cloud):** `test/delivery` is assumed **not runnable** here (needs `ANTHROPIC_API_KEY` + GitHub PAT + throwaway stack). Verify via **unit tests** (new `verify/`+`scope/` code) + the **authoring** integration suite + the **e2e browser flow** in §6. **Hard invariant: `asdlc-service/api/openapi.yaml` stays byte-identical** through P0 and P1 (no public route changes).
- **`/hooks` paths (Q4) default:** in this PR, **code-separate** webhook + connect-callback into the external surface and **collapse the webhook dual-mount to one** (`/webhooks/github`), but **keep the existing public paths** (no `/hooks/v1/...` rename) so the GitHub App callback URL + smee target don't need external reconfig. The prefix rename is a deferred follow-up. (If the human wants the rename now, they must also reconfigure the GitHub App + smee.)
- **`verification-failed` default:** delete it (dead-but-armed, `api-routes-review.md` §8.1) unless the human asks to wire the dependency-verifier flow.
- **`_dev/reset` default:** delete it (dead) — it moves to `/_dev/` only if a test needs it.

## 1. Target (recap from the design doc)

Four HTTP surfaces in one BFF binary, each its own mount + auth + (where applicable) spec:

| Surface | Root | Auth | Spec |
|---|---|---|---|
| public | `/api/` | Thunder user JWT + org gate | `api/openapi.yaml` (public) |
| internal S2S | `/internal/` | Task-JWT / publisher-cc (one `s2sAuth`) | `api/internal-openapi.yaml` (non-public) |
| external | `/hooks/`¹ | per-route HMAC / connect-state | `api/hooks-openapi.yaml` (non-public) |
| dev/test | `/_dev/` | none (registration-gated, loopback) | — |

¹ paths stay as-is this PR (see Q4 default). File/package separation happens regardless.

All auth lives under `internal/auth/` (`verify/`, `issue/`, `scope/`, `guard.go`, `jwks.go`); the four surfaces are visible in `api/` (one file each + `api/surfaces.go`). See design doc §7.

## 2. Implementation — phase by phase

Each phase ends green (`cd asdlc-service && make test`) before the next. All in one branch.

### P0 — auth consolidation (pure move, behavior-preserving)

Create `internal/auth/` and **move** (not rewrite) the existing logic into it; update all importers.

- `internal/auth/verify/userjwt.go` ← `middleware/jwt/jwt.go` + `middleware/jwtassertion/auth.go`
- `internal/auth/verify/taskjwt.go` ← verify half of `internal/platform/auth` `TaskTokenManager`
- `internal/auth/verify/publishercc.go` ← `PublisherTokenVerifier`
- `internal/auth/verify/hmac.go` ← webhook HMAC verifier (`internal/feature/webhook/verifier.go`)
- `internal/auth/verify/connectstate.go` ← `orgcreds` `BearerService.VerifyConnectState`
- `internal/auth/issue/taskjwt.go` ← mint half of `TaskTokenManager`; `issue/connectstate.go` ← `BearerService.IssueConnectState`
- `internal/auth/scope/org.go` ← `humakit.OrgScopedInput` + `Resolve` + gate mode (`SetGateMode`)
- `internal/auth/guard.go` ← `Public()` composing user-JWT verify + `middleware/orgensure` (mirrors today's `jwt(ensureOrg(...))`)
- `internal/auth/jwks.go` ← `middleware/jwtassertion/jwks_cache.go`
- **Split `humakit`:** it keeps *plumbing only* — `SecurityUserJWT`/`SecurityTaskJWT` scheme constants, `APIV1`, `ErrorFromStatus`. `OrgScopedInput`/gate leave it.
- Update the ~14 `internal/feature/*/*_huma.go` importers: `OrgScopedInput` now from `auth/scope`; they still use `humakit` for `APIV1`/`SecurityUserJWT`/`ErrorFromStatus`.
- `app.go`: swap the inline `jwt(ensureOrg(apiMux))` for `auth.Public(...)(apiMux)`.

**Acceptance:** compiles; `make test` green; **`make openapi`/`huma_guard_test` produces a byte-identical `api/openapi.yaml`**; zero behavior change.

### P1 — internal S2S surface (inbound runner→BFF), wire-preserving

- `middleware/s2s_auth.go` `S2SAuth(taskVerify, pubVerify)` — lift `taskController.authorizeRunnerCallback`: try Task-JWT (task-bound), then publisher-cc (org-bound); bind `tenant.Caller`; fail-closed 401. **Does not** do the path cross-check.
- `internal/auth/scope/runner.go` `RunnerScopedInput { TaskID string \`path:"taskId"\`; OrgHandle string \`json:"-"\` }` — `Resolve` reads the verified `tenant.Caller`, enforces `caller.Subject == TaskID` for Task-JWT (403, INT-6), binds `OrgHandle`. **Note:** read the path id from this struct's own `path:"taskId"` field, not `ctx.Param` (confirm against the Huma resolver API).
- `api/internal.go` — `newInternalAPI(internalMux)` (own security schemes `taskJWT`,`publisherCC`; spec/docs paths cleared), `RegisterAllInternal`, `GenerateInternalOpenAPIYAML`.
- `task.RegisterInternalTask` + `orgcreds.RegisterInternalCredentials` — convert the runner routes (`skills`, `verification-failed`, path-scoped `credentials/refresh`, and the unscoped `credentials/refresh`) to Huma ops embedding `RunnerScopedInput`, calling the **same services**. Same paths, same tokens.
- `api/surfaces.go` — introduce `mountSurfaces`: `mountPublic` + `mountInternal(S2SAuth)` + dev + discovery. `app.go` shrinks to call it.
- **Delete:** `TaskController` (interface + 3 handlers), `middleware/task_bearer.go` (`RequireTaskBearer`), `authorizeRunnerCallback`. Services they called stay.
- Check in `api/internal-openapi.yaml`; extend the drift guard to cover it.

**Acceptance:** runner routes respond identically (paths/status/tokens unchanged); `api/openapi.yaml` still byte-identical (internal routes were never in it); unit tests for `S2SAuth` (task / pub-cc / bad / absent bearer) and `RunnerScopedInput` (match → ok, mismatch → 403); `make test` + `cd test && make authoring` green.

### P2 — dev + external surfaces, cleanup

- **`/_dev/`:** `api/dev_routes.go` `RegisterAllDev` (registration-gated `TestMode && tier==dev`); move `testResetHandler`/`testSMAPIResyncHandler`/`collectResyncOrgs` out of `app.go`; repoint `deployments/scripts/repair-secrets.sh` to the new path; flip `DEPLOYMENT_TIER` default to non-dev in the config loader. Delete `_dev/reset` per the default.
- **`/hooks/`:** `api/external.go` `RegisterAllExternal` + `internal/auth/scope/hook.go` `HookScopedInput`; move webhook (`api/webhook_routes.go` + `internal/feature/webhook`) and connect-callback (`api/org_github_routes.go`) onto this surface; **collapse the webhook dual-mount** (drop the `/api/v1/webhooks/github` twin); each route keeps its own scheme (HMAC / connect-state) and binds org via the verified credential. Keep current paths (Q4 default).
- Retire the duplicate `credentials/refresh` (keep the path-scoped one); delete `verification-failed` per default.

**Acceptance:** dev + webhook + connect-callback are out of `app.go` and `/api`; webhook served at one path; `make test` + `make authoring` green; `api/openapi.yaml` no longer contains webhook/connect ops.

### P3 — specs + deployment routing

- `make openapi` regenerates all three checked-in specs (`api/openapi.yaml`, `api/internal-openapi.yaml`, `api/hooks-openapi.yaml`); drift guard loops over all three.
- Helm: split `deployments/helm-charts/wso2-ae-platform/templates/asdlc-api/httproute.yaml` — public/browser host serves `/api`,`/hooks`,`/auth`,`/healthz`,`/docs`,`/openapi`; a dedicated internal host/HTTPRoute serves `/internal`; `/_dev` on no route. Repoint the runner's `AGENT_PLATFORM_URL` (cloud only). **Compose unchanged** (design §5).

**Acceptance:** `helm template` renders; specs locked by the guard. (Cloud routing validated only if a cloud env exists; otherwise reviewed, not run.)

### P4 — outbound (BFF → agents), org-bound

- BFF: `internal/auth/issue/servicejwt.go` mints a short-lived JWT (`aud: agents-service`, `ocOrgId`, short `exp`) with the existing signing key; `clients/agents` (`ServiceTransport`) attaches it.
- agents-service (`agents/`): point JWKS/issuer config at the **BFF JWKS** for the agents audience; `middleware/org-id.ts` derives org from the verified claim (transitional `X-Oc-Org-Id` 403-cross-check, then drop); **pull `/internal/v1/dsl/render` under the gate** (move under `AGENTS_BASE`); delete the stale "needs org to call git-service" comment.
- Fresh-cluster cutover is direct (we control both sides); the dual-accept window matters only for a rolling prod deploy — note it, don't build it here.

**Acceptance:** BFF→agents calls carry org in the verified claim; agents reads org from the claim; `dsl/render` requires the JWT; the §6 e2e (which drives requirements/design/tasks generation through agents) passes.

## 3. Build & test commands

```bash
cd asdlc-service && make test                  # unit (run after every phase)
cd test && make authoring                       # authoring integration suite
# regenerate + drift-check specs (see Makefile openapi target / huma_guard_test.go)
```

`api/openapi.yaml` must be byte-identical after P0 and P1; after P2/P3 it must lose the webhook/connect ops and gain nothing internal.

## 4. After implementation — fresh cluster

CLAUDE.md mandates a **cluster-health pre-flight**: before any cluster op, delegate the check in `docs/operations/cluster-health.md` to an isolated `general-purpose` subagent and only proceed when it reports healthy.

```bash
bash deployments/scripts/teardown.sh            # tear down the existing k3d cluster
bash deployments/scripts/setup.sh               # fresh cluster (OC + Thunder + OpenBao + ESO + observability + ASDLC infra)
$EDITOR deployments/.env                         # ensure ANTHROPIC_API_KEY + GITHUB_APP_* are set (use existing values)
bash deployments/scripts/start.sh               # bring up the compose stack (BFF, agents, console, …)
```

Wait until the stack is ready (console reachable, `/healthz` ok). Re-run the cluster-health subagent before driving the browser.

## 5. Rebuild the changed images

The refactor changes the BFF and agents-service, so rebuild them into the local stack before testing:

```bash
cd deployments && docker compose up -d --build asdlc-api asdlc-agents-service
docker compose logs -f asdlc-api                # tail while testing
```

## 6. E2E browser flow (playwright-cli skill)

Drive the **console at http://localhost:8090** (login `admin` / `admin`) with the **playwright-cli** skill. This is `e2e_test_run.txt` expanded; it exercises **outbound** (requirements/design/tasks → agents) and **inbound** (implement-via-remote-agent → runner callbacks), so it validates the whole refactor.

1. **Settings check.** Open Settings → confirm **GitHub** and **Anthropic** are connected. If not, set them using the credentials in `deployments/.env` (Anthropic API key; GitHub App / PAT).
2. **Create a new project.**
3. **Requirements:** prompt the requirements chat with **"write a hello world svc"**; let it generate requirements.
4. **Design → Tasks:** generate **design**, then generate **tasks** from the design.
5. **Verify artifacts:** requirements, design, and tasks all present; the project **git repo is created**; **GitHub issues created** for the tasks.
6. **Implement via remote agent:** trigger implement; **confirm live agent logs stream** while it's in progress (this is the runner→BFF `skills` + `credentials/refresh` + progress path).
7. **Merge + deploy:** merge the PR; **verify the webhook-driven auto build and deploy** completes (task → building → deployed).

Capture screenshots at each major step. If a step fails, tail `docker compose logs -f asdlc-api` (and `asdlc-agents-service`) and report the failure with the log excerpt — do not paper over it.

## 7. Definition of done

- All phases merged in one PR; `make test` + `cd test && make authoring` green.
- `api/openapi.yaml` contains only public routes; `internal`/`hooks` specs checked in; drift guard covers all three.
- `app.go` is pure composition; all auth under `internal/auth/`; four surfaces visible in `api/`.
- Fresh cluster comes up; the §6 e2e flow reaches **task deployed** with live logs observed and the webhook build/deploy verified.
- Any deviation from the design doc decisions is surfaced to the human, not silently taken.

## 8. Decisions the human still owns (surface, don't guess)

- Q4: rename to `/hooks/v1/...` now (needs GitHub App + smee reconfig) vs keep current paths (handover default).
- Q2: serve the internal spec on the internal host vs file-only.
- Q5: give `/_dev` its own `127.0.0.1` listener in compose vs rely on the registration gate.
- publisher-cc retirement / refreshable-runner-identity (the D1 wart) — parked.
- Whether to wire `verification-failed` instead of deleting it.
