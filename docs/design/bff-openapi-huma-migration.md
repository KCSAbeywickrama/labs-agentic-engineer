# BFF OpenAPI via Huma — code-first migration design (v1)

**Status:** 📐 Proposed — not started. This is the plan; no code written yet.

**Branch:** TBD (suggest `bff/openapi-huma`), forked from `main`.

**Audience:** whoever implements the OpenAPI spec for `asdlc-service` (the Go BFF). Read this end-to-end before opening editors. It assumes familiarity with `docs/design/api-service.md` and the modularized `internal/feature/*` layout (`docs/design/asdlc-service-modularization.md`).

---

## 1. Goal

Produce — and keep current — an **OpenAPI 3.1 document for the BFF's HTTP API**, generated **code-first** so it cannot drift from the implementation, and make it load-bearing (console TS client generation + live `/docs`).

**Approach chosen:** [Huma v2](https://github.com/danielgtaylor/huma) — a code-first framework where the handler's **Go input/output structs *are* the schema**. The spec is generated from the exact types the handler parses/validates/returns, so request handling and the spec are one definition and cannot disagree.

**Why Huma over the alternatives** (full research write-up was done before this doc):
- **vs. swaggo (annotations):** swaggo's `// @...` comments are a *parallel description that can lie* — the comments are the thing that drifts. swaggo is also OpenAPI 3.0-only with a limited DSL for nested/oneOf schemas. Huma makes drift structurally impossible.
- **vs. design-first (oapi-codegen server gen):** we already use `oapi-codegen` for the OpenChoreo *client* (`clients/openchoreo/gen/`, see the `Makefile` `oapi-*` targets), so the team is fluent in spec↔code. But retrofitting design-first *server* generation onto 75+ existing hand-written handlers means rewriting routing to generated interfaces. Huma is the same "types are the contract" philosophy applied code→spec, and keeps our Go 1.22 `http.ServeMux` router.
- Huma works with the stdlib `http.ServeMux` via the `humago` adapter, emits **OpenAPI 3.1 + JSON Schema**, serves `/openapi.yaml` + `/docs`, gives **request validation for free**, and can generate client SDKs.

**Non-goal of v1:** a big-bang rewrite. This is a **strangler-fig migration** — Huma and the existing `net/http` handlers coexist on the same mux; we port one feature package at a time.

## 2. Non-goals

- Not changing the URL surface, auth model, or response *success* shapes (those map 1:1 — see §5).
- Not preserving the bespoke `{error, message}` shape — we **adopt Huma's standard RFC 9457 `application/problem+json`** error responses (the user is fine returning standard HTTP errors); the console is regenerated from the spec to match (§5.4).
- Not migrating the exotic S2S/runner surfaces (webhook HMAC, Task-JWT, SSE) in the first phases — they have dedicated later phases (§7).
- Not introducing a new router or web framework — `humago` keeps `http.ServeMux`.

## 3. Current state (the surface we must cover)

Established by a full codebase survey. The BFF is `net/http` with Go 1.22 method patterns (`go 1.26.0` in `go.mod`), ~**75 handlers** across `internal/feature/*`, routes registered in `api/*_routes.go` via a thin `Router` (`api/router.go`) that applies the tenant gate.

**Handler pattern today** (e.g. `internal/feature/project/project_controller.go`):
```go
func (c *projectController) CreateProject(w http.ResponseWriter, r *http.Request) {
    org := r.PathValue("orgHandle")                 // path param
    var req models.CreateProjectRequest             // typed body (lives in models/)
    json.NewDecoder(r.Body).Decode(&req)            // manual decode
    // ... errors.Is(err, ...) → utils.WriteErrorResponse(w, status, msg)
    utils.WriteSuccessResponse(w, http.StatusCreated, project) // raw JSON body
}
```
- **Success envelope:** none — raw data object. Maps cleanly to Huma's `Body`.
- **Error envelope:** `utils.ErrorResponse{Error, Message}` → `{"error":"Bad Request","message":"name is required"}` (`utils/response.go`). Differs from Huma's default (§5.4).
- **Request types:** mostly typed structs in `models/`; a few inline anonymous structs (e.g. design file `{content}`).

**Middleware stack** (`api/app.go`, outermost last): `RecovererOnPanic` → `AddCorrelationID` → `RequestLogger` → `ExtractAuthToken` → `jwt.Middleware` (Thunder JWKS RS256) → `orgensure.Middleware` (JIT org provisioning) → **per-route `tenant.BindUserOrg`** (the tenant gate). Task-JWT routes use `RequireTaskBearer` instead; webhook routes use neither.

**The tenant gate (`internal/platform/tenant/gate.go`)** matches the `{orgHandle}` path value against the verified JWT org and **404s on mismatch** — the IDOR fence. Today it wraps each org-scoped leaf handler (`rt.OrgScoped`). Two arch-lock tests enforce this invariant:
- `api/gate_invariant_test.go` — string-scans `api/*_routes.go` and **forbids raw `mux.Handle*` registration of any gated-prefix route** (`/api/v1/organizations`, `/internal/credentials`, `/repos`); everything must go through `rt.OrgScoped`/`rt.Public`.
- `api/tenancy_http_test.go` — copyable template; per gated route asserts `tenancytest.AssertCrossOrgDenied`.
- These must be **re-expressed against the Huma mechanism** (§6.1, §8) — preserving "org scope decided on purpose" is non-negotiable.

**Route groups & auth posture:**

| Group | Auth | Count | Notes |
|---|---|---|---|
| `/api/v1/organizations/{orgHandle}/…` (projects, components, design, requirements, tasks, skills, config, board, idp-profile, github, anthropic) | User JWT + tenant gate | ~55 | The console API — **the priority** |
| `/api/v1/organizations`, `/api/v1/idp/discover` | User JWT, **no** gate (carve-outs) | 2 | scoped to caller's own org in-handler |
| `/api/v1/github/connect/callback` | signed connect-state JWT (query param) | 1 | OAuth callback |
| `/api/v1/tasks/{taskId}/{verification-failed,skills,credentials/refresh}`, `/internal/v1/credentials/refresh` | Task JWT (BFF-signed RS256) / publisher CC | 4 | runner-facing |
| `/internal/credentials/orgs/{orgHandle}/anthropic/effective-key` | **none** (agents-service has no S2S creds) | 1 | internal |
| `/webhooks/github`, `/api/v1/webhooks/github` | HMAC (raw body) | 2 | GitHub webhooks |
| `/auth/external/jwks.json`, `/health` | none | 2 | discovery / health |

**Special (non-plain-JSON) endpoints — the sharp edges:**
- **SSE / AI message stream:** `design.GenerateDesign` and `requirements.StreamChat` write `text/event-stream` via `http.Flusher` (Vercel AI UI message stream, `x-vercel-ai-ui-message-stream: v1`).
- **JSON polling (not SSE):** task `progress/agent` + `progress/build` are normal JSON GETs with `?sinceMillis=&limit=` + a per-org token-bucket rate limiter (`middleware.ProgressRateLimit`). These are *easy* Huma ops.
- **Catch-all wildcard:** design files `PUT|DELETE …/design/files/{path...}` (multi-segment param).
- **Raw body + HMAC:** the GitHub webhook receiver.

## 4. Target architecture (end state)

One `huma.API` over the **root** `http.ServeMux` (so the spec/docs are public, not JWT-gated):

```go
mux := http.NewServeMux()
cfg := huma.DefaultConfig("ASDLC BFF API", version)              // serves /openapi.yaml, /openapi.json, /docs
cfg.Components.SecuritySchemes = map[string]*huma.SecurityScheme{
    "userJWT":     {Type: "http", Scheme: "bearer", BearerFormat: "JWT"},
    "taskJWT":     {Type: "http", Scheme: "bearer", BearerFormat: "JWT"},
    "connectState":{Type: "apiKey", In: "query", Name: "state"},
    "webhookHmac": {Type: "apiKey", In: "header", Name: "X-Hub-Signature-256"},
}
api := humago.New(mux, cfg)
```

**Cross-cutting middleware stays plain `net/http`** wrapping the mux (they need no path params): `RecovererOnPanic`, `AddCorrelationID`, `RequestLogger`, `ExtractAuthToken`.

**Auth becomes security-scheme-driven Huma middleware.** A single Huma middleware inspects `op.Security` and runs the matching verifier — reusing the existing `jwtassertion`/`jwt`/`credentials` code via `humago.Unwrap(ctx)` to get the underlying `*http.Request`. This makes the OpenAPI `security` blocks *truthful* (the spec says exactly what each route requires). `orgensure` (JIT provisioning) runs inside the `userJWT` branch.

**Tenancy becomes a Resolver, not leaf-wrapping.** Define a shared embedded input:
```go
type OrgScopedInput struct {
    OrgHandle string `path:"orgHandle" doc:"Organization handle"`
}
func (i *OrgScopedInput) Resolve(ctx huma.Context) []error {
    // reuse tenant.BindUserOrg logic: compare OrgHandle vs verified JWT org,
    // return huma.Error404NotFound on mismatch (enforce mode) and bind tenant.Caller.
}
var _ huma.Resolver = (*OrgScopedInput)(nil)
```
Every org-scoped operation **embeds `OrgScopedInput`** → gated by construction. Operations that don't embed it are the carve-outs. This *replaces* the `rt.OrgScoped` leaf-wrap with an equally structural, even more local invariant (§8 keeps it arch-locked).

**Handlers become typed funcs** (`huma.Register` / `huma.Get|Post|…`):
```go
type CreateProjectInput struct {
    OrgScopedInput                       // path orgHandle + tenant gate
    Body models.CreateProjectRequest     // reuse existing model
}
type ProjectOutput struct { Body models.Project }

huma.Register(api, huma.Operation{
    OperationID: "create-project", Method: "POST",
    Path: "/api/v1/organizations/{orgHandle}/projects",
    Tags: []string{"Projects"}, Security: []map[string][]string{{"userJWT": {}}},
    DefaultStatus: 201,
}, func(ctx context.Context, in *CreateProjectInput) (*ProjectOutput, error) {
    p, err := svc.CreateProject(ctx, in.OrgHandle, &in.Body)
    if err != nil { return nil, mapError(err) }   // errors.Is → huma.ErrorXxx
    return &ProjectOutput{Body: *p}, nil
})
```

**Service layer is untouched.** Only the controller/HTTP edge changes: manual decode + `WriteSuccessResponse`/`WriteErrorResponse` are replaced by Huma input/output structs + `mapError`.

## 4.1 huma.API structure & maintainability (best practices)

Researched from Huma's Groups / Operations / AutoRegister docs. Goal: keep the modularized `internal/feature/*` layout and change the mental model as little as possible vs. today's `registerXxxRoutes`.

- **One `huma.API`, created at the composition root** (`api/app.go`). Security schemes + OpenAPI `info`/`servers` live there only; features just register operations.
- **One `huma.Group` per feature (or per auth posture).** A group sets the shared path prefix and uses `UseModifier` to stamp `Tags` (+ `Security`) on every op once, and `UseMiddleware` for group-wide concerns — e.g. an org-scoped group carries the auth+tenancy middleware so ops don't repeat it. ([Groups](https://huma.rocks/features/groups/))
- **Feature-colocated registration via `huma.AutoRegister`.** Each feature exposes `internal/feature/<x>/<x>_huma.go` with a `Register*` method/func; `huma.AutoRegister` auto-discovers any method named `Register…` and calls it with the API. This is a near-1:1 swap for today's `registerXxxRoutes(rt, controller)` and keeps the HTTP edge next to the feature (consistent with `docs/design/asdlc-service-modularization.md`).
- **Set explicit `OperationID`s — don't rely on auto-generated ones.** The OperationID becomes the **generated client's method name**; auto-IDs are derived from method+path and silently change when a path changes, breaking the client. Stable explicit IDs (`create-project`, `list-tasks`) are the key maintainability lever. Optionally override `huma.GenerateOperationID`/`GenerateSummary` to enforce a house convention.
- **Wrap `huma.Register` once** (a tiny `register(...)` helper or a group `UseModifier`) so every op gets consistent defaults (declared error responses, security, naming) and can't drift per-op. ([Operations](https://huma.rocks/features/operations/))
- **Reuse `models.*`** for input/output `Body`; one tag per feature for a clean `/docs`. Track `info.version` to the build version so the spec diffs per release.
- (Optional) the third-party [`hureg`](https://github.com/cardinalby/hureg) adds ergonomic group/registration helpers, but stdlib Huma Groups + AutoRegister cover our needs — skip the extra dep unless it proves necessary.

Net structure:
```
api/app.go                  → huma.API + security schemes + groups (composition root)
internal/feature/project/
  project_huma.go           → RegisterProject(api): input/output structs + huma ops
  project_controller.go     → shrinks; decode/encode/gate move into Huma
```

## 5. Key mapping decisions (the sharp edges)

| # | Concern | Decision |
|---|---|---|
| 5.1 | **Tenant gate** | Embedded `OrgScopedInput` + `Resolve()` (reuse `tenant.BindUserOrg`). 404 on mismatch preserved. |
| 5.2 | **JWT auth (User/Task)** | Security-scheme-driven Huma middleware; reuse existing verifiers via `humago.Unwrap`. Spec `security` becomes truthful. |
| 5.3 | **`orgensure` JIT provisioning** | Runs inside the `userJWT` auth branch (claims-only, no path param needed). |
| 5.4 | **Errors** | Use Huma's **default RFC 9457 `application/problem+json`** responses with proper HTTP status codes (user is OK with standard HTTP errors — no custom envelope). A shared `mapError(err)` maps domain errors via `errors.Is` to `huma.Error404NotFound`/`Error401Unauthorized`/`Error409Conflict`/etc. Console reads the standard shape (regenerated from the spec, §5 Phase 5). |
| 5.5 | **Success bodies** | Raw data today → Huma `Body` field. 1:1, no change to clients. |
| 5.6 | **SSE / AI streams** (`GenerateDesign`, `StreamChat`) | `huma.StreamResponse{Body: func(ctx huma.Context){ … }}`: set headers via `ctx.SetHeader`, get `ctx.BodyWriter()`, call the existing `StreamGenerateDesign(ctx, …, w, flush)`. Documented in the spec as a `text/event-stream` response. |
| 5.7 | **Progress polling** | Plain JSON Huma ops with `query:"sinceMillis"` / `query:"limit"`. Rate limiter kept as **per-operation** middleware (`Operation.Middlewares`) wrapping the existing `ProgressRateLimit` via `humago.Unwrap`. |
| 5.8 | **Wildcard `{path...}`** (design files) | humago **does** support `{path...}` with a matching `path:"path"` input tag — but OpenAPI has **no native catch-all**, so the generated spec for that param is lossy and breaks some tooling/codegen ([huma#896](https://github.com/danielgtaylor/huma/issues/896), [discussion#432](https://github.com/danielgtaylor/huma/discussions/432); the OAI-recommended workaround is a single named `{path}` param documented as `format: path`). **Preferred (clean spec): move the file path off the URL into a `?path=` query param** (or the JSON body) → fully-typed, codegen-safe. **Fallback:** keep `{path...}` and accept the spec caveat. Only 2 routes; decide in Phase 3. |
| 5.9 | **Webhook HMAC** | Model as Huma op with `RawBody []byte` input + `webhookHmac` scheme + a resolver doing HMAC/dedup; **or** keep the raw handler and hand-document. Deferred to Phase 4; either is fine — these aren't console-facing. |
| 5.10 | **Spec/docs exposure** | `huma.API` on the **root** mux so `/openapi.yaml` + `/docs` are unauthenticated. Migrated ops still enforce their own `security`. |
| 5.11 | **Static artifact** | `make openapi` dumps `api/openapi.yaml` into the repo (boot API → fetch endpoint) for review/diff + the CI drift guard (§8). |

## 6. Strangler-fig migration mechanics

Huma and legacy routes **coexist on the same `http.ServeMux`** (Huma calls `mux.Handle` under the hood). Per feature:
1. Add `*_huma.go` next to the controller: define input/output structs (reuse `models.*`), register operations, add `mapError`.
2. Delete that feature's `registerXxxRoutes` `rt.OrgScoped` calls + the manual decode/response code.
3. Replace its `tenancy_http_test.go`-style test with a `humatest` equivalent asserting same-org 200 + cross-org 404.
4. Verify the console feature still works (success identical, error shape preserved).

Un-migrated features keep running through the existing `apiMux` + `rt.OrgScoped` path until ported. No flag-day.

## 7. Task breakdown (phased)

### Phase 0 — Scaffolding (no behavior change)
- [ ] Add `github.com/danielgtaylor/huma/v2` + `adapters/humago` to `go.mod`.
- [ ] Create `huma.API` on the root mux in `api/app.go`; set title/version (from `config`)/servers; register the four security schemes (§4).
- [ ] Keep Huma's **default RFC 9457 error responses** (no override); add a `mapError` skeleton + a test pinning a sample error's HTTP status + `application/problem+json` shape (§5.4).
- [ ] Decide API structure: one `huma.API` + per-feature `huma.Group` + `AutoRegister`; set explicit-OperationID convention (§4.1).
- [ ] Confirm `/openapi.yaml`, `/openapi.json`, `/docs` serve publicly (empty spec OK).
- [ ] Add `make openapi` target → checked-in `api/openapi.yaml`.

### Phase 1 — Auth/tenancy primitives + `project` pilot (reference impl)
- [ ] Implement security-scheme-driven auth Huma middleware reusing `jwt`/`jwtassertion` (User JWT) (§5.2), with `orgensure` in the userJWT branch.
- [ ] Implement `OrgScopedInput` + `Resolve()` reusing `tenant.BindUserOrg` (§5.1).
- [ ] Flesh out shared `mapError(err) error` (`errors.Is` → `huma.Error4xx/5xx`), covering `ErrUnauthorized`, OpenChoreo status mapping, validation.
- [ ] Migrate **`project`** (5 ops) end-to-end as the template. Tag `Projects`.
- [ ] Add the route-parity + spec-drift CI guards (§8). Add a `humatest` cross-org-denial test for project.
- [ ] Manually verify console Projects flow (success + error shapes unchanged).

### Phase 2 — Migrate the console API (feature by feature)
Order by leverage/simplicity: `organization` → `config` → `board` → `component` → `requirements` → `design` (non-stream) → `task` (non-stream incl. progress polling) → `skills` → `idp` → `org-github` → `org-anthropic`. (~50 ops.)
- [ ] Per feature: input/output structs, `huma.Register`, delete legacy routes, port tenancy test, console smoke-check.
- [ ] Keep tags one-per-feature for a clean `/docs`.

### Phase 3 — Streaming + wildcard
- [ ] `design.GenerateDesign` + `requirements.StreamChat` → `huma.StreamResponse` (§5.6).
- [ ] design-files `{path...}` (§5.8): prefer moving the path to a `?path=` query param for a clean spec; else keep `{path...}` with the spec caveat.

### Phase 4 — S2S / runner / webhook surfaces
- [ ] Task-JWT ops (`verification-failed`, `skills`, `credentials/refresh`) with `taskJWT` scheme + auth resolver (§5.2).
- [ ] `internal …/effective-key` (no auth, tag `Internal`); JWKS op (no auth, tag `Discovery`).
- [ ] GitHub webhook (§5.9) — Huma `RawBody` op or hand-documented raw handler.
- [ ] `connect/callback` with `connectState` scheme.

### Phase 5 — Make it load-bearing + cleanup
- [ ] Generate the **console TS client/types** from `api/openapi.yaml` (e.g. `openapi-typescript`/`orval`) and adopt in at least one console feature so a wrong spec breaks the build (drift backstop). Console already ships `swagger-ui-react` + `@asdlc/openapi-view` — point them at `/openapi.yaml`.
- [ ] Remove now-dead `utils.WriteSuccessResponse/WriteErrorResponse` + `Router.OrgScoped` once all org-scoped routes are Huma resolvers (keep `Public` for any remaining raw handlers).
- [ ] Update `docs/design/api-service.md` (router section) + `CLAUDE.md` (mention `make openapi` + the drift guard).

## 8. Drift guards (CI) — non-negotiable for code-first

The single mitigation every source agrees on: code-first is fine **iff** CI catches drift. Three layers, cheap → thorough:
1. **Spec freshness:** CI runs `make openapi` and `git diff --exit-code api/openapi.yaml` — fails if the checked-in spec is stale.
2. **Route parity (replaces `gate_invariant_test.go`'s spirit):** a Go test enumerates registered `ServeMux` patterns and asserts each appears in the spec and vice-versa — catches "added a route, forgot to register the op." Re-express the **tenancy invariant** here too: assert every operation under `/api/v1/organizations/{orgHandle}/…` has an input that embeds `OrgScopedInput` (the new allowlist-by-construction lock).
3. **Contract validation (optional, strongest):** in the API test suite, validate sample requests/responses against the spec with `kin-openapi` (`getkin/kin-openapi`, the lib `oapi-codegen` builds on) so schema drift fails CI.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Console error parsing changes (RFC 9457) | One-time: regenerate the console client from the spec (Phase 5) so it reads the standard `problem+json` shape; update any hand-written error handling. |
| Tenancy IDOR fence weakened during migration | `OrgScopedInput` resolver + the Phase-1 parity test asserting the embed; `humatest` cross-org-denial test per feature (port the existing template). |
| `{path...}` / webhook don't fit Huma cleanly | Both have a "keep raw handler + hand-document" fallback (§5.8/5.9); neither is console-facing or a blocker. |
| Mixed Huma/legacy confusion mid-migration | Strangler is per-feature and reversible; each PR migrates one package and is independently shippable. |
| Huma learning curve | Phase-1 `project` pilot is the worked reference; everything else copies it. |

## 10. Open questions (resolve during Phase 0/1)
- **RESOLVED — errors:** adopt Huma's default RFC 9457 `problem+json` now; console regenerated from the spec (§5.4).
- **RESOLVED — `{path...}`:** humago supports it but the spec is lossy; prefer moving the path to a `?path=` query param. Final call in Phase 3 (§5.8).
- One `huma.API` with per-feature `huma.Group`s (§4.1) is the plan. Open: do the S2S/runner ops share the same `/docs`, or do we tag/group them separately (e.g. `Internal`, `Runner`) for a cleaner console-facing view? Leaning: same API, distinct tags.

---

### Appendix — sources consulted
- Huma: [repo/README](https://github.com/danielgtaylor/huma) · [OpenAPI generation](https://huma.rocks/features/openapi-generation/) · [request inputs](https://huma.rocks/features/request-inputs/) · [middleware](https://huma.rocks/features/middleware/) · [streaming/SSE](https://huma.rocks/features/response-streaming/) · [resolvers/custom validation](https://huma.rocks/how-to/custom-validation/)
- Code-first vs design-first / drift: [OpenAPI best practices](https://learn.openapis.org/best-practices.html) · [Swagger: code-first vs design-first](https://swagger.io/blog/code-first-vs-design-first-api/) · [Sookocheff: the false dichotomy](https://sookocheff.com/post/api/the-false-dichotomoy-of-design-first-and-code-first-api-development/) · [appliedgo: 4 tools](https://appliedgo.net/spotlight/4-tools-for-generating-rest-apis/)
