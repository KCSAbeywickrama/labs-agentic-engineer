# BFF Component Testing — In-Process, Faked Auth, Real Boundaries

**Status:** Design — implementation-ready (validated against the code + Huma v2.38.0; adversarially reviewed — see §14)
**Owner:** Platform / BFF
**Companion to:** `docs/design/backend-testing.md` (the **integration** tier — real stack, real token, over HTTP). This doc owns the **in-process** tiers below it: unit, **component (new)**, and store.
**Reference pattern:** `agent-manager` `tests/` (`apitestutils.MakeAppClientWithDeps` + `jwtassertion.NewMockMiddleware`) — in-process `http.Handler` driven by `httptest`, **real router + real middleware chain**, only out-of-process clients and the token verifier substituted.

---

## 1. Goal & scope

`backend-testing.md` proves the **whole backend works without a frontend** by driving the **real running stack over HTTP with a real token**. That tier is high-fidelity but *expensive*: it needs k3d + compose + Thunder + (for generative flows) Anthropic, it is manual/scheduled, and it cannot give per-feature, per-branch, sub-second feedback. It is the **top** of the pyramid; it must stay thin.

This doc designs the **missing middle**: a **component tier** that exercises the **BFF's real HTTP handler — Huma input parsing, validation, the tenant (IDOR) gate in ENFORCE, error mapping, and the handler→service path — entirely in-process**, with:

- **auth faked at the claims seam** (`jwt.WithClaims`), *not bypassed* — the real gate runs in enforce, so cross-org 404 and the gate's no-claims 401 are proven here, fast, with no Thunder and no JWKS;
- **out-of-process clients mocked** (OpenChoreo, agents-service, the GitHub API, SM-API, Thunder admin) — the only things faked, because they are the only things *outside the process*;
- **the feature's own service running for real** with its store either faked or a real Postgres (`dbtest`), depending on whether the behavior under test is SQL-shaped.

> **One sentence:** the component tier is where *most* BFF behavior coverage should live — everything you can prove without a live cluster or a real token — so the integration tier shrinks to *only* what genuinely needs the real stack (real token accepted, real OC/agents fan-out, the webhook→build→deploy lifecycle, real SSE stream shape).

### In scope
- A reusable in-process harness, `internal/platform/componenttest/`, that assembles the **real** `/api` handler with a fake-auth middleware + the **enforce-mode** gate, and lets a test drive it with `httptest` and program the mocked externals per case.
- A **standard test-double strategy** (moq for out-of-process clients; hand fakes + fixture builders per feature in a `<feature>test/` subpackage for *sibling* services).
- **A naming + folder convention** so the file structure *is* the tier signal (`*_service_test.go` = unit, `*_component_test.go` = component, `*_componentdb_test.go` / `*_dbtest_test.go` = real DB).
- The **enabling production refactors** (§8) that make the above clean rather than bolted-on — the user has explicitly green-lit refactoring to "make this proper."

### Out of scope
- The over-HTTP integration suite and the lifecycle/delivery slice — owned by `backend-testing.md`, unchanged.
- The future frontend e2e (Playwright under `console/`).
- Replacing the existing colocated unit tests — they **are** the unit tier; this doc formalizes the layer above them.

---

## 2. The pyramid, completed — and the boundary of each tier

**Tiers are named, not numbered.** `backend-testing.md` already uses "Level 1=unit, Level 2=integration, Level 3=e2e," so a second integer scheme here would collide (its Level 2 ≠ a "tier 2" here). This doc refines its in-process **Level 1** into three named tiers — **unit · component · store** — and defers to its names for **integration** and **e2e**. (§11 reconciles the two docs.)

The **boundary** is the contract of the whole design: *what is real and what is a double at each tier.* Get the boundary right and the tier is fast, deterministic, and proves exactly one thing.

| Tier | Lives in | Run by | HTTP? | Auth | Service under test | Store | Out-of-proc clients |
|---|---|---|---|---|---|---|---|
| **Unit · service** | `internal/feature/<f>/<f>_service_test.go` | `go test` (`make test`) | none | n/a | **real** | mocked port | mocked |
| **Unit · pure** | `internal/platform/**/*_test.go`, `internal/arch`, `api/*_test.go` guards | `go test` | none | n/a | n/a | none | none |
| **Component** *(NEW)* | `internal/feature/<f>/<f>_component_test.go` | `go test` (`make test`) | **real Huma handler + middleware, in-process** | **faked at the claims seam; gate ENFORCE** | **real** | **mocked port** | **mocked** |
| **Component + DB** *(NEW, sparing)* | `internal/feature/<f>/<f>_componentdb_test.go` (`//go:build dbtest`) | `go test -tags dbtest` (`make test-db`) | real handler, in-process | faked; gate ENFORCE | real | **real Postgres `:5433`** | mocked |
| **Store** | `repositories/<r>_dbtest_test.go` (`//go:build dbtest`) | `go test -tags dbtest` | none | n/a | n/a | **real Postgres** | none |
| **Integration** | repo-root `test/` (Ginkgo) | `cd test && ginkgo` | **real HTTP → live BFF** | **real Thunder token** | real | real | **real** |
| **E2E** | `console/tests/e2e/` (future) | Playwright | browser → full stack | real OIDC login | real | real | real |

**The single rule that defines every boundary below integration:** *fake only what is outside this process — the network calls and the token signer. Everything you own — the router, the middleware order, the gate, **and the feature's own service** — runs for real; only at the Component+DB / Store tiers does the database join it.* This is precisely agent-manager's "real Postgres, real repos/services, moq just the external HTTP clients, fake just the token verifier."

> **What runs real vs faked — the rule that keeps the tier honest (P1-A):** the **feature under test always runs its real service**; you mock its **out-of-process clients/ports** (moq). You do **not** hand-fake the service under test — that would prove only `handler → fake` and skip the handler→service→error-map surface the tier exists to cover. Hand fakes (in `<feature>test/`, §6) are *only* for **sibling** feature services the feature consumes, and for the whole-API sweep (§9), where no service logic is under test.

**Why a distinct component tier instead of just more unit + more integration:**
- Unit tests of a service prove logic but **never touch the gate, the input validation, the error mapping, or the route** — the parts that produce most real-world BFF bugs (wrong status code, leaked existence, missing validation, ungated route).
- Integration tests touch all of that but cost a cluster and a token and can't run per-save. You cannot afford one per error path.
- The component tier is the only place that proves **"this org cannot see that org's project" and "a missing name is a 422"** in milliseconds, with no infrastructure. That is where those assertions *belong*.

---

## 3. Auth in component tests — the seam, not a bypass

The BFF is fronted by a Thunder RS256 token. Production inbound path (`api/app.go:208`):

```
mux.Handle("/api/", jwt( ensureOrg( apiMux ) ))   // no http.StripPrefix — ops match full /api/v1/… paths
                     │        │         └─ Huma API; ORG-SCOPED ops embed humakit.OrgScopedInput,
                     │        │            whose Resolve() IS the tenant gate (reads jwt.ClaimsFromContext,
                     │        │            404s on org mismatch in ENFORCE). NON-org-scoped userJWT ops
                     │        │            (list-organizations, idp/discover, collab/validate) have NO gate.
                     │        └─ orgensure.Middleware(OrganizationService): JIT org row; nil service → pure passthrough.
                     └─ jwt.Middleware{JWKS,iss,aud}: RS256-verify via JWKS, project to jwt.Claims,
                        store via jwt.WithClaims(ctx, claims). REJECTS tokenless/forged BEFORE the gate runs.
```

The gate (`humakit.OrgScopedInput.Resolve`, already in the tree) reads **only** `jwt.ClaimsFromContext(ctx)` and the `{orgHandle}` path value — no DB, no JWKS. It returns: no claims → **401**; org mismatch → **404** (same body as no-such-org, no existence leak); malformed `{orgHandle}` slug → **400** (and the slug check *precedes* the no-claims check, so malformed+tokenless → 400). That is the seam.

> **Component auth = swap the `jwt` middleware for a claims-injector; keep `orgensure` (or nil-it) and keep the gate in ENFORCE.** No JWKS, no Thunder, no signature — but the *exact same gate code* runs against the *exact same claims shape* a verified Thunder token would have produced. The thing we most need to prove (the IDOR fence) runs against the real code, in-process.

### The injector

A header-driven fake auth middleware (parallel-safe, table-test friendly): the harness's request builder stamps a private header; the middleware projects it into `jwt.Claims` exactly as a verified Thunder token would, then deletes the header before the request proceeds.

```go
// internal/platform/componenttest/auth.go  (illustrative)
const hdrOrg, hdrSub = "X-Test-Org", "X-Test-Sub"

func fakeInboundAuth(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if org := r.Header.Get(hdrOrg); org != "" {
            c := &jwt.Claims{OuHandle: org, OuId: org + "-ouid", Subject: r.Header.Get(hdrSub)}
            r = r.WithContext(jwt.WithClaims(r.Context(), c))
        } // no header → no claims; an ORG-SCOPED op then 401s at the gate's no-claims branch.
        r.Header.Del(hdrOrg); r.Header.Del(hdrSub)
        next.ServeHTTP(w, r)
    })
}
```

This folds in — and supersedes — today's `tenancytest.UserRequest`, which sets claims on a *bare* request handed to a *gate-only* handler. The harness instead runs the claims through the **whole** `fakeInboundAuth → orgensure → Huma` chain, so the test also exercises input parsing, validation, and error mapping — the full component contract, not just the gate.

### What the component tier proves — and what it does NOT (own the fidelity gap)

| Concern | Proven where | Why not at the component tier |
|---|---|---|
| Tenant gate: cross-org → 404 (no leak), no-claims → 401, malformed org → 400 — **for org-scoped ops** | **Component** (every org-scoped op, §9) + Unit (`humakit` gate algebra) | — (this is the tier's headline) |
| RS256 signature, `iss`/`aud` match, JWKS fetch/refresh, **RFC 9728 `WWW-Authenticate` challenge** on tokenless/forged | **Unit** (`jwtassertion/auth_test.go`) + **Integration** (one real-token 200) | the harness *fakes the verifier away*; `NoAuth()` reaches the gate, producing the gate's plain 401 (`application/problem+json`, **no** challenge header) — a **different code path and body** than the verifier's pre-gate rejection |
| **Auth on NON-org-scoped userJWT routes** (`list-organizations`, `idp/discover`, `collab/validate`) | **Integration** only | these have **no gate**; their only auth is the verifier, which the harness fakes — so `NoAuth()` against them reaches the handler (no 401). The component tier cannot prove their auth; do not assert it there |
| Org-scoped **store** isolation (by-UUID IDOR) | **Store** (`*_dbtest_test.go`) | needs real Postgres |
| The real token is actually accepted by the running BFF | **Integration** only | needs Thunder |

Each assertion lives in exactly one tier. The component tier does not re-prove signature verification, and the integration tier does not re-prove every cross-org path.

---

## 4. The `componenttest` harness

New package `internal/platform/componenttest/`. It calls the shared `assemble` builder (§8.1) with `fakeInboundAuth` in place of the JWKS verifier (so a nil `ThunderJWKS` is harmless), the gate at its **default ENFORCE**, the feature services supplied by the test, and the raw-handler controllers from `Options` (**nil by default** — webhook/task/connect are all nil-guarded in `assemble`, so they degrade cleanly to health + the `/api/` chain + global middleware; set one to mount + test that non-User-JWT surface, §7). The result is the **real** production chain with one seam swapped.

```go
// internal/platform/componenttest/componenttest.go  (illustrative)
package componenttest

type Options struct {
    Deps api.HumaDeps  // services under test (real services + mocked clients); fill only what the feature needs
    DB   *gorm.DB      // nil → orgensure no-ops, no store (default Component tier)

    // Optional raw-handler controllers for the NON-User-JWT surfaces (§7). nil by default —
    // org-scoped feature tests don't need them; set the relevant one to mount + test webhook
    // HMAC / task-callback / connect-callback routes, which `assemble` registers when non-nil.
    Webhook   webhook.WebhookController
    Task      task.TaskController
    OrgGitHub orgcreds.OrgGitHubController
}

type Harness struct {
    Handler http.Handler // fakeInboundAuth → orgensure → Huma(ENFORCE): the real chain
    API     huma.API     // the constructed Huma API — so the §9 sweep enumerates OpenAPI() in-memory (no YAML re-parse)
}

func New(t testing.TB, opt Options) *Harness  // captures both the handler and the huma.API assemble built

// Request builders → a small fluent *Req (Get/Delete; Post/Put take a JSON body) → *httptest.ResponseRecorder.
func (h *Harness) AsOrg(org string) *Req   // stamps X-Test-Org: a verified token for `org`
func (h *Harness) NoAuth() *Req            // no claims → org-scoped op 401s at the gate
type Req struct{ /* … */ }
func (r *Req) With(mut func(*jwt.Claims)) *Req                 // customize sub/OuId/etc. when a handler reads more than OuHandle
func (r *Req) Get(path string) *httptest.ResponseRecorder
func (r *Req) Delete(path string) *httptest.ResponseRecorder
func (r *Req) Post(path, jsonBody string) *httptest.ResponseRecorder   // body REQUIRED for required-body ops (see §9)
func (r *Req) Put(path, jsonBody string) *httptest.ResponseRecorder

// AssertCrossOrgDenied drives AsOrg(tokenOrg) against a path naming a DIFFERENT org and asserts the gate's
// cross-org response: 404 AND the RFC-9457 body "organization not found" (status alone is ambiguous — see §9).
// For POST/PUT it sends a well-formed non-empty body ("{}") so the gate runs (see §9). The §9 sweep calls this
// for every org-scoped operation.
func (h *Harness) AssertCrossOrgDenied(t testing.TB, method, target, tokenOrg, jsonBody string)
```

### Two scopes, one harness

- **Per-feature (default, fast):** register a single feature on the harness backed by its **real** service + mocked clients. Sub-millisecond; one file per feature.
- **Whole-API (the sweep + wiring):** register `api.RegisterAllHuma` with a `HumaDeps` of **hand fakes** (`fakeDepsAll` — here no service logic is under test, so faking is correct). Used by the §9 IDOR sweep and a smoke that proves the assembled chain wires without panic. This is agent-manager's `MakeAppClientWithDeps` driving the full router.

### A representative component test

```go
// internal/feature/project/project_component_test.go  (illustrative)
func TestProject_Component(t *testing.T) {
    oc := &ocmocks.ProjectClientMock{}                 // out-of-process client → mocked
    svc := NewProjectService(oc, /* sibling fakes: repoSvc, webhookReg, artifactSvc, … */)  // REAL service under test
    h := componenttest.New(t, componenttest.Options{Deps: api.HumaDeps{ProjectSvc: svc}})

    // happy path — same-org create (list/get delegate straight to the OC client; create/delete also touch sibling ports)
    oc.CreateProjectFunc = func(_ context.Context, org string, r *models.CreateProjectRequest) (*models.Project, error) {
        return &models.Project{Name: r.Name}, nil
    }
    require.Equal(t, 201, h.AsOrg("acme").Post("/api/v1/organizations/acme/projects", `{"name":"web"}`).Code)
    require.Len(t, oc.CreateProjectCalls(), 1)

    // validation — name ABSENT → 422 (Huma schema-required); name PRESENT-but-empty → 400 (handler guard). Both real.
    require.Equal(t, 422, h.AsOrg("acme").Post("/api/v1/organizations/acme/projects", `{}`).Code)
    require.Equal(t, 400, h.AsOrg("acme").Post("/api/v1/organizations/acme/projects", `{"name":""}`).Code)

    // auth — tokenless org-scoped request is 401 at the gate's no-claims branch (NOT the verifier; see §3)
    require.Equal(t, 401, h.NoAuth().Get("/api/v1/organizations/acme/projects").Code)

    // IDOR — org "acme" cannot reach org "evil"'s projects (404 + "organization not found" body)
    h.AssertCrossOrgDenied(t, "GET", "/api/v1/organizations/evil/projects", "acme", "")
}
```

This single file proves the **whole HTTP contract** of the feature — status codes, validation (both 422 and 400 paths), auth, the IDOR fence, and that the right client call was made — with **zero infrastructure**, under plain `make test`.

> **Fidelity note (humatest vs the real chain).** `humatest.New` mounts the Huma adapter *without* the production `jwt`/`orgensure` chain. It is **not** incapable of running the gate — `humatest.GetCtx`/`PostCtx` build the request via `http.NewRequestWithContext`, so a test can inject `jwt.WithClaims(ctx, …)` and reach `OrgScopedInput.Resolve` in ENFORCE. The existing `project_huma_test.go` flips the gate to LOG only because it calls `api.Get(...)` with **no** claims. The `componenttest` harness's value is therefore not "the gate is otherwise unreachable" — it is that the harness runs the **real `fakeInboundAuth → orgensure → humago` chain in production order**, so input parsing, the JIT-org middleware, the gate, and error mapping are all exercised together. `humatest`-style tests are kept only for the lightweight "does this feature register + spec-contains" checks; behavioral coverage moves to `componenttest`.

---

## 5. Folder & file structure — the structure *is* the tier signal

The **filename suffix** declares the tier; the **package** stays colocated with the code under test so tests move with their feature and the arch-lock keeps boundaries honest.

```
asdlc-service/
  internal/platform/
    componenttest/                 # NEW · the in-process handler harness (§4)
      componenttest.go             #   New(t, Options) → *Harness{Handler}; AsOrg/NoAuth/Req
      auth.go                      #   fakeInboundAuth (supersedes tenancytest.UserRequest)
      sweep.go                     #   AssertEveryOrgScopedOpFenced (the §9 IDOR sweep)
    dbtest/                        # exists · real Postgres :5433 (Open/Migrate/CleanupRows)
    humakit/                       # exists · OrgScopedInput + gate (ENFORCE is the default; §8.3)
    tenant/                        # exists · gate algebra (GateMode, BindUserOrg)

  internal/feature/<f>/
    <f>_service.go                 # the service (interface + NewXxxService ctor)
    <f>_service_test.go            # UNIT — service logic w/ mocked ports
    <f>_huma.go                    # the Huma operations (the HTTP contract)
    <f>_component_test.go          # COMPONENT — through the harness, gate ENFORCE
    <f>_componentdb_test.go        # COMPONENT + real Postgres (//go:build dbtest) — only where SQL matters
    <f>test/                       # NEW (per feature, as needed) · EXPORTED hand fakes for THIS feature's
      fakes.go                     #   service + consumer ports, for SIBLING features + the sweep to import
      fixtures.go                  #   builders: NewProject(...), valid/invalid request bodies

  clients/<c>/mocks/               # exists (OC) / NEW (agents, smapi, thunder) · moq fakes for out-of-process clients
  internal/feature/gitrepo/        # git provider interfaces live HERE, not under clients/ (GitHubClient/GitHubV2Client = the
                                   #   out-of-process GitHub seam → moq; RepoService = a sibling service → hand-fake in gitrepotest)
  repositories/<r>_dbtest_test.go  # STORE — real Postgres (exists)
  api/
    *_test.go                      # pure guards: arch, gate-invariant, spec-fresh, registration
    handler_for_test.go            # NEW · exports assemble for componenttest (§8.1)
```

### Conventions (lock these in; add to `arch_test` where mechanical)

- **`*_service_test.go`** — unit; no HTTP, no DB; deps mocked/faked.
- **`*_component_test.go`** — component; uses `componenttest`; no DB; runs under `make test`.
- **`*_componentdb_test.go`** and **`*_dbtest_test.go`** — carry `//go:build dbtest`; real Postgres; run under `make test-db`; **skip-if-unreachable** (never fail) so `make test-db` is safe without a stack. The single `componentdb` token (not `component_dbtest`) keeps one semantic suffix + the build tag.
- **Test doubles for a feature's *own* service/ports** (for sibling consumers + the sweep) live in `internal/feature/<f>/<f>test/` (exported). **Test doubles for out-of-process clients** live in `clients/<c>/mocks/` (moq, `make gen-mocks`). One pattern each — no ad-hoc fakes re-rolled per file.
- **Never** put a behavioral assertion in a `humatest.New` test when you want the production chain; use `componenttest`.

---

## 6. Test-double strategy — moq at the edge, hand fakes at the seam

Two kinds of double, chosen by *what they stand in for*:

1. **Out-of-process clients → moq** (`clients/<c>/mocks`, regenerated via `make gen-mocks`, `//go:generate`). Function-field mocks with `XxxFunc` setters and `XxxCalls()` recorders — already the house style (`ProjectClientMock`). Program per case; assert call count/args. Note the git seam: the out-of-process boundary is the **GitHub API** behind `gitrepo.GitHubClient` / `GitHubV2Client` (mock those); `gitrepo.RepoService` is an **in-process sibling service** (hand-fake it in `gitrepotest` for the features that consume it).
2. **In-process sibling services & consumer ports → hand fakes** in `<feature>test/`. Small, intent-revealing, next to the interface they implement (e.g. `projecttest.FakeService{CreateFn: …}`). They double the *seam between features*, not the network — and they back the whole-API sweep's `fakeDepsAll`.

**Fixtures/builders** live beside the fakes (`<feature>test/fixtures.go`): `NewProject(opts…)`, `ValidCreateBody()`, `InvalidCreateBody()`. The `dbtest` flavor namespaces rows with the `dbtest-` prefix (`CleanupRows`).

**Default-and-override factories** (agent-manager's `CreateMockOpenChoreoClient`): for clients with many methods, ship a `<feature>test` builder returning a mock with sane defaults so each test overrides only the one method it cares about — avoids the `panic("method is nil")` boilerplate.

---

## 7. What to test at the component tier — per feature

Each org-scoped feature gets a `*_component_test.go` covering its **HTTP contract**, asserted **structurally** (status, shape, the right client call), never against Anthropic-generated prose.

| Feature | Component-tier assertions (in-process, real service, mocked externals, gate ENFORCE) |
|---|---|
| **project** | create 201 / get / list / delete 204; name absent → 422, name empty → 400; cross-org → 404 (+body); no-claims → 401; OC `CreateProject` called once |
| **requirements / design** | generate (mocked agents-service stream) → **assert completion + persisted artifact only** (see SSE rule); save → version tag surfaced; save-without-prior-version rejected; artifact-store/git port called with the right path; gate per route |
| **component / config** | list/get; env-var edit mirrors onto the OC component (mock `ComponentClient`); validation; gate |
| **task** | generate `ComponentTask`s → dispatch transitions (mock dispatcher + GitHub + OC); board read; gate. (By-UUID cross-org isolation is proven at the **store** tier via `GetByIDScoped`, not re-proven here) |
| **orgcreds (github/anthropic)** | connect/disconnect/status; missing/invalid input mapping; gate |
| **idp / skills / runtimeconfig / board** | the read/write contract + gate for each org-scoped op |
| **webhook** | **owns** HMAC valid → 200, bad/missing signature → 401, duplicate `X-GitHub-Delivery` → deduped — all computable in-process (no token). Integration keeps only **one** webhook→state-transition smoke (§11) |

**SSE / streaming rule.** The generative endpoints (requirements-chat, design/task generate) stream over SSE. `httptest.ResponseRecorder` buffers (it records `Flushed` but does not model real streaming/backpressure), so **in-process tests assert only: the mocked finite stream completed and the save side-effect fired (artifact persisted, task created).** In practice (requirements/design implementations) that assertion lands at the **unit** tier — the service method drives the faked upstream directly and the component harness passes a nil agents client — which is equivalent and faster; either in-process tier satisfies this rule. Real SSE **stream shape** (event framing, `data-finish`, ordering) stays in the integration tier (`framework.ConsumeSSE`). Do not assert stream shape in-process.

**Non-User-JWT surfaces keep their own posture, tested directly** (not via `AsOrg`): the GitHub webhook (HMAC), the runner Task-JWT callbacks (`/api/v1/tasks/{taskId}/…`, RS256 task bearer — round-trip already unit-tested in `internal/platform/auth`), and the App-connect callback (signed connect-state JWT). Set the matching `Options` controller (`Webhook` / `Task` / `OrgGitHub`, §4) so `assemble` mounts these raw handlers, then drive them with computed signatures / task bearers and assert each with its real auth check — not skipped.

**Deferred (stated, not silently dropped):** pagination/cursor (`listProjectsInput.Cursor`) and idempotency — assert at the component tier only where the BFF owns the semantics (cursor echo/validation); OC-driven paging shape stays integration.

---

## 8. Enabling refactors (production code)

These make the tier *clean* rather than bolted on, mirroring agent-manager's two-injectors-one-app-struct. Each is small, additive, and changes **no production behavior** — they only add seams.

### 8.1 Extract a shared `assemble` builder (the keystone) — feasible and minimal

`api.NewHandler`'s raw-handler registrations (webhook, task callbacks, connect, sm-api-resync) are **already nil-guarded**, so extracting the current body of `NewHandler` into one `assemble(AppParams)` that both production and tests call lets the harness pass **nil controllers** and degrade cleanly to *health + the `/api/` chain + the global middleware stack* — maximum prod≡test fidelity with no hand-rebuilt subtree.

```go
// api/app.go
func NewHandler(p AppParams) http.Handler { return assemble(p) }            // prod: real JWKS verifier
// api/handler_for_test.go   (exported for componenttest; still package api)
func NewHandlerForTest(deps HumaDeps, auth func(http.Handler) http.Handler, db *gorm.DB) http.Handler {
    return assemble(AppParams{HumaDeps: deps, InboundAuth: auth, DB: db})   // nil controllers, gate default ENFORCE
}
```

### 8.2 Make the inbound-auth verifier injectable

Add **one** new `AppParams` field, `InboundAuth func(http.Handler) http.Handler` (the rest — `DB`, `HumaDeps`, `ThunderJWKS` — already exist; no collision). In `assemble`: when `InboundAuth != nil` use it; else build today's `jwtmw.Middleware{JWKS: params.ThunderJWKS, …}` (current behavior, zero change for `main.go`). Critically, the `InboundAuth`-set path **skips** constructing the JWKS verifier, so a nil `ThunderJWKS` in tests is harmless. This is the single seam that slots `fakeInboundAuth` exactly where the JWKS verifier sits — agent-manager's `AppParams.AuthMiddleware`, in spirit.

### 8.3 Stop tests from flipping the gate (NOT a mode-propagation refactor)

ENFORCE is **already the package default** (`humakit.gateMode = GateModeEnforce`); the component tier wants ENFORCE and never flips it. The only flipper today is the spec/registration tests (`project_huma_test.go` → LOG, restored in `Cleanup`) — and the only real hazard is a `t.Parallel` LOG+ENFORCE race *within one package*.

> **Do the minimal thing, and do it outside Phase 0:** make the spec/registration checks **stop flipping the gate** — assert on the generated spec string, or send an *authed* request (`AsOrg`) instead of a no-claims one — and delete their `SetGateMode` calls. Keep the global set-once at `assemble`. **Reject** the earlier "thread mode through `OrgScopedInput`" framing: Huma re-instantiates the embedded input struct per request via reflection and zero-values its fields, so a registration-time field cannot carry mode. If per-instance mode is ever truly needed, the *only* feasible mechanism is a **context value** set by a middleware in `assemble`, read by `Resolve` with an ENFORCE default — not a struct field, not threading through every `RegisterX`. Most likely it is never needed.

### 8.4 Repoint the stale legacy template

`api/tenancy_http_test.go` is advertised as the "copyable template" but exercises the **legacy `Router` + `BindUserOrg`** path, not the Huma `OrgScopedInput.Resolve` path production serves. Repoint it to `componenttest`; keep the legacy `Router` tests only for the raw-handler routes that still use it (webhook, task callbacks, connect).

### 8.5 Standardize doubles — with an explicit seam inventory

Today **only OpenChoreo** has moq mocks. The other out-of-process seams have interfaces but no mocks; some are not yet behind a clean mockable port. This is a **Phase-4 prerequisite**, surfaced now:

| External seam | Interface today | Mock today | Action |
|---|---|---|---|
| OpenChoreo (`clients/openchoreo`) | yes (5 ifaces) | **yes** (moq) | reuse |
| agents-service (`clients/agents.Client`) | yes | no | add `//go:generate moq` → `make gen-mocks` |
| SM-API (`clients/secretmanagersvc`) | yes (several) | no | add moq |
| Thunder admin (`clients/thundersvc.Client`) | yes | no | add moq |
| GitHub API (`internal/feature/gitrepo.GitHubClient` / `GitHubV2Client`) | yes | no | add moq (this is the real out-of-process git seam) |

Plus seed each feature's `<feature>test/` with the hand fakes + builders §6 describes. **Flag any seam that turns out *not* to be behind a mockable port as a blocker for that feature's Phase-4 component test** — don't paper over it.

> **Sequencing:** 8.1 + 8.2 unblock the harness and are the only Phase-0 items. 8.4 / 8.5 trail the first green tests. 8.3 is a small test-hygiene change, not a Phase-0 refactor (see §12).

---

## 9. The IDOR sweep — behavioral proof, built to actually run green

Three arch-locks already fence the IDOR class *structurally*: `arch_test` (boundaries), `gate_invariant_test` (gated routes register through the typed `Router`), and `huma_guard_test.TestOrgScopedInputIsOnlyOrgHandleBinding` (every `{orgHandle}` op under `internal/feature/` embeds `OrgScopedInput`). These prove *"every org-scoped route is wired to the gate."* They do **not** prove *"the gate actually returns the cross-org 404 at runtime."* The sweep adds that — and must be built around the real Huma v2.38.0 request pipeline, or it false-fails:

**Pipeline facts that shape the sweep** (Huma `huma.go`, request handler):
- Order is **params → body schema validation → resolvers (incl. `OrgScopedInput.Resolve`) → status selection**. Body schema errors are `*ErrorDetail` (not a `StatusError`); the gate's 404 **is** a `StatusError`; final status = the **last `StatusError`** ⇒ **the gate's 404 overrides a body 422**. So a cross-org POST with a well-formed-but-invalid body (`{}`) still yields 404.
- **But** a **zero-length** body on a **required-body** op (non-pointer `Body` field ⇒ `RequestBody.Required=true`) hits a hard `400 "request body is required"` **early-return, before resolvers run**. So the sweep must send a **non-empty** body for POST/PUT.

**Therefore the sweep:**
1. **Enumerates from the in-memory spec object**, not re-parsed YAML: iterate `humaAPI.OpenAPI()` operations; select those whose path contains `{orgHandle}` **AND** whose `Security` includes `userJWT`. This is exactly the org-scoped set: the arch-lock guarantees every such op is gated, and the predicate auto-excludes the one deliberately-ungated `{orgHandle}` op (`get-anthropic-effective-key`, an S2S `/internal/…` route with no security requirement) and auto-includes any newly-added org-scoped op — **it can never go stale**, no hand-maintained exclusion list.
2. **Constructs a runnable cross-org request per op:** substitute `{orgHandle}` with a different org than the token's; substitute **every other** path param (`{projectName}`, `{taskId}`, …) with a non-empty placeholder `"x"`; for POST/PUT send `"{}"` (well-formed, non-empty), for GET/DELETE no body.
3. **Asserts on the problem body, not just status:** require 404 **and** the RFC-9457 detail `"organization not found"`. Status alone is ambiguous — an unsubstituted/misrouted path also 404s as a Go `ServeMux` route-miss; only the gate's body distinguishes a real cross-org denial from a routing miss.

```go
// internal/platform/componenttest/sweep.go drives it; the test lives in api/
func TestEveryOrgScopedOpIsFenced(t *testing.T) {
    h := componenttest.New(t, componenttest.Options{Deps: fakeDepsAll()})   // RegisterAllHuma w/ hand fakes
    for _, op := range orgScopedUserJWTOps(h.API()) {                       // {orgHandle} ∧ userJWT, from OpenAPI()
        target := op.PathWith("orgHandle", "evil", otherParams, "x")        // substitute ALL path params
        body := ""; if op.Method == "POST" || op.Method == "PUT" { body = "{}" }
        h.AssertCrossOrgDenied(t, op.Method, target, "acme", body)          // 404 AND "organization not found" body
    }
}
```

This is the runtime complement to the structural arch-locks: structure proves *wired*, the sweep proves *enforced* — and, because it enumerates from the live spec with a predicate (not a list), a new org-scoped route is swept the moment it is registered.

---

## 10. Make targets & CI

```bash
# Unit + Component (real services, mocked clients, no DB). Fast; the default loop.
cd asdlc-service && make test           # go test ./...   (now includes *_component_test.go + the IDOR sweep)

# Component+DB and Store, against deployments Postgres :5433.
cd asdlc-service && make test-db        # go test -tags dbtest ./...   (skips if DB down)

# Integration (real stack, real token) — unchanged, owned by backend-testing.md.
cd test && ginkgo ./authoring/...
```

No new top-level target is required: component tests run under the existing `make test` (no DB), and the DB-backed flavor rides the existing `dbtest` tag. CI: the **unit** job (`make test`) now also runs the component tier **and the IDOR sweep, per PR, with no infrastructure** — the first time cross-org/validation/status-code regressions are caught before merge rather than in a nightly stack run. `make test-db` runs where a Postgres is available. The integration jobs stay manual/scheduled.

---

## 11. Relationship to existing tests & docs

| Existing | Fate |
|---|---|
| Colocated `*_service_test.go`, platform/`arch`/gate guards | **Keep** — unit tier; unchanged. |
| `repositories/*_dbtest_test.go`, `internal/platform/dbtest` | **Keep** — store tier; the component+DB flavor reuses `dbtest`. |
| `project_huma_test.go` (and any `humatest.New` test) | **Demote to spec/registration check**; stop flipping the gate (§8.3); behavioral + gate coverage moves to `project_component_test.go`. |
| `internal/feature/shared/tenancytest` | **Fold into `componenttest`** — `UserRequest`/`AssertCrossOrgDenied` become harness methods that run the *real* chain and assert on the problem body, not a bare gate handler + status only. |
| `api/tenancy_http_test.go` "template" | **Repoint to the Huma path** via `componenttest` (§8.4). |
| **Webhook HMAC** | **Component tier owns** HMAC valid/bad/dedup (computable in-process). `backend-testing.md` §6.1 `webhook_test.go` shrinks to **one** webhook→state-transition smoke — state the split in both docs so HMAC cases don't grow in two places. |
| `docs/design/backend-testing.md` | **Unchanged** except: add the webhook-split note above + a one-line cross-ref — *"In-process unit/component/store testing is specified in `docs/design/bff-component-testing.md`; the tiers there refine this doc's Level 1."* |
| `docs/design/testing.md` | Update "Test Types" to point at the full named pyramid (§2 here + the integration/e2e levels in `backend-testing.md`). |
| Root `CLAUDE.md` "Testing" | Add the component tier: *unit+component = `cd asdlc-service && make test`; +DB = `make test-db`; integration = `cd test && ginkgo …`.* |

**Component+DB vs Store (avoid double-maintenance).** Add a `*_componentdb_test.go` **only** when the assertion cannot be expressed as *service-with-mock-repo* (unit) **plus** *repo-with-real-DB* (store). If both of those already cover it, don't add the slow flavor. When a Component+DB test *is* warranted, decide its `orgensure` posture explicitly: pass a real `OrganizationService` (so the JIT org row materializes, if the flow depends on it) or nil it (pure passthrough) — and write which, per test.

---

## 12. Implementation plan (phased)

Build the smallest vertical slice that proves the whole approach, *then* fan out. The riskier hygiene change (§8.3) is deliberately **not** in Phase 0 — the harness needs none of it, because ENFORCE is already the default.

**Phase 0 — Harness-enabling seams (§8.1 + §8.2 only).** Extract `assemble`; add `AppParams.InboundAuth` (skip JWKS when set). *Acceptance:* `make test` unchanged green; `main.go` behavior untouched; nil `ThunderJWKS` harmless under the test path.

**Phase 1 — The harness + the first feature, end to end (the proof slice).** Build `componenttest` (`New`/`Options`/`Req`, `fakeInboundAuth`, `AsOrg`/`NoAuth`/`With`, `AssertCrossOrgDenied` with body arg + problem-body assert). Write `project_component_test.go` for the §4 matrix (201/422/400/401/cross-org-404, OC call asserted). Demote `project_huma_test.go` to spec-only and drop its `SetGateMode` (§8.3, done here as hygiene, not a refactor). *Acceptance:* one feature's full HTTP contract proven in-process with the real chain + ENFORCE gate; pattern is copyable.

**Phase 2 — The IDOR sweep (§9).** `TestEveryOrgScopedOpIsFenced` enumerating `{orgHandle}` ∧ `userJWT` ops from `OpenAPI()`, substituting all path params, sending `{}` for mutating ops, asserting the problem body. *Acceptance:* every org-scoped op denies cross-org with the gate body; a deliberately-broken op fails the sweep; a newly-registered org-scoped op is swept automatically.

**Phase 3 — Fan out.** A `*_component_test.go` per remaining org-scoped feature (§7), plus the non-User-JWT postures (webhook HMAC, task callbacks, connect callback) driven directly. Add `<feature>test/` fakes + builders as needed; extend `make gen-mocks` for the new client mocks per the §8.5 inventory — **blocking on any seam not behind a mockable port**.

**Phase 4 — Component+DB where it earns it (§11 criterion).** For the few flows whose persistence shape matters and isn't covered by unit+store, add `*_componentdb_test.go` against real Postgres, with an explicit `orgensure` posture. Keep this set *small*.

**Phase 5 — Docs + locks.** Cross-ref `backend-testing.md` (incl. the webhook split) / `testing.md` / `CLAUDE.md` (§11); add arch-lock assertions for the new conventions (suffix naming where mechanical; assert `SetGateMode` is no longer called from `*_huma_test.go`; every `_component_test.go` uses the harness).

---

## 13. Summary

- **The gap:** the BFF has unit tests (logic) and a real-stack integration suite (wiring + real token), but **nothing in between** — no fast, in-process proof of the *HTTP contract*: validation, status codes, error mapping, and above all the **tenant/IDOR gate in ENFORCE**.
- **The tier:** a **component tier** that drives the **real Huma handler + middleware chain in-process** (via a shared `assemble`), with **auth faked at the `jwt.WithClaims` seam (gate ENFORCE, not bypassed)**, the **feature's real service** under test, and **only out-of-process clients mocked** — agent-manager's pattern adapted to Huma + the seams already in the tree.
- **The boundary rule:** *fake only what is outside the process — the network and the token signer; run the real router, middleware, gate, and the feature's own service.* Real DB only in the `dbtest` flavor.
- **The structure is the signal:** `*_service_test.go` (unit) · `*_component_test.go` (component) · `*_componentdb_test.go` / `*_dbtest_test.go` (DB) · `test/` Ginkgo (integration). Doubles: moq at the client edge, hand fakes in `<feature>test/` for sibling services.
- **The refactors that make it proper (all additive, no behavior change):** a shared `assemble` builder (prod ≡ test chain) and an injectable inbound-auth seam — that's it for Phase 0; the global gate mode just stops being flipped by spec tests.
- **Honest about what it does NOT prove:** the verifier's tokenless/forged rejection + challenge header, auth on non-org-scoped userJWT routes, and real SSE stream shape — all owned by unit + integration.
- **The payoff:** cross-org 404, no-claims 401, and validation 422/400 — the BFF's highest-value correctness/security assertions — become **per-feature, per-PR, sub-second, infrastructure-free**, with a spec-predicate IDOR sweep that can never go stale.

---

## 14. Validation & review notes

This design was checked against the actual code and the **Huma v2.38.0** request pipeline by a separate validator, and critiqued by a separate reviewer. Corrections folded in:

- **Huma pipeline order pinned** (the load-bearing fact for §9): params → body schema validation → resolvers → status selection; body errors are `*ErrorDetail` (gate's 404 `StatusError` wins), but a **zero-length required body short-circuits to 400 before resolvers** ⇒ sweep sends non-empty `{}`. (`huma.go` req handler ~1019–1086, 2021–2052.)
- **Sweep predicate** = `{orgHandle}` ∧ `userJWT`, enumerated from `OpenAPI()`; auto-excludes the ungated `get-anthropic-effective-key` (`api/huma_infra.go`); assert the `"organization not found"` body, not status alone.
- **Real-service rule** made explicit (don't fake the service under test).
- **§8.3 corrected** from a (partly infeasible) mode-propagation refactor to "stop flipping the gate in spec tests"; pulled out of Phase 0.
- **Auth fidelity** scoped: the gate's 401 is the no-claims branch (no `WWW-Authenticate`), distinct from the verifier's pre-gate rejection; non-org-scoped userJWT routes have no gate and are integration-owned.
- **SSE** in-process limited to completion + side-effect; stream shape stays integration.
- **Seam inventory** added (only OpenChoreo has moq today; agents/SM-API/Thunder/GitHub need moq; git provider interfaces live under `internal/feature/gitrepo`, not `clients/`).
- **Tier numbering** reconciled to **named** tiers to avoid colliding with `backend-testing.md`'s Levels; **webhook HMAC** ownership split stated to avoid double-maintenance.

Code anchors: `internal/platform/humakit/humakit.go:41,45,72–104`; `api/app.go:43–83,115,197–208`; `middleware/orgensure/orgensure.go:56–60`; `middleware/jwtassertion/auth.go:84–101`; `api/huma_register.go:44–101`; `api/huma_guard_test.go`; `api/huma_infra.go`; `internal/feature/project/project_{huma,service}.go`; `internal/platform/dbtest/dbtest.go`; `Makefile:21–29,56–59`.
</content>
