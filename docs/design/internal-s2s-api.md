# Internal Service-to-Service API — design

**Status:** **IMPLEMENTED** on branch `feat/s2s-identity-refactor` (one PR, 5 ordered green commits). Built leaner than the original §7 vision where the codebase argued for it — see *As-built* below. The concise operator-facing summary lives in `AGENTS.md` › Service-to-Service Auth.
**Scope:** `asdlc-service` (BFF), `agents/` (agents-service), `deployments/` (compose + gateway routing)
**Related:** `docs/design/internal-s2s-api-handover.md` (implementation handover), `docs/api-routes-review.md` Part II (§7–§8), `docs/design/bff-openapi-huma-migration.md`, `docs/design/auth-local-vs-cloud-flow.md`

### As-built (deviations from the original plan, surfaced not silent)

- **D2 outbound** — done as designed: BFF mints a per-call org JWT
  (`TaskTokenManager.IssueServiceToken`, aud `agents-service`, `ocOrgId`), agents
  verifies vs the BFF JWKS and reads org from the claim; `X-Oc-Org-Id` dropped;
  `dsl/render` pulled under the gate (JWT mounted at `INTERNAL_V1` root).
- **P0 / §7 auth tree** — built *coarse*, not the full `verify/issue/scope`
  shred. The evidence: 3 of 5 credentials fuse mint+verify on one key
  (`TaskTokenManager`, `BearerService`) or are a 4-file feature pipeline
  (webhook), so the fine split fought the types. `OrgScopedInput` **stays in
  `humakit`** (all 14 consumers also use `humakit.APIV1`/`SecurityUserJWT` — one
  cohesive public-edge gate kit); the new `RunnerScopedInput` lives in
  `internal/auth/scope`. Visibility comes from `api/surfaces.go`, not a physical
  relocation of working verifiers.
- **§3.3 unscoped `/internal/v1/credentials/refresh`** — **kept** (with
  `RequireTaskBearer`): the runner still calls it, so it retires with WS2.6, not
  here. `verification-failed` was already removed as a subsystem (nothing to do).
- **D6 external `/hooks`** — built *lean*: webhook + connect-callback are already
  single-mount, in their own files, with bespoke per-route auth; kept at their
  current paths (Q4 default — no GitHub-side reconfig) rather than a new Huma API
  + `hooks-openapi.yaml` + `HookScopedInput` (ceremony for two routes).
- **D3 routing split** — **opt-in** via `asdlcApi.internalHostname` (unset =
  current single `/` route; set = public host narrowed + dedicated internal
  host + `bff.internalURL` repoints the runner). Non-breaking for existing
  cloud; reviewed-not-run (no cloud env in the build session).

## 1. Problem

"Service-to-service" in this platform is **two directions** with **unrelated auth**, and neither is a first-class, maintainable seam:

| Direction | Real edge | Auth today | Problem |
|---|---|---|---|
| **Inbound** (BFF *serves*) | **runner pod → BFF** (`/internal/v1/tasks/{taskId}/{skills,verification-failed,credentials/refresh}`, `/internal/v1/credentials/refresh`) | dual: BFF-signed per-task JWT **or** Thunder publisher client-credentials | scattered raw `mux.HandleFunc`; `authorizeRunnerCallback` re-invoked per handler; the `claims.TaskID == {taskId}` fence (INT-6) re-implemented per handler; publicly routable; not in (and absent from) any spec; a duplicate refresh route |
| **Outbound** (BFF *calls*) | **BFF → agents-service** (`/internal/v1/agents/*`) | BFF M2M client-credentials token (aud `agents-service`) + **trusted** `X-Oc-Org-Id` header | org is taken from a header never bound to the token — any holder of the token can name any org (`docs/api-routes-review.md` §3.4) |

The public edge (`/api/v1`) already solved the maintainability half of this for inbound user traffic: a code-first Huma API on its own mux, **one** auth wrapper (`jwt(ensureOrg(apiMux))`), a by-construction tenant gate (`humakit.OrgScopedInput.Resolve`), one registry (`RegisterAllHuma`), its own served spec. The internal surface never got that treatment. **This design gives `/internal` the same treatment, and fixes the outbound org-binding, so S2S is one coherent, secure pattern in both directions.**

Webhook (GitHub HMAC) and the GitHub connect-callback (state-JWT) are a *different trust domain* again — **external-inbound**, where the caller is GitHub or a mid-OAuth browser and the org is carried by the payload/credential, not a session or service token. They are not internal S2S and not user-facing, so they get their own (fourth) surface — see §3.5.

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| **D1** | **Inbound: keep the dual token (Task-JWT + publisher-cc), unify verification into one `s2sAuth` middleware** over the `/internal` subtree. | Preserves the wire contract — runner images unchanged, lowest risk. publisher-cc exists because a long build can outlive the dispatch-time per-task JWT and the cc token is re-mintable; dropping it is a separate migration. The org-not-task wart of publisher-cc is **retained and documented** (see §7), not closed here. |
| **D2** | **Outbound: the BFF self-signs a short-lived org-bearing JWT** (same signing key + JWKS as task tokens) for every agents call; agents verifies it against the BFF JWKS and derives org from the claim. `X-Oc-Org-Id` becomes a 403-on-mismatch cross-check (then removed). | Binds org to the credential so it can't be set independently of the caller. Reuses existing machinery (the BFF already signs RS256 + publishes JWKS for task tokens), so the BFF becomes the single issuer for both BFF-controlled tokens. No dependency on a Thunder custom-claim feature. |
| **D3** | **Boundary: code seam + gateway routing** (one process, one port). Separation = the `/internal` mux + `s2sAuth` + a **dedicated internal HTTPRoute/host** so the public browser host stops serving `/internal`. | Minimal wiring; no second listener to operate. The cross-plane runner keeps reaching `/internal` by pointing `AGENT_PLATFORM_URL` at the internal host (still in-cluster-reachable, just off the browser host). Accepts that a misconfigured route *could* re-expose `/internal` — auth still protects it (defense-in-depth, not the only line). |
| **D4** | **Shape: a separate internal Huma API** (`internalMux` + `newInternalAPI` + `RegisterAllInternal`) emitting **its own non-public OpenAPI**, in its own package — code-separated from the public surface. | Satisfies "internal endpoints separated from the public OpenAPI spec" with a real typed runner contract + drift guard, consistent with how the public side is built. The public `/openapi.yaml` stops misrepresenting the internal surface. |
| **D5** | **A third, separate dev/test surface** under its own root (`/_dev/v1/`), plain handlers, **no request auth**, **registration-gated to dev tier**, never routed publicly, in no spec. | The `_test` routes are neither public nor S2S — they're local tooling. Isolating them pulls the `testResetHandler`/`testSMAPIResyncHandler` bodies and the `if TestMode && tier==dev` branches out of `app.go` (less to maintain) and makes the security model explicit: safety is **registration gate + network isolation**, not a token (so "no auth" is correct *by construction*, not an oversight). |
| **D6** | **A fourth, external-inbound surface** (`/hooks/v1/`) for webhook + connect-callback: public-reachable, each route keeps its **own** auth scheme (GitHub HMAC; signed connect-state), org derived from the **verified** payload/credential and bound to `tenant.Caller`. | These are external callers (GitHub, browser) whose org is carried by the payload, not a bearer — so they fit neither `s2sAuth` (no bearer) nor `OrgScopedInput` (no user session). Giving them a home gets them out of `/api/v1/...` (where webhook + callback sit confusingly today) and applies the same by-construction org-binding discipline. One-time cost: GitHub App webhook + callback URLs reconfigured (or keep current paths and only code-separate, if avoiding GitHub-side changes). |

## 3. Target architecture — four separated surfaces

```
                                     outer mux (net/http)
 ┌──────────────────────┬──────────────────────┬──────────────────────┬──────────────────────┐
 │  /api/   (PUBLIC)     │  /internal/ (S2S)    │  /hooks/ (EXTERNAL)   │  /_dev/  (DEV/TEST)   │
 │                       │      (NEW)           │      (NEW)            │      (NEW)            │
 │ jwt(ensureOrg(apiMux))│ s2sAuth(internalMux) │ per-route scheme      │ (gated mount, NO auth)│
 │       │               │        │            │ (HMAC / state-JWT)    │        │             │
 │  newHumaAPI           │  newInternalAPI      │  RegisterAllExternal  │  RegisterAllDev      │
 │  RegisterAllHuma      │  RegisterAllInternal │  HookScopedInput      │  plain handlers      │
 │  OrgScopedInput       │  RunnerScopedInput   │  (org from payload)   │  registration-gated  │
 │  → /openapi.yaml      │  → internal spec     │  public-reachable     │  to dev tier         │
 │    (gateway host)     │    (file/non-public) │  (GitHub + browser)   │  NO spec, never public│
 └───────────────────────┴──────────────────────┴──────────────────────┴──────────────────────┘
   user identity            service identity        external-inbound         local tooling
   (Thunder JWT)            (Task-JWT / pub-cc)     (org from verified         (gate + network,
                                                    payload/credential)        no token)

   Discovery (/healthz, /auth/external/jwks.json, /openapi.yaml, /docs): public, no auth,
   own mounts — unchanged; live with /api on the public host.
```

| | Public edge (exists) | Internal S2S (new) |
|---|---|---|
| Mux | `apiMux` | `internalMux` |
| Huma API ctor | `newHumaAPI` | `newInternalAPI` |
| Mount (`app.go`) | `mux.Handle("/api/", jwt(ensureOrg(apiMux)))` | `mux.Handle("/internal/", middleware.S2SAuth(taskTokens, publisherVerifier)(internalMux))` |
| Auth seam | user identity (Thunder JWT + orgensure) | service identity (Task-JWT **or** publisher-cc), one verifier |
| By-construction gate | `humakit.OrgScopedInput.Resolve` (org from token) | `s2skit.RunnerScopedInput.Resolve` (task/org from signed claim; `claim.TaskID == {taskId}` here) |
| Registry | `RegisterAllHuma` | `RegisterAllInternal` |
| Spec | `/openapi.yaml` (gateway host) | `GenerateInternalOpenAPIYAML()` → file / internal-only path; never on the browser host |
| Security schemes | `userJWT` | `taskJWT`, `publisherCC` |

### 3.1 New: `s2sAuth` middleware (inbound verifier, one place)

Lifts `taskController.authorizeRunnerCallback` out of the controller and generalizes it to wrap the whole subtree. It verifies the bearer once and attaches the authorized caller to context; it does **not** do the path cross-check (that's the resolver's job, so it stays route-aware).

```go
// middleware/s2s_auth.go (sketch)
func S2SAuth(task *auth.TaskTokenManager, pub *auth.PublisherTokenVerifier) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            tok, ok := bearer(r)
            if !ok { unauthorized(w); return }
            // Task-JWT first (BFF-signed, task-bound), then publisher-cc (org-bound).
            if c, err := task.Verify(tok); err == nil {
                next.ServeHTTP(w, r.WithContext(tenant.With(r.Context(), tenant.Caller{
                    Org: tenant.OrgHandle(c.OcOrgID), Subject: c.TaskID, Source: tenant.SourceTaskJWT})))
                return
            }
            if pub != nil {
                if c, err := pub.Verify(tok); err == nil {
                    next.ServeHTTP(w, r.WithContext(tenant.With(r.Context(), tenant.Caller{
                        Org: tenant.OrgHandle(c.OrgHandle), Source: tenant.SourcePublisherCC})))
                    return
                }
            }
            unauthorized(w)
        })
    }
}
```

### 3.2 New: `s2skit.RunnerScopedInput` (by-construction fence)

The analogue of `humakit.OrgScopedInput`. Embedding it makes an internal op runner-scoped-by-construction; its `Resolve` is the INT-6 fence — **one** place instead of three handlers, and the natural home for any future per-task tightening of the cc path.

```go
// internal/platform/s2skit/runner_scoped.go (sketch)
type RunnerScopedInput struct {
    TaskID    string `json:"-"` // server-set from path, validated against the claim
    OrgHandle string `json:"-"` // server-set from the verified caller
}
func (i *RunnerScopedInput) Resolve(ctx huma.Context) []error {
    caller := tenant.CallerFromCtx(ctx.Context())   // set by S2SAuth
    pathTask := ctx.Param("taskId")
    if caller.Source == tenant.SourceTaskJWT && caller.Subject != pathTask {
        return []error{huma.Error403Forbidden("task bearer does not match path")} // INT-6
    }
    // publisher-cc: org-scoped only (D1 wart) — task must belong to the claimed org,
    // enforced by the handler's service lookup as today.
    i.TaskID, i.OrgHandle = pathTask, string(caller.Org)
    return nil
}
```

### 3.3 Routes moved onto the internal API

`execution.RegisterInternalSkills` + `orgcreds.RegisterInternalCredentials` register these as Huma ops embedding `ExecutionScopedInput`, calling the **same services** (no domain logic moves). The path key is the **execution id** (tasks-github-native §9.2 re-keyed the runner callbacks from task to execution):

| Op | Path | Security | Change |
|---|---|---|---|
| `runner-skills` | `GET /internal/v1/executions/{executionId}/skills` | taskJWT, publisherCC | from raw handler → Huma op |
| `runner-refresh-credentials` | `POST /internal/v1/executions/{executionId}/credentials/refresh` | taskJWT, publisherCC | from raw handler → Huma op; **canonical** |
| ~~`runner-verification-failed`~~ | ~~`POST /internal/v1/tasks/{taskId}/verification-failed`~~ | — | deleted (was dead; see §6) |
| ~~`credentials-refresh`~~ | ~~`POST /internal/v1/credentials/refresh`~~ | — | **retire** (duplicate of the path-scoped one; `docs/api-routes-review.md` §3.4) |

`TaskController` (interface + three handlers), `middleware.RequireTaskBearer`, and `taskController.authorizeRunnerCallback` are deleted; the services they called stay.

### 3.4 Dev/test surface (D5)

A third, deliberately minimal surface — **not** Huma, **not** authenticated, **not** in any spec — for local-only tooling. One gated mount on the outer mux, one small registry, handler bodies out of `app.go`.

```go
// api/dev_routes.go (sketch)
// Mounted ONLY when the dev fence passes; otherwise the subtree does not exist.
func RegisterAllDev(mux *http.ServeMux, p AppParams) {
    if !(p.Config.TestMode && p.Config.DeploymentTier == "dev") {
        return // registration gate — the surface is absent in every non-dev env
    }
    mux.HandleFunc("POST /_dev/v1/reset", devResetHandler(p))      // was /api/v1/_test/reset
    if p.Config.LocalOpenBaoRepairEnabled {
        mux.HandleFunc("POST /_dev/v1/sm-api-resync", devResyncHandler(p)) // was /internal/v1/_test/sm-api-resync
    }
}
```

| Route | Was | Auth | Notes |
|---|---|---|---|
| `POST /_dev/v1/reset` | `/api/v1/_test/reset` | none | DB truncate. **Dead today** (`docs/api-routes-review.md` §8.1) — delete unless a test needs it; if kept, it lives here, not on `/api`. |
| `POST /_dev/v1/sm-api-resync` | `/internal/v1/_test/sm-api-resync` | none | Emits decrypted reseed bundles. `deployments/scripts/repair-secrets.sh` updates to the new path. |

**Security model (explicit):** the dev surface carries **no request auth on purpose**. Its safety rests on two structural gates, neither of which is a token:
1. **Registration gate** — `RegisterAllDev` mounts nothing unless `TestMode && DeploymentTier=="dev"` (and `LocalOpenBaoRepairEnabled` for the resync). In any real env the routes *do not exist*. `DEPLOYMENT_TIER`'s default flips to non-dev (§5) so this gate is fail-safe, not fail-open.
2. **Network isolation** — `/_dev/` is on no HTTPRoute (public or internal); reachable only on the local/loopback interface the dev scripts use.

This is why "they don't need auth" is correct *by construction* rather than a regression: a plaintext-secret endpoint is acceptable precisely because it is unreachable anywhere it could leak. The `testResetHandler`, `testSMAPIResyncHandler`, `collectResyncOrgs` bodies and the dev branches move out of `app.go` into `api/dev_routes.go`.

### 3.5 External-inbound surface (D6)

The fourth surface: callers are **outside** the platform (GitHub, a mid-OAuth browser), there is **no bearer and no user session**, and the org is carried by the payload/credential. Public-reachable like `/api` (GitHub and the browser must reach it), but its own auth — *per route*, because the two schemes are unrelated. The unifying discipline is org-binding: each route derives org from the **verified** credential and binds `tenant.Caller`, so handlers stay org-scoped exactly like the other three surfaces.

| Route | Was | Auth scheme | Org resolution |
|---|---|---|---|
| `POST /hooks/v1/github/webhook` | `/webhooks/github` + `/api/v1/webhooks/github` (two mounts → one) | GitHub HMAC-SHA256, per-org secret, constant-time | from payload routing key (installation id / repo) → looked up → **HMAC verifies it**: a forged payload naming org X fails unless the caller holds X's secret |
| `GET /hooks/v1/github/connect/callback` | `/api/v1/github/connect/callback` | BFF-signed connect-state JWT in `?state` (HS256) | `ocOrgId` claim inside the signed state; signature is the proof |

```go
// internal/platform/hookkit/hook_scoped.go (sketch) — org from a VERIFIED credential
type HookScopedInput struct {
    OrgHandle string `json:"-"` // server-set after the route's own auth has verified the credential
}
// Each route's handler (HMAC verify / state-JWT verify) sets the verified caller;
// HookScopedInput.Resolve reads it and binds OrgHandle — never from a raw header/param.
```

Why a surface, not a fold-in: webhook + connect can't share `s2sAuth` (no bearer) or `OrgScopedInput` (no user session), so forcing them into `/internal` or `/api` would pollute those verifiers. A dedicated `RegisterAllExternal` registry + `hookkit` keeps each scheme explicit while giving them the same org-binding guarantee. **Open:** whether to move to `/hooks/v1/...` (reconfigures the GitHub App webhook + callback URLs, one-time) or keep today's paths and only code-separate the package (no GitHub-side change). Either way the webhook **dual-mount collapses to one** (`docs/api-routes-review.md` §3.3) and webhook/callback leave the `/api/v1` namespace.

## 4. Target architecture — outbound (BFF → agents)

### 4.1 BFF side
- A `ServiceTokenManager` (reuse the existing RS256 signing key behind `TaskTokenManager`/JWKS) mints a **short-lived JWT** per outbound agents request: `aud: agents-service`, `ocOrgId: <active org>`, short `exp`.
- The agents HTTP client (`clients/agents/`, `ServiceTransport`) attaches that token as the bearer. `X-Anthropic-Key` stays a forwarded header (it is a capability/secret the BFF resolved, not identity). `X-Oc-Org-Id` is sent during migration as a cross-check, then dropped.

### 4.2 agents-service side (`agents/`)
- `JWKS_URL` / issuer config points at the **BFF JWKS** (`<bff>/auth/external/jwks.json`) for these calls; `jwtAuthMiddleware` verifies `aud: agents-service`.
- `middleware/org-id.ts` derives org from `res.locals.tokenClaims.ocOrgId` instead of the raw header. Transitional: if `X-Oc-Org-Id` is present it must equal the claim (403 on mismatch); then the header read is removed.
- **`/internal/v1/dsl/render` comes under the gate.** Today it sits one path-segment *above* `AGENTS_BASE` (`/internal/v1/agents`), so it is entirely unauthenticated (`docs/api-routes-review.md` §8.2). Move it under `AGENTS_BASE` (e.g. `/internal/v1/agents/dsl/render`) — or mount the auth chain on `/internal/v1` — so it inherits the same BFF-signed-JWT verification as the rest of the agents surface. It is part of this outbound edge, not a separate concern.
- The stale "needs org to call git-service" comment is removed (skill bodies + the Anthropic key are already forwarded, not looked up by org).

This makes the BFF the single issuer for both BFF-controlled tokens (per-task inbound, per-request outbound), both verified against the same BFF JWKS — symmetric, one rotation story.

## 5. Boundary / deployment (D3)

**The boundary is the code seam** — the path prefix + each surface's auth (`jwt(ensureOrg)` on `/api`, `s2sAuth` on `/internal`, per-route scheme on `/hooks`, registration gate on `/_dev`). That is pure BFF code and behaves identically in every environment. The **network host-split is a cloud-only layer added on top** — it does not exist in compose, and the design must not require it there.

**Cloud (helm).** One BFF process + port. The public HTTPRoute (`deployments/helm-charts/wso2-ae-platform/templates/asdlc-api/httproute.yaml`, currently `value: /`) is split:
- **Browser/public host:** `/api`, `/hooks` (external callers must reach it), `/auth`, `/healthz`, `/docs`, `/openapi`.
- **Dedicated internal host/HTTPRoute:** `/internal`, locked-down policy. The runner's `AGENT_PLATFORM_URL` (today `bff.publicURL`) points here, not the browser host — still reachable cross-plane, just off the public browser surface.
- **`/_dev`:** on **no** HTTPRoute at all — reachable only on the local/loopback interface. `DEPLOYMENT_TIER`'s default flips to non-dev so its registration gate is fail-safe.

**Local (docker-compose).** No gateway, so no host-split — and none is needed. `asdlc-api:9090` is published to the developer's host; the k3d runner reaches it via `host.k3d.internal:9090` (**unchanged** — `AGENT_PLATFORM_URL` is not repointed locally). All four surfaces share that port; that is acceptable because it is a single-developer stack and every surface is still auth/gate-protected. So **P1's code changes alone make compose work; the host-split is helm-only.**
- *Optional local hardening for `/_dev`:* since the repair scripts run on the host (loopback works) and the k3d runner never calls `/_dev`, the dev surface can be bound to a separate `127.0.0.1`-only listener in compose — the compose analogue of "off the public surface," without a gateway. Cheap, optional, not required for P1.

## 6. What changes, concretely

**BFF**
- New: `api/internal_api.go` (`newInternalAPI`, `RegisterAllInternal`, `GenerateInternalOpenAPIYAML`), `internal/platform/s2skit/` (`RunnerScopedInput`, `CallerFromCtx`), `middleware/s2s_auth.go`, `internal/platform/auth` service-token minter, `api/dev_routes.go` (`RegisterAllDev` + the moved `devReset`/`devResync`/`collectResyncOrgs` handlers), `api/external_routes.go` (`RegisterAllExternal`) + `internal/platform/hookkit/` (`HookScopedInput`) — the webhook (`webhook_routes.go`) and connect-callback (`org_github_routes.go`) mounts move here, webhook dual-mount collapsed to one.
- Changed: `api/app.go` — replace the scattered `/internal/v1/*` `HandleFunc` block + the `taskMux`/`RequireTaskBearer` mount with one `mux.Handle("/internal/", S2SAuth(...)(internalMux))`; replace the `if TestMode && tier==dev { … }` block + the inline `testResetHandler`/`testSMAPIResyncHandler` bodies with one `RegisterAllDev(mux, params)` call; `clients/agents/` attaches the org-JWT. `app.go` shrinks to pure composition.
- Deleted: `TaskController` raw handlers + interface, `middleware/task_bearer.go` (`RequireTaskBearer`), `taskController.authorizeRunnerCallback`, the unscoped `/internal/v1/credentials/refresh` route. `verification-failed` either wired to the dependency-verifier flow or removed (it is dead-but-armed — `docs/api-routes-review.md` §8.1).
- New: `make openapi-internal` + a drift guard for the internal spec (mirrors the public one).

**agents-service**: JWKS/issuer config → BFF JWKS for the agents audience; `org-id.ts` reads org from the verified claim; remove the stale comment.

**deployments**: split HTTPRoute (public host serves `/api`+`/hooks`, internal host serves `/internal`); repoint `AGENT_PLATFORM_URL` (cloud only — compose unchanged, §5); `DEPLOYMENT_TIER` default. If `/hooks/v1/...` paths are adopted: reconfigure the GitHub App webhook delivery + Setup/Callback URLs and the smee relay target (one-time).

## 7. File structure (surfaces visible, auth in one place)

Two goals: the four surfaces are obvious at a glance, and every auth concern has exactly one home (today auth is spread across `middleware/jwt`, `middleware/jwtassertion`, `middleware/task_bearer`, `platform/auth`, `humakit`, and feature controllers).

```
asdlc-service/
├── api/                            # HTTP composition — the four surfaces, one file each
│   ├── app.go                      #   NewHandler: build deps → mountSurfaces. No handlers, no auth logic.
│   ├── surfaces.go                 #   ⭐ the surface↔guard map — the whole HTTP boundary on one screen
│   ├── public.go                   #   /api       newPublicAPI(Huma) + RegisterAllHuma
│   ├── internal.go                 #   /internal  newInternalAPI(Huma) + RegisterAllInternal
│   ├── external.go                 #   /hooks     RegisterAllExternal (webhook + connect-callback)
│   ├── dev.go                      #   /_dev      RegisterAllDev (gated)
│   └── discovery.go                #   /healthz, /auth/external/jwks.json, /openapi.yaml, /docs
│
├── internal/auth/                  # ⭐ ALL auth — one tree, three verbs
│   ├── verify/                     #   "who are you" — one file per credential
│   │   ├── userjwt.go              #     Thunder user JWT     ← middleware/jwt + jwtassertion
│   │   ├── taskjwt.go              #     BFF per-task JWT      ← platform/auth TaskTokenManager.Verify
│   │   ├── publishercc.go          #     Thunder publisher cc  ← PublisherTokenVerifier
│   │   ├── hmac.go                 #     GitHub webhook HMAC   ← webhook verifier
│   │   └── connectstate.go         #     connect-state JWT     ← orgcreds BearerService.Verify
│   ├── issue/                      #   "BFF as issuer" — token minting
│   │   ├── taskjwt.go              #     per-task JWT (dispatch)
│   │   └── servicejwt.go           #     outbound org-JWT (BFF→agents) + connect-state
│   ├── scope/                      #   "what may you touch" — Huma input resolvers (by-construction gates)
│   │   ├── org.go                  #     OrgScopedInput    (/api)      ← humakit
│   │   ├── runner.go               #     RunnerScopedInput (/internal)
│   │   └── hook.go                 #     HookScopedInput   (/hooks)
│   ├── guard.go                    #   per-surface guards: Public(), Service(), none
│   └── jwks.go                     #   JWKS cache + BFF published keyset ← jwtassertion/jwks_cache
│
├── internal/tenant/                # Caller (verified identity in ctx) + gate mode — unchanged; auth/ depends on it
├── internal/platform/humakit/      # Huma plumbing ONLY now: security-scheme defs, APIV1, error mapper
├── internal/feature/<f>/           # unchanged: <f>_huma.go registers on the right surface
└── middleware/                     # generic HTTP only: correlation-id, logger, recoverer, token-extract
```

`api/surfaces.go` is the single screen that answers "what's exposed and who guards it":

```go
func mountSurfaces(mux *http.ServeMux, d Deps) {
    //  path          guard (who may call)                handler
    mountPublic  (mux, auth.Public(d.JWKS, d.OrgSvc),    newPublicAPI(d))    // Thunder user JWT + org gate
    mountInternal(mux, auth.Service(d.TaskJWT, d.PubCC), newInternalAPI(d))  // task-JWT / publisher-cc
    mountExternal(mux,                                   newExternalAPI(d))  // per-route HMAC / state-JWT
    mountDev     (mux, d.Config)                                            // gated, no auth
    mountDiscovery(mux, d)                                                   // public, no auth
}
```

**"Where do I change X?" — the payoff:**

| Want to… | One place |
|---|---|
| add/modify a credential type | `internal/auth/verify/` |
| change who may call a whole surface | `internal/auth/guard.go` + `api/surfaces.go` |
| change org/task binding (what a verified caller may touch) | `internal/auth/scope/` |
| change token minting / claims / expiry | `internal/auth/issue/` |
| add a route | `internal/feature/<f>/<f>_huma.go` |
| see the whole surface↔auth map | `api/surfaces.go` |

**agents-service** mirrors it small: `agents/src/auth/{verify.ts (BFF-JWT via JWKS), scope.ts (org from claim)}`, replacing the scattered `middleware/jwt.ts` + `middleware/org-id.ts`.

**Migration:** mostly **relocation, not rewrite** — verifiers/minters keep their logic, they just move into `internal/auth/`. Land it as **P0** (pure move, compiles green, behavior identical) *before* P1, so the new internal/external surfaces are built in the clean layout from the start. `tenant.Caller` stays put to avoid wide import churn.

### 7.1 OpenAPI generation — one spec per surface

Each documented surface is an independent `huma.API` over its own mux, so its spec is just `.OpenAPI().YAML()` on that API. The existing pattern (`GenerateOpenAPIYAML`: throwaway mux + `RegisterAllHuma` with **nil deps** — registration is pure — → YAML) is instantiated once per surface.

| Surface | Generator | Checked-in file | Served | Schemes |
|---|---|---|---|---|
| `/api` (public) | `GenerateOpenAPIYAML()` | `api/openapi.yaml` (now **public-only**) | public host `/openapi.yaml` + `/docs` | `userJWT` |
| `/internal` (S2S) | `GenerateInternalOpenAPIYAML()` | `api/internal-openapi.yaml` | internal host or file-only (Q2) | `taskJWT`, `publisherCC` |
| `/hooks` (external) | `GenerateExternalOpenAPIYAML()` | `api/hooks-openapi.yaml` | public or file-only | `webhookHmac`, `connectState` |
| `/_dev` | — (no spec) | — | — | — |
| agents-service | hand-written fragment (or none) | — | — | (BFF-JWT) |

What this buys:
- **Each spec tells the truth about its auth.** Today `newHumaAPI` declares `userJWT`+`taskJWT`+`connectState`+`webhookHmac` in one map (`huma.go:45-50`) on a spec that really only hosts `userJWT` routes (`docs/api-routes-review.md` §3.4). After the split each API declares only its own schemes — those four pre-declared schemes sort to their real homes.
- **Internal/hooks/dev leave the public spec** (Q4 ask) — `api/openapi.yaml` becomes public routes only.
- **No identity params leak** — the `*ScopedInput` fields are `json:"-"` (server-set), so specs carry the security *requirement* but no `{orgHandle}`/task param.

`make openapi` regenerates all checked-in specs; the drift guard (`huma_guard_test.go`) loops over `{public, internal, hooks}` — each generated YAML must equal its checked-in file, so every surface's contract is reviewed in PRs and can't silently drift. The internal spec is **never gateway-advertised**. agents-service is Express (not Huma), so it stays outside this generator — a small hand-written OpenAPI fragment is the option there.

## 8. Security model & known limitations

| Trust boundary | Mechanism after this change |
|---|---|
| runner → BFF | Task-JWT (BFF-signed, task-bound by `RunnerScopedInput`) **or** publisher-cc (org-bound) — one verifier, fail-closed |
| BFF → agents | BFF-signed JWT, org **in the verified claim** (not a trusted header); `dsl/render` pulled under the gate |
| external-inbound (GitHub / browser) → BFF | per-route scheme (GitHub HMAC / signed connect-state); org from the **verified** payload/credential, bound by `HookScopedInput` |
| internal surface exposure | off the public browser host; auth still enforced if a route leaks |
| internal contract | its own OpenAPI, never gateway-advertised |
| dev/test surface | no request auth *by design*; safe via registration gate (dev tier only) + on no HTTPRoute (loopback only) |

**Retained wart (D1):** a publisher-cc token stays **org-scoped, not task-scoped** — within an org it can act on any task. Closing it requires dropping publisher-cc (a runner-image migration) or adding a task claim to the cc token. Tracked, not fixed here.

**Boundary caveat (D3):** gateway-routing is not a hard in-process boundary; a misconfigured HTTPRoute could re-expose `/internal`. The auth seam is the actual security boundary; the routing split is defense-in-depth. (A second listener port would make it structural — deferred.)

## 9. Phasing

- **P0 (auth consolidation, pure move):** relocate verifiers/minters/resolvers into `internal/auth/` (§7), split `humakit` (auth bits → `auth/scope`, plumbing stays), add `api/surfaces.go`. No behavior change — compiles green, all suites pass. De-risks everything after it by giving P1–P4 the clean layout to build into.
- **P1 (BFF, behavior-preserving):** `s2sAuth` + `RunnerScopedInput` + `internalMux`/`newInternalAPI`/`RegisterAllInternal`; convert the 3 runner routes; delete the raw handlers + `RequireTaskBearer`. Same paths/tokens → runner images unchanged. Verified by `test/delivery` + new resolver unit tests.
- **P2 (BFF cleanup + dev + external surfaces):** extract `/_dev/` (`RegisterAllDev`; move the `_test` handler bodies out of `app.go`; repoint `deployments/scripts/repair-secrets.sh`); extract `/hooks/` (`RegisterAllExternal` + `hookkit`; collapse the webhook dual-mount; move webhook + connect-callback out of `/api/v1`; reconfigure GitHub-side URLs if path-moving); pull agents `dsl/render` under the gate; retire the duplicate refresh route; wire-or-delete `verification-failed`.
- **P3 (contract + deployment):** internal OpenAPI + drift guard; HTTPRoute split; `AGENT_PLATFORM_URL` + `DEPLOYMENT_TIER`.
- **P4 (outbound, cross-service):** BFF service-token minter + agents-client wiring; agents-service verifies the org-JWT + reads org from claim; drop `X-Oc-Org-Id`. Staged: cross-check before removal so BFF and agents can roll independently.

## 10. Test plan

- Unit: `RunnerScopedInput.Resolve` (task match / mismatch → 403; publisher-cc org bind); `s2sAuth` (Task-JWT, publisher-cc, bad/absent bearer → 401).
- Integration (`test/delivery`): the runner lifecycle still reaches `deployed` over the converted routes (proves wire-contract preservation).
- agents-service (P4): JWT verify against BFF JWKS; org-from-claim; `X-Oc-Org-Id` mismatch → 403.
- Drift guard: internal spec regenerates clean; public `/openapi.yaml` no longer contains internal ops.

## 11. Open questions

1. Confirm which runner images/flows actually present publisher-cc (governs whether D1's wart can later be retired). *(The longer-term "refreshable runner identity" root cause is parked.)*
2. Internal spec: emit to a file only, or also serve on the internal host at `/internal/openapi.yaml`?
3. P4 sequencing across BFF and agents-service deploys (the cross-check window must straddle both).
4. `/hooks` paths: adopt `/hooks/v1/...` (clean namespace, one-time GitHub App + smee reconfig) or keep today's paths and only code-separate the package (no external reconfig)?
5. `/_dev` in compose: rely on the registration gate alone (shared port), or add the optional `127.0.0.1`-only listener (§5)?
