# BFF API-Surface Separation

**Status:** Proposed · **Scope:** `asdlc-service` (BFF) HTTP edge · **Author:** design synthesis (multi-agent review)

> Make auth a property of the **surface**, not of where a route happens to be
> registered. Today the BFF's auth posture is decided by a 137-line
> `NewHandler` plus Go-1.22 mux precedence as silent glue; the one real risk is
> a new `/internal/v1/tasks` route forgetting its per-task auth call. This doc
> separates the edge into named surfaces whose structure *is* the auth model,
> fixes the latent bugs the review found, and stays lazy: **no new packages, no
> `Surface` struct + mount kernel, one new type (`runnerGuard`).** Whether each
> surface gets its own OpenAPI document is downstream (§8).

---

## 1. Problem

`NewHandler` registers every surface inline on one `*http.ServeMux`. The auth
regime of a route is implicit in *which block it landed in*:

- **Edge** rides a single `jwt(ensureOrg(apiMux))` wrap.
- **Runner callbacks** hand-call `authorizeRunnerCallback` *inside* each handler.
- **Webhooks / connect** verify in-handler.
- **Carve-outs** (connect-callback, legacy webhook) bypass the edge chain only
  because Go-1.22 mux *specificity* lets an exact path beat the `/api/` prefix —
  load-bearing behaviour explained by a comment, enforced by nothing.

Consequences: a new `/internal/v1/tasks/*` route can silently ship with no
per-task binding; the published OpenAPI mixes the client contract with a public
JWKS op; the error contract is split (edge speaks RFC 9457 `problem+json`, raw
surfaces speak ad-hoc `{"error":...}`); and the "version in the path" (`/api/v1`)
noise that started this investigation is a symptom of surfaces never being named.

## 2. Surface taxonomy

A **surface** is distinguished on four axes. Two routes belong to different
surfaces iff they differ on at least one axis; the auth chain is a function of
`(audience, mechanism)`.

| Axis | Values |
|---|---|
| **Audience** (who holds the credential) | browser end-user · runner pod / agents-service · GitHub (no bearer) · GitHub OAuth redirect (no session) · verifiers/LB/tooling (no identity) |
| **Mechanism** | Thunder user-JWT (RS256, JWKS) · BFF Task-JWT (RS256 vs BFF's own key) **or** Thunder publisher-cc · HMAC-SHA256 over raw body · connect-state JWT (HS256, BFF key) · none |
| **Lifecycle** (replay window) | long-lived session · per-task (minted at dispatch) · per-delivery · per-redirect (15-min TTL) · always-on public |
| **Path / version slot** | `/api/v1/*` · `/internal/v1/*` · `/webhooks/*` · `/api/v1/github/connect/callback` · `/health`, `/auth/external/jwks.json`, `/docs`, `/openapi.*` |

### The six surfaces

| # | Surface | Audience | Mechanism | Base path |
|---|---|---|---|---|
| 1 | **EDGE** | end-user | user-JWT + JIT org + per-op tenant gate | `/api/v1` |
| 2 | **RUNNER** | runner pod | Task-JWT **or** publisher-cc, **+ per-task `sub==path{taskId}` binding** | `/internal/v1/tasks/{taskId}/*` |
| 3 | **INTERNAL-CREDS** | runner pod | Task-JWT only (`aud==git-service`) | `/internal/v1/credentials/refresh` |
| 4 | **WEBHOOK** | GitHub | HMAC-SHA256 (per-org secret) | `/webhooks/github` (+ `/api/v1/...` alias) |
| 5 | **CONNECT** | OAuth redirect | connect-state JWT (HS256, `kind==connect-state`) | `/api/v1/github/connect/callback` |
| 6 | **PUBLIC** | verifiers / LB / tooling | none | `/health`, `/auth/external/jwks.json`, `/docs`, `/openapi.*` |

**Dev routes are not a seventh surface.** `_test/reset` belongs to EDGE (it
*needs* the user-JWT chain) gated by a flag; `_test/sm-api-resync` is a
flag-gated raw helper with no auth by design (the repair script runs without an
admin token). Modelling dev as its own plane forces a contradiction — reset
needs *both* user-JWT *and* dev-gating, which a one-plane-one-mux abstraction
cannot express. Keeping reset on EDGE resolves it.

## 3. Auth model per surface

Global substrate (all requests, outermost-last):
`RecovererOnPanic → AddCorrelationID → RequestLogger → ExtractAuthToken`.
`ExtractAuthToken` only stashes the raw bearer; **it never verifies**, so no 401
originates there.

| Surface | Ordered chain | Fail-closed property |
|---|---|---|
| **EDGE** | `jwt` (Thunder RS256/JWKS, iss+aud, **401 on missing/invalid**) → `orgensure` (JIT org from claims) → Huma op → per-op `OrgScopedInput.Resolve` (active org = verified token only) | `apiMux` is reachable **only** through the single `root.Handle("/api/", jwt(ensureOrg(apiMux)))` statement — no second door. Forgetting `OrgScopedInput` yields empty `OrgHandle` ⇒ empty result set; `TestNoClientSuppliedOrg` bans any request-bound org field. **No `{orgHandle}` param exists anywhere ⇒ cross-org is unrepresentable (IDOR closed by construction).** |
| **RUNNER** | `runnerGuard.authorize`: Task-JWT (`TaskTokenManager.Verify`, RS256 vs **BFF's own key**, then `claims.TaskID == path{taskId}` else 403) **OR** publisher-cc (`PublisherTokenVerifier.Verify`, then `GetTask(taskId)` and `task.OrgID == claims.OrgHandle` else 403) → handler `func(w, r, authedTask)` | The handler signature carries only **post-authorization** values, and `guard.handle` is the only function that produces such a handler. You **cannot register a `/tasks/{taskId}` route without** dual-auth + per-task binding. |
| **INTERNAL-CREDS** | `RequireTaskBearer(TaskJWT)` wrapping the whole sub-mux (RS256 vs BFF JWKS, **`aud==git-service`**, binds `tenant.Caller`) → handler | Whole-mux wrap + route mounted **only when `TaskJWT != nil`** (absent verifier ⇒ route absent, not open). |
| **WEBHOOK** | handler reads `X-Hub-Signature-256` → resolve `ocOrgID` → `VerifyWithKey` HMAC vs per-org secret → 401/200/503 | HMAC is body-coupled ⇒ **must** stay in-handler. `mountWebhooks` is the only registrar; no token verifier is in scope to confuse. |
| **CONNECT** | handler extracts `?state` → `VerifyConnectState` (HS256 vs `OAUTH_STATE_SIGNING_KEY`, `kind==connect-state`, `exp>now`) | `kind` is the cross-JWT defence. HS256 is correct (issuer == verifier == BFF). |
| **PUBLIC** | none | JWKS is a plain handler fed by `HumaDeps.TaskTokens`; empty key set when nil (downstream rejects). |

### 3.1 Token-confusion defence (corrected)

Three layers — **but the cryptographic layer does not cover every pair**, and the
analysis must say so:

1. **Per-surface verifier ownership.** Each `mountX` constructs/closes over only
   its own verifier; no surface references another's, so the wrong verifier is
   structurally unreachable for a route.
2. **Cryptographic separation — partial.** EDGE user-JWT and RUNNER/CREDS
   Task-JWT are signed by *different keys* (Thunder vs the BFF's own key), so a
   Thunder user-JWT fails the BFF signature check and a BFF Task-JWT fails
   Thunder's iss/aud. **However, the RUNNER publisher-cc branch verifies against
   Thunder's JWKS — the same key set as EDGE.** So **EDGE ↔ publisher-cc are NOT
   cryptographically separated**; they are separated only by `iss` + `aud`
   (`PublisherTokenVerifier` requires `aud == asdlc-publisher-{org}`) plus the
   `GetTask` org-binding. Because the edge audience matcher compiles wildcards
   (`compileAudiences`), a broad `JWTAllowedAudience` entry (e.g. `asdlc*`) could
   admit a publisher-cc token to `/api/`. This is a **config-correctness boundary**,
   not a cryptographic one.
3. **Behavioural arch-lock** (`TestCrossSurfaceReplay`) pins it — including the
   same-issuer pairs that layer 2 does *not* protect (see §7).

**Explicit non-goal:** enforcing `aud==git-service` inside `TaskTokenManager.Verify`.
The mint-site comment proves the same Task-JWT is presented to *both* git-service
(`aud=git-service`) and the BFF self-callback, so that "fix" is a 401 regression —
a trap two of the four reviewed designs fell into. Confusion is closed by layers
1+3 and (for the BFF-key pair) layer 2; not by `aud` in `Verify`.

## 4. Code structure

Stay in `package api`. The only surface with a real *omission* risk is RUNNER;
the other five gain nothing from package encapsulation that the arch-lock test
doesn't already give. Split `NewHandler`'s inline blocks into per-surface files;
add one file for the guard and one for the RFC 9457 writer.

```
asdlc-service/api/
  app.go             → NewHandler: the 6 mountX calls (the surface map) + global wrap + splitAndTrim. ~40 lines, no raw route registration inline.
  surface_edge.go    → mountEdge: apiMux + newHumaAPI + RegisterAllHuma + registerHumaDocs(root,api) + flag-gated _test/reset + root.Handle("/api/", jwt(ensureOrg(apiMux))). testResetHandler lives here.
  surface_runner.go  → runnerGuard{tokens,pub,svc}, authedTask, taskHandler, guard.handle (SOLE registrar, registers the {taskId} wildcard), guard.authorize (authorizeRunnerCallback moved VERBATIM), bearerToken, mountRunner.
  surface_internal.go→ mountInternalCreds: RequireTaskBearer-wrapped /internal/v1/credentials/ sub-mux (fail-closed mount) + flag-gated _test/sm-api-resync.
  surface_webhook.go → mountWebhooks (folds registerWebhookRoutes; both paths).
  surface_connect.go → mountConnect (folds registerConnectCallbackRoute).
  surface_public.go  → mountPublic: GET /health + GET /auth/external/jwks.json (raw, fed by HumaDeps.TaskTokens — deletes the apiMux cross-routing hack).
  problem.go         → writeProblem(w, status, detail): one RFC 9457 application/problem+json writer. Runner guard uses it now; other raw handlers adopt it incrementally.
  huma.go, huma_infra.go, huma_register.go → unchanged, except registerInfraHuma's JWKS op is retired in favour of the raw public handler.
```

`internal/feature/*/*_huma.go` are **untouched** (edge ops self-register via
`RegisterAllHuma`). `TaskController` **shrinks**: it loses `taskTokens`,
`publisherVerifier`, `SetPublisherVerifier`, and `authorizeRunnerCallback` (all
consolidated into `runnerGuard`); its three methods become `func(w,r,authedTask)`
doing only business logic. **Auth leaves the controller entirely — a net deletion.**

## 5. Composition root

```go
// api/app.go — NewHandler reads as the surface map: 6 surfaces, each mountX
// owning its base path and auth regime. No raw route registration here.
func NewHandler(p AppParams) http.Handler {
	root := http.NewServeMux()

	mountPublic(root, p)        // none:        /health, /auth/external/jwks.json, /docs, /openapi.*
	mountEdge(root, p)          // user-JWT:    /api/  (+ _test/reset)
	mountRunner(root, p)        // Task-JWT|cc: /internal/v1/tasks/{taskId}/* (per-task bound)
	mountInternalCreds(root, p) // Task-JWT:    /internal/v1/credentials/  (+ _test/sm-api-resync)
	mountWebhooks(root, p)      // HMAC:        /webhooks/github (+ /api/v1 alias)
	mountConnect(root, p)       // state-JWT:   /api/v1/github/connect/callback

	var h http.Handler = root
	h = middleware.ExtractAuthToken()(h)
	h = logger.RequestLogger()(h)
	h = middleware.AddCorrelationID()(h)
	h = middleware.RecovererOnPanic()(h)
	return h
}
```

```go
// api/surface_edge.go — apiMux is reachable ONLY via the wrapped handle.
func mountEdge(root *http.ServeMux, p AppParams) {
	humakit.SetGateMode(tenant.ParseGateMode(p.Config.TenantGateMode))
	apiMux := http.NewServeMux()
	api := newHumaAPI(apiMux)
	RegisterAllHuma(api, p.HumaDeps)
	registerHumaDocs(root, api) // published edge spec, served on the outer mux
	if p.Config.TestMode && p.Config.DeploymentTier == "dev" {
		apiMux.HandleFunc("POST /api/v1/_test/reset", testResetHandler(p)) // rides the edge chain
	}
	jwt := jwtmw.Middleware(jwtmw.Config{
		JWKS:                p.ThunderJWKS,
		AllowedIssuers:      splitAndTrim(p.Config.JWTAllowedIssuer),
		AllowedAudiences:    splitAndTrim(p.Config.JWTAllowedAudience),
		ResourceMetadataURL: p.Config.JWTResourceMetadataURL,
	})
	root.Handle("/api/", jwt(orgensure.Middleware(p.OrganizationService)(apiMux)))
}
```

```go
// api/surface_runner.go — the one load-bearing new type. authedTask carries
// only POST-authorization values, so a handler cannot be written/registered
// before auth runs.
const runnerBase = "/internal/v1/tasks/{taskId}"

type authedTask struct {
	OrgHandle string
	TaskID    string
}
type taskHandler func(http.ResponseWriter, *http.Request, authedTask)

type runnerGuard struct {
	tokens *auth.TaskTokenManager       // BFF-self issuer, verified vs BFF key
	pub    *auth.PublisherTokenVerifier // Thunder cc, optional
	svc    task.TaskService             // publisher org-binding (GetTask)
}

// handle is the SOLE registrar. It registers the {taskId} WILDCARD pattern, so
// r.PathValue("taskId") resolves inside the closure (post-routing) — that is
// why per-task auth is a registration-site decorator, NOT a prefix middleware.
// A prefix mount on /internal/v1/tasks/ would see an empty PathValue and either
// 403 every call or fail open.
func (g *runnerGuard) handle(root *http.ServeMux, method, suffix string, h taskHandler) {
	root.HandleFunc(method+" "+runnerBase+suffix, func(w http.ResponseWriter, r *http.Request) {
		a, ok := g.authorize(w, r, r.PathValue("taskId")) // writes problem+json on failure
		if !ok {
			return
		}
		h(w, r, a)
	})
}

// authorize is today's authorizeRunnerCallback, relocated verbatim: Task-JWT
// (sub==taskId) then publisher-cc (GetTask + task.OrgID==claims.OrgHandle).
func (g *runnerGuard) authorize(w http.ResponseWriter, r *http.Request, taskID string) (authedTask, bool) {
	tok, ok := bearerToken(r)
	if !ok {
		writeProblem(w, http.StatusUnauthorized, "bearer token required")
		return authedTask{}, false
	}
	if g.tokens != nil {
		if c, err := g.tokens.Verify(tok); err == nil { // RS256 vs BFF key — a Thunder user-JWT fails here
			if c.TaskID != taskID {
				writeProblem(w, http.StatusForbidden, "task bearer does not match path")
				return authedTask{}, false
			}
			return authedTask{c.OcOrgID, taskID}, true
		}
	}
	if g.pub != nil {
		if c, err := g.pub.Verify(tok); err == nil { // Thunder JWKS — same key set as edge; iss+aud separate it
			t, err := g.svc.GetTask(r.Context(), taskID)
			if err != nil || t == nil {
				writeProblem(w, http.StatusForbidden, "task not found")
				return authedTask{}, false
			}
			if t.OrgID != c.OrgHandle {
				writeProblem(w, http.StatusForbidden, "publisher token does not match task org")
				return authedTask{}, false
			}
			return authedTask{c.OrgHandle, taskID}, true
		}
	}
	writeProblem(w, http.StatusUnauthorized, "invalid bearer")
	return authedTask{}, false
}

func mountRunner(root *http.ServeMux, p AppParams) {
	if p.TaskController == nil {
		return // fail-closed: no controller, no surface
	}
	if p.TaskJWTManager == nil {
		slog.Warn("runner surface mounting without a Task-JWT verifier — routes will 401") // observable, not silent
	}
	g := &runnerGuard{tokens: p.TaskJWTManager, pub: p.PublisherVerifier, svc: p.TaskSvc}
	g.handle(root, "POST", "/verification-failed", p.TaskController.VerificationFailed)
	g.handle(root, "GET", "/skills", p.TaskController.Skills)
	g.handle(root, "POST", "/credentials/refresh", p.TaskController.RefreshCredentials)
}

// api/surface_internal.go — fail-closed mount: route absent when verifier nil.
func mountInternalCreds(root *http.ServeMux, p AppParams) {
	if p.TaskJWT != nil && p.CredCtrl != nil {
		sub := http.NewServeMux()
		sub.HandleFunc("POST /internal/v1/credentials/refresh", p.CredCtrl.Refresh)
		root.Handle("/internal/v1/credentials/", middleware.RequireTaskBearer(p.TaskJWT)(sub))
	}
	if p.Config.TestMode && p.Config.LocalOpenBaoRepairEnabled {
		root.HandleFunc("POST /internal/v1/_test/sm-api-resync", testSMAPIResyncHandler(p))
	}
}
```

`mountWebhooks` / `mountConnect` / `mountPublic` are verbatim relocations of
today's blocks (webhook registers both paths; public registers `/health` + the
raw JWKS handler with no `apiMux` cross-routing).

## 6. Route-placement workflow (the maintainability payoff)

| Adding a… | You write… | What guarantees the auth |
|---|---|---|
| **edge** route | a Huma op in `internal/feature/*/*_huma.go` + register in `RegisterAllHuma`; embed `OrgScopedInput` if org-scoped | self-registers on `apiMux` ⇒ inherits the single-door chain; `TestNoClientSuppliedOrg` bans any org param |
| **runner** route | `g.handle(root, METHOD, "/suffix", handlerFunc)` in `mountRunner`; handler is `func(w,r,authedTask)` | the signature is unconstructable without auth; `gate_invariant_test` forbids raw `/internal/v1/tasks` registration outside `guard.handle` |
| **internal-creds** route | a `HandleFunc` on the `RequireTaskBearer`-wrapped sub-mux | whole-mux wrap; fail-closed mount |
| **public** route | a `HandleFunc` in `mountPublic` | greppable, explicitly no verifier in scope |

A reader opens `app.go`, sees six `mountX` lines = the surface map, and each
surface file tells the truth about its audience and auth in one place.

## 7. Security analysis & arch-lock tests

Every scenario walked, with the test that locks it:

- **A–D (edge)** — single-door user-JWT + `orgensure` + per-op tenant gate; IDOR
  closed by construction (no `{orgHandle}` param). Locked by `TestNoClientSuppliedOrg`
  + fail-closed empty-org semantics.
- **E (Task-JWT)** — RS256 vs BFF key; creds route pins `aud==git-service`; both
  fail-closed.
- **F (publisher-cc)** — guard holds `TaskService` ⇒ `GetTask` + `task.OrgID`
  binding (the #1 reviewed kill shot — a unified `sub==path` check would have
  broken this; avoided).
- **G (per-task binding)** — `guard.handle` registers the `{taskId}` wildcard so
  `PathValue` resolves post-routing (the #2 reviewed kill shot — a prefix mount
  would read an empty `taskId`; avoided). Task-A bearer cannot act on Task-B.
- **H (webhook HMAC)** — body-coupled, in-handler, no verifier in scope.
- **I (connect-state)** — HS256 + `kind` + `exp`.
- **J (JWKS)** — plain public handler; the `apiMux` cross-routing hack deleted.
- **K (token confusion)** — see §3.1. BFF-key pair separated cryptographically;
  **EDGE ↔ publisher-cc separated by `iss`+`aud` only** — explicitly tested.
- **L (dev routes)** — registration-time flag gates; off-dev the routes do not
  exist (404, not 403).
- **M (health)** — unauthenticated.
- **N (carve-out precedence)** — `net/http` 1.22 routes by **pattern + method
  specificity**, not registration order; the exact `…/connect/callback` and
  `…/webhooks/github` beat the `/api/` prefix regardless of `mountX` order. The
  false "register before the wrapper" comments are deleted for a one-line
  specificity note.

**Arch-lock tests (the teeth):**

1. `gate_invariant_test.go` — extend the raw-registration scan to cover `app.go`
   + `surface_*.go`; forbid raw `mux.Handle`/`HandleFunc` of `/internal/v1/tasks`
   **except inside `surface_runner.go`'s `guard.handle`**; keep the two `/api/v1`
   carve-out paths allowlisted.
2. `huma_guard_test.go` — `TestNoClientSuppliedOrg` + `TestOpenAPISpecFresh`, unchanged.
3. `surface_guard_test.go` (**new**):
   - `TestCarveoutBypassesEdgeAuth` — build `NewHandler` with **nil ThunderJWKS**
     (so any `/api/` route would 401), then **(a)** `GET …/connect/callback` with
     no `?state` asserts **400** (the connect handler's "invalid state"), *not* 401
     — proving the jwt chain was bypassed; **(b)** `POST …/webhooks/github` with no
     signature asserts the response carries **no `WWW-Authenticate: Bearer`** header
     — the discriminator, since both the webhook handler and the jwt path can 401
     but only the jwt path emits the challenge.
   - `TestCrossSurfaceReplay` — the full matrix, **including the same-issuer pairs
     layer-2 crypto does not cover**:
     - Task-JWT → `/api/` ⇒ 401 (BFF key fails Thunder).
     - user-JWT → runner ⇒ 401 (fails BFF key *and* publisher aud).
     - **publisher-cc → `/api/` ⇒ 401** (proves the edge `aud` allowlist excludes the publisher pattern).
     - **publisher-cc → `/internal/v1/credentials/refresh` ⇒ 401** (`RequireTaskBearer` pins `aud==git-service`; documents the intended asymmetry vs the scoped runner route).
   - **Config assertion:** `JWTAllowedAudience` entries must not match
     `asdlc-publisher-` (guards the wildcard-audience hole in §3.1).

**Fail-closed inventory:** nil `ThunderJWKS` ⇒ all `/api/` 401 · nil `TaskJWT`
verifier ⇒ creds route unmounted · nil `TaskController` ⇒ runner surface
unmounted (+ warn log if `TaskJWTManager` nil) · nil `TaskTokens` ⇒ empty JWKS ·
missing `OAUTH_STATE_SIGNING_KEY` ⇒ connect 400 · forgotten `OrgScopedInput` ⇒
empty result · new runner handler ⇒ unconstructable without the guard. Every
failure direction denies.

## 8. OpenAPI strategy (secondary)

Surface separation is independent of doc count. Recommended, in order of laziness:

1. **Now (free):** the published `/openapi.yaml` is the **EDGE** spec only. JWKS
   leaves it (it becomes a plain public handler), so the edge doc stops mixing a
   public infra op into the client contract. Trim `newHumaAPI`'s security schemes
   to `userJWT` only — `taskJWT`/`connectState`/`webhookHmac` are declared today
   but their surfaces are raw and not in the published spec (a confusion smell).
2. **Optional later:** give EDGE a `servers: [{url: /api/v1}]` base + relative op
   paths via one `http.StripPrefix("/api/v1", …)` at the edge mount (the original
   `/api/v1`-noise fix). Console is unaffected — runtime URLs are hand-written
   `${base}/api/v1/...`; `StripPrefix` preserves the wire path.
3. **Only if a consumer appears:** a second `huma.API` documenting the
   **INTERNAL** surface (`/internal/v1`). No tool codegens it today, and
   Huma-ifying the raw S2S handlers means porting the dual-auth into a resolver —
   documentation-first work, deferred.

## 9. Migration plan

Ordered, smallest blast-radius first. `[AUTH]` = touches the auth path. Each step
keeps the `test/` authoring integration suite green.

1. **[no auth] Pure code motion.** Extract `NewHandler`'s blocks into
   `mount*` functions across `surface_*.go` (fold `registerWebhookRoutes` /
   `registerConnectCallbackRoute`). `NewHandler` becomes the `mountX` list + global
   wrap. Routing byte-identical. **Also:** fix the stale `app.go` IDOR comment (the
   gate is token-only; there is no `{orgHandle}` path-var match) and **delete the
   dead `tenant.Scope`** (no live callers — confirmed) so future readers don't
   mistake it for the live fence.
2. **[no auth] Delete the JWKS cross-routing hack.** `/auth/external/jwks.json`
   becomes a raw handler in `mountPublic` fed by `HumaDeps.TaskTokens`; move
   `registerHumaDocs` into `mountEdge`; retire `registerInfraHuma`'s JWKS op.
   Golden: same JWK set before/after.
3. **[AUTH] The core change, landed alone.** Add `surface_runner.go`
   (`runnerGuard`, `authedTask`, `guard.handle` registering the `{taskId}`
   wildcard, `guard.authorize` moved **verbatim**). Add `TaskJWTManager` +
   `PublisherVerifier` + `TaskSvc` to `AppParams` (main.go already constructs them
   — pass all three from one source, not split controller/params). Change the three
   controller methods to `func(w,r,authedTask)`. **Delete** `authorizeRunnerCallback`,
   `taskTokens`, `publisherVerifier`, `SetPublisherVerifier` from the controller.
   Land behind tests written **first**: no-bearer→401, sub-mismatch→403,
   publisher-org-mismatch→403, valid+matching-path→2xx (catches an all-403
   PathValue regression), and the §7 cross-surface pairs. The only step that moves
   verification call-sites; independently revertible.
4. **[no auth] RFC 9457.** Add `problem.go::writeProblem`; wire the runner guard's
   failures through it. Leave other `utils.WriteErrorResponse` callers for now.
5. **[AUTH GUARD] Lock the invariants.** Extend `gate_invariant_test.go`; add
   `surface_guard_test.go` (`TestCarveoutBypassesEdgeAuth` sound version +
   `TestCrossSurfaceReplay` incl. same-issuer pairs + the `aud`-config assertion).
   Replace the precedence comments with the specificity note.
6. **[secondary] OpenAPI.** Trim edge security schemes to `userJWT`; regenerate;
   `TestOpenAPISpecFresh` enforces the diff. (Optional §8.2 base-path hoist here.)

**Rollback:** steps 1–2, 4–6 are reversible code motion. Step 3 is the only
behavioural risk, gated behind its new tests.

> **Platform note:** steps 3 and 5 touch the auth path (CLAUDE.md → platform
> review). Land them with the §7 tests as the gate.

## 10. Alternatives considered

- **A · Package-per-surface** (7 `api/surface/<name>/` packages). Rejected:
  compiler encapsulation is load-bearing only for RUNNER; the other five are
  reorg ceremony. Its sketch also dropped the `TaskService` (breaking
  publisher-cc binding) and tested `GET` against a `POST` route. **Grafted:**
  `app.go`-as-surface-map (via plain `mountX`) + the edge single-door.
- **B · Declarative surface table** (`Surface` struct + mount kernel that panics
  on nil chain). Rejected: the kernel is decorative — `net/http` already routes by
  specificity, and the panic-guard is satisfied by passthrough markers for the
  in-handler surfaces, making "fail-closed by construction" theatre exactly where
  it matters. The real fence is the arch-lock test, which needs no struct.
  **Grafted:** explicit greppable "no ambient auth" (`mountPublic`) + the
  precedence-allowlist invariant.
- **C · Ponytail-minimal** (chain mounted on the `/internal/v1/tasks/` prefix).
  Rejected on its own kill shot: a prefix-mounted chain runs *before* the inner
  mux binds `{taskId}`, so `PathValue` is empty at auth time. **Kept:** stay in
  one package, one new file, reuse everything — but fix the runner mechanism by
  registering the wildcard in the guard.
- **D · Auth-plane-standards-first** (verifier-bound `guard.handle`). The **base**
  for the runner mechanism. **Trimmed** three things its reviewers flagged: the
  7-package over-split, the `aud`-in-`Verify` "fix" (a regression), and the
  dev/edge double-ownership contradiction.

Net: **D's guard + A/B/C's readability and laziness, with all four designs' kill
shots resolved.**

## 11. Open questions / tracked hardening

1. **Webhook pre-auth abuse (promote to tracked).** The webhook handler reads the
   full body before HMAC verify with no `http.MaxBytesReader` and no
   `X-GitHub-Delivery` idempotency, despite GitHub redelivery. Add `MaxBytesReader`
   (~25 MB) at `mountWebhooks` (the natural new boundary) and a delivery-id dedup.
   Out of scope for *separation*, but `mountWebhooks` is where it lands.
2. **`humakit.gateMode` is a process-global** (`SetGateMode` mutates a package
   var). Two `NewHandler` instances with different gate modes in one test process
   clobber each other. Consider moving it into edge construction. Test-isolation
   only; production sets it once at boot.
3. **RFC 9457 convergence.** Migrate webhook/connect/creds/`_test` handlers off
   the ad-hoc `{error,message}` shape incrementally; current S2S clients tolerate it.
4. **`aud=git-service` defence-in-depth.** Layer-1/3 already close runner↔edge
   confusion. Optionally pin `aud` on a *separate* path (the creds surface already
   does) after auditing every Task-JWT mint site — but **never** in
   `TaskTokenManager.Verify` (breaks the self-callback).
5. **Connect-state single-use.** `VerifyConnectState` checks signature + `kind` +
   `exp` only ⇒ replayable within the 15-min TTL. Acceptable for an OAuth CSRF
   token if TTL-bounded replay is acceptable; add a `jti` consumed-once check
   otherwise, and stop calling it a "nonce" until it is one.

---

### Appendix — what this fixes vs today

- Auth is a property of the surface, visible in `app.go` and one file per surface.
- A runner route **cannot** ship without per-task dual-auth (signature + arch-lock).
- The `{taskId}` `PathValue` + publisher-cc `GetTask` binding are preserved (the
  two bugs that killed competing designs).
- Token confusion is closed — and the **one pair that isn't crypto-separated**
  (edge ↔ publisher-cc) is named and tested, not hand-waved.
- Dead seams (`tenant.Scope`, the `apiMux` JWKS cross-route, stale IDOR comment,
  unused edge security schemes) are retired.
- The `/api/v1` path noise becomes an optional one-line `StripPrefix` (§8.2),
  decoupled from the auth refactor.
