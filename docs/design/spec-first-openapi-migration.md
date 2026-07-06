# Spec-first public API: Huma → oapi-codegen migration

**Status: DESIGN (approved direction, pre-implementation)** · 2026-07-05

aep-api flips from code-first (Huma v2 renders `packages/contracts/api/v1/openapi.yaml`
from Go registrations) to **spec-first**: the committed `openapi.yaml` becomes the
hand-maintained source of truth for the public API; `oapi-codegen` generates the Go
server layer; Huma is removed entirely. Internal/S2S/dev endpoints get **no OpenAPI**
— they become plain `net/http`.

Supersedes the runtime direction of `bff-openapi-huma-migration.md` (the Huma adoption
doc); the surface split described in `bff-api-surface-separation.md` is unchanged.

## 0. Locked decisions

| # | Decision | Why |
|---|---|---|
| D1 | Bootstrap the hand-authored spec **verbatim from the current committed** `packages/contracts/api/v1/openapi.yaml` — all 59 ops, including the 11 deprecated-tag ops. Only the mandatory transforms in §8. | Zero contract churn on day one; deprecated-op removal is a later, separate contract change. |
| D2 | Error contract is pinned by the **new console** (`apps/console`): it types errors as `components["schemas"]["ErrorModel"]` and reads `error.detail ?? error.title`. The RFC-9457 problem **shape** (`title`/`status`/`detail`[/`errors`]) is preserved on every error path. Legacy console may break. | apps/console cannot change. (Schema-validation **status codes** move under D7 — the integration suite's 422-not-400 assertions are re-pointed, not preserved; see §6.) |
| D3 | **Single** `openapi.yaml`. No multi-file split, no bundler. | Simplest pipeline; both generators consume the file directly. |
| D4 | Migration is **spike-first → one big-bang PR** (no dual-stack period). Spikes S0–S9 in §12 retire every "unsure until you try" risk before the flip. | The branch is a rewrite; component tests + fresh-cluster e2e gate the flip. |
| D5 | Generator: **oapi-codegen v2.7.1**, `std-http-server` + `strict-server`, OpenAPI **3.0.3** (oapi-codegen is 3.0-only — verified upstream). | Fits the existing `net/http` ServeMux stack; strict mode gives compile-time spec↔handler drift detection. |
| D6 | The service **serves no spec at runtime**: `GET /openapi.yaml` and `GET /docs` (Stoplight) are deleted with no successor. | Spec is spec-first and committed at `packages/contracts/api/v1/openapi.yaml`; consumers read it from the repo. No runtime consumer exists — removes the embed-serving invariant (was I13) and `docs.go`. |
| D7 | **Types-only: no runtime request validator.** Generated strict-server code does type-binding + required-*param* checks; no kin-openapi / `nethttp-middleware`. `enum`/`min`/`max`/`minLength`/`pattern`/required-*body* are **not** enforced at the edge — the service layer owns domain validation as it already must. Type-mismatched bodies → 400; body caps → 413. `openapi.yaml` is a **build-time codegen input only** — nothing is read at runtime (no `embed.go`, no `ParseSpec`). | Simplicity: no runtime spec parse, no double routing, no in-binary spec. Verified upstream — strict-server does binding only ([oapi-codegen #2053](https://github.com/oapi-codegen/oapi-codegen/discussions/2053), [#227](https://github.com/deepmap/oapi-codegen/issues/227)); keeping 422 without a runtime spec would need hand-duplicated `x-oapi-codegen-extra-tags` (drift) or an ogen swap (reopens D5). Cost: I4 weakens to type-binding; the 23 former-422 assertions are re-pointed (§6, S2). |

## 1. The invariant ledger

Every safety/wire property Huma enforces today gets a **named replacement and a named
proving test**. This table is the flip PR's acceptance checklist; a row without a green
proving test blocks the flip.

| # | Invariant (today: Huma) | Replacement | Proving test |
|---|---|---|---|
| I1 | Org bound **solely** from verified JWT; cross-org requests unrepresentable (`humakit.OrgScopedInput` resolver + `huma_guard_test.go` tag scan) | `orgGate` StrictMiddlewareFunc, default-DENY with explicit carve-outs (§5) | `specguard_test.go`: spec declares no `org*` params anywhere; carve-out exactness + full partition print; componenttest cross-org smoke |
| I2 | ENFORCE→401 / LOG→passthrough / unstamped-defaults-ENFORCE gate modes | `bindOrg` reads `tenant.GateModeFromContext` verbatim | `orggate_test.go` (ports the 3 `humakit_test.go` cases to httptest) |
| I3 | Handler can never silently run un-gated (fail-closed: forgot marker → empty org → empty queries) | `tenant.RequireOrg(ctx)`: errors when the gate **never ran** (marker absent); returns `""` only in LOG mode (§5) | `orggate_test.go` marker-absent case; componenttest ENFORCE 401 smoke |
| I4 | Request *shape* rejected before handlers (Huma: 422 on any schema violation) | **Weakened by D7**: generated type-binding → 400 on type mismatch + required-*param* checks; `enum`/range/`pattern`/required-*body* enforced in handlers where they matter, not at the edge (§6) | S2 binding+limits matrix; the 23 former-422 assertions re-pointed per §6 (some→handler 422, some→400, some dropped) |
| I5 | `ErrorModel` problem+json shape (`title`/`status`/`detail`[/`errors`]) on every error path | `apierr` package: single `WriteProblem` writer + strict-handler error funcs (§4) | component tests (all error assertions); `spec_test.go` pins the `ErrorModel` schema shape |
| I6 | 4 bespoke error bodies consumed by FE (`plan_in_progress`, `turn_in_progress`, `conflicts`, 413) | Promoted to first-class typed spec responses (§8.9); produced by typed response objects / SSE pre-stream writers | component tests byte-pin them; spec review |
| I7 | Request body caps: 10 MiB on create-turn & apply-files, **1 MiB Huma default everywhere else** | `withBodyLimits` middleware: `http.MaxBytesReader`, 1 MiB default / 10 MiB carve-ups; 413 problem via `apierr` (§6) | S2 spike 413 case + a default-cap component test |
| I8 | Spec ↔ handlers completeness (`huma_registration_test.go`) | Compile: `var _ apigen.StrictServerInterface = (*Server)(nil)`; runtime: mount-completeness 404 sweep; **set-equality both directions** (§10) | `server.go` assertion; `specguard_test.go` |
| I9 | Spec ↔ code drift (`make openapi-check`, code→spec) | Direction flips: `make gen-api-check` (spec→code, regenerate + `git diff --exit-code`) | make target (clone of `gen-oc-client-check`) |
| I10 | SSE semantics: verbatim frame passthrough, flush-per-chunk, missing-`[DONE]`-means-truncation, ctx-cancel propagation, `Cache-Control: no-cache` + `X-Accel-Buffering: no` headers | Hand-mounted raw handlers, line-for-line port of the `StreamResponse` bodies (§7) | S4/S5 spikes with **mid-stream evidence**; fresh-cluster e2e |
| I11 | Internal S2S auth (Task-JWT INT-6 fence / publisher-cc) with runner wire-compat bodies | Plain handlers calling `RunnerAuthorizer.Authorize` explicitly; constructor injection (§11) | httptest status matrix + byte-golden bodies; runner smoke |
| I12 | Webhook/callback routes excluded from spec and not shadowed by the API router | Stay raw on the outer mux; spec asserts their absence | `specguard_test.go` shadow check (webhook path routes to raw handler, absent from spec) |
| I13 | Generated code stays generated | `TestApigenIsGeneratedOnly`: apigen dir may contain only `*.gen.go`, the 2 configs, `openapi.yaml` (codegen input) | arch test |
| I14 | apigen is a leaf (imports nothing module-internal) | new arch guard mirroring `TestContractsIsLeaf` | arch test |
| I15 | Spec stays 3.0/codegen-safe | vacuum lint + greps rejecting `openapi: 3.1` / `type: [` in `make gen-api`; pinned x-go-type exception set (only `get-conversation`) | make target + `spec_test.go` |

## 2. Package layout

```
services/aep-api/
  internal/api/apigen/                 # NEW — generated wire contract (leaf, package apigen)
    oapi-codegen-types.yaml            #   generate: models → types.gen.go
    oapi-codegen-server.yaml           #   std-http-server + strict-server, models:false,
                                       #   exclude-operation-ids: [create-turn, plan-tasks] → server.gen.go
    openapi.yaml                       #   vendored byte-copy of packages/contracts/api/v1/openapi.yaml —
                                       #   BUILD-TIME codegen input only, NOT read at runtime (vendor+sync
                                       #    pattern already exists: designspec mirrors component-design.schema.json)
  internal/api/                        # KEPT — the HTTP composition root
    surfaces.go                        #   same role; Huma mount block swapped for generated wiring
    server.go                          #   NEW: Server embedding + var _ StrictServerInterface assertion
    deps.go                            #   NEW: type Deps (ex-HumaDeps, fields verbatim)
    orggate.go                         #   NEW: tenant gate (§5)
    bodylimit.go                       #   NEW: MaxBytesReader middleware (§6)
    sse_routes.go                      #   NEW: hand-mounted SSE registration (§7)
    internal.go                        #   REWRITTEN: plain net/http S2S (§11)
    app.go, dev.go, handler_fortest.go, webhook_routes.go, org_github_routes.go  # survive ~verbatim
  internal/platform/apierr/            # NEW — service-tier error contract + problem writer (§4)
  internal/platform/tenant/            # gains WithOrg / OrgFromContext / RequireOrg
  internal/platform/httpkit/           # gains APIV1 = "/api/v1" (moved from humakit)
  internal/platform/humakit/           # DELETED
  cmd/openapigen/                      # DELETED
```

Placement rationale: generated code must live under `internal/` (`TestInternalOnlyLayout`).
`internal/api/apigen` mirrors the repo's existing precedent — client-side generation
lives next to the client (`internal/clients/openchoreo/gen/`), server-side generation
next to the edge. Directory named `apigen` so the package name matches the import path.
It is *not* auto-policed like `platform/*`, so I14 adds an explicit leaf lock, and I13
keeps hand-written code out of a directory that regeneration overwrites. Dependency
direction stays legible: `apigen ← feature ← api`.

`HumaDeps` → `api.Deps` (fields verbatim — one-identifier diff for `internal/app` and
all 13 component-test files). `NewHandlerForTest` keeps its exact signature.

## 3. Handler organization (57 strict methods across 12 feature packages)

Per-feature handler-group structs, embedded into one `api.Server`. Each `*_http.go`
replaces the feature's `*_huma.go` in the same package — same responsibility slot,
same service deps; bulky DTO mapping goes in a sibling `*_wire.go`.

```go
// internal/feature/project/project_http.go
type ProjectHTTP struct{ svc ProjectService }

func (h ProjectHTTP) ListProjects(ctx context.Context, req apigen.ListProjectsRequestObject) (apigen.ListProjectsResponseObject, error) {
    org, err := tenant.RequireOrg(ctx)              // fail-loud if the gate never ran (I3)
    if err != nil { return nil, err }
    list, err := h.svc.ListProjects(ctx, org, 100, deref(req.Params.Cursor))
    if err != nil { return nil, mapProjectError(err) } // now returns *apierr.Error
    return apigen.ListProjects200JSONResponse(toWireProjectList(list)), nil
}
```

Type names are feature-prefixed (`ProjectHTTP`, `TaskHTTP`, …) because Go embedding
uses the unqualified type name as the field name — twelve packages all exporting
`Handlers` cannot be embedded together.

```go
// internal/api/server.go — successor of RegisterAllHuma: still ONE canonical list
type Server struct {
    project.ProjectHTTP
    organization.OrganizationHTTP
    component.ComponentHTTP
    component.ConfigHTTP
    requirements.RequirementsHTTP
    requirements.CollabHTTP
    design.DesignHTTP
    task.TaskHTTP           // JSON ops; plan-tasks excluded (SSE)
    execution.ProgressHTTP
    idp.IDPHTTP
    orgcreds.OrgGitHubHTTP
    orgcreds.AnthropicHTTP
    skills.SkillHTTP
    files.FilesHTTP
    genai.GenAIHTTP         // get-conversation; create-turn excluded (SSE)
}

// THE drift check: a spec op without a handler names the missing method at compile time.
var _ apigen.StrictServerInterface = (*Server)(nil)

func NewServer(d Deps) *Server { … }
```

Adding an endpoint end-to-end: edit the spec → `make gen` (build breaks naming the
missing method) → implement one method in one feature package. No shared file touched
unless it's a new feature (one embed line in `server.go`).

## 4. Error architecture (`internal/platform/apierr`)

Replaces `huma.StatusError` + `huma.ErrorNNN` + `humakit.ErrorFromStatus` (~23
production files + 14 test files import huma for these — the widest blast radius,
defused **pre-flip**, see §12 Phase 0).

```go
// apierr/errors.go — the service/feature-tier error contract
type Error struct { Status int; Detail string; Errors []ErrorDetail }
func New(status int, detail string) *Error
func BadRequest/Unauthorized/Forbidden/NotFound/Conflict/Unprocessable/Internal/BadGateway/Unavailable(...)
func FromStatus(status int, msg string) *Error   // humakit.ErrorFromStatus successor, same table

// apierr/problem.go — the single RFC-9457 writer (console pin: title/status/detail[/errors])
type Problem struct{ Title string; Status int; Detail string `json:",omitempty"`; Errors []ErrorDetail `json:",omitempty"` }
func WriteProblem(w http.ResponseWriter, status int, detail string, errs ...ErrorDetail)

// apierr/handlers.go — strict-server override points (defaults leak err.Error() plain-text; ALWAYS overridden)
func RequestError(w, r, err)   // bind failures → 400 problem
func ResponseError(w, r, err)  // errors.As(*apierr.Error) → WriteProblem; else 500 problem + slog
```

- Handler flow keeps its shape: `return nil, mapProjectError(err)`; per-feature
  `mapXError` funcs survive, swapping `huma.Error404NotFound(…)` → `apierr.NotFound(…)`.
- Wired via `NewStrictHandlerWithOptions(srv, mw, StrictHTTPServerOptions{RequestErrorHandlerFunc: apierr.RequestError, ResponseErrorHandlerFunc: apierr.ResponseError})`.
- Bespoke bodies (I6): apply-files 409 becomes typed `ApplyFiles409JSONResponse{Conflicts: …}`;
  the `{"code": …}` 409s + 413 live on the raw SSE handlers, written byte-identically pre-headers.
- Honest contract note (D7): schema-level validation moves off the edge, so some inputs
  Huma answered with a **422** now either bind-fail as a **400** (type mismatch) or reach
  the handler (`enum`/range/required-body). The problem **shape** (`title`/`status`/
  `detail`[/`errors`]) is unchanged and the console reads `detail ?? title`, so error
  *rendering* is unaffected — only the status and enforcement point move. The former-422
  component assertions are re-pointed deliberately (enumerated by spike S2, applied in C10).

## 5. Tenant gate (IDOR fence)

A `StrictMiddlewareFunc` keyed by operationID, **default-DENY with explicit
carve-outs**, plus a fail-loud context accessor.

```go
// internal/platform/tenant/org.go
func WithOrg(ctx, org string) context.Context     // stamps a "gate ran" marker + the org (org may be "" in LOG)
func OrgFromContext(ctx) string                    // "" when absent — legacy-compatible reads
func RequireOrg(ctx) (string, error)               // marker absent → apierr 401 "gate not applied" (I3);
                                                   // marker present → org ("" only in LOG passthrough)

// internal/api/orggate.go
// Carve-outs: ops that today do NOT embed OrgScopedInput. Enumerated MECHANICALLY at
// flip time by scanning every input struct in the *_huma.go files (do NOT trust
// comments: surfaces.go claims "idp discover" is a carve-out but discoverInput embeds
// OrgScopedInput — idp discovery IS gated). Keys are the TITLE-CASED Go operationIDs
// that StrictMiddlewareFunc actually receives (verified: generated code passes
// "StreamTurn" for operationId stream-turn) — pinned empirically in spike S3.
// Values are the rationale, printed by the partition test.
var orgGateCarveOuts = map[string]string{
    "ListOrganizations": "pre-org-selection: lists the orgs the token may enter",
    // + whatever the mechanical enumeration yields (S3) — nothing else expected
}

func orgGate() apigen.StrictMiddlewareFunc {
    return func(f apigen.StrictHandlerFunc, operationID string) apigen.StrictHandlerFunc {
        if _, exempt := orgGateCarveOuts[operationID]; exempt { return f }
        return func(ctx context.Context, w http.ResponseWriter, r *http.Request, req any) (any, error) {
            ctx, err := bindOrg(ctx) // OrgScopedInput.Resolve verbatim: token org via
            if err != nil { return nil, err } // auth.ResolveOuHandle(auth.ClaimsFromContext);
            return f(ctx, w, r, req)          // "" + ENFORCE → apierr.Unauthorized; "" + LOG → warn, stamp ""
        }
    }
}
```

- ENFORCE/LOG/unstamped-defaults-ENFORCE preserved bit-for-bit; `stampGateMode` in
  surfaces.go is untouched.
- **Fail-closed twice over**: the map enumerates carve-outs, so a new op is gated by
  default (forgotten entry → 401 in its first test, never a silent un-gated op); and a
  handler on an op the gate somehow missed gets an error from `RequireOrg`, not an
  empty-string org it might misuse.
- Raw SSE routes get the same gate via `requireOrg(next http.Handler)` built on the
  same `bindOrg` core — one implementation, two adapters.
- Arch-lock re-expression (`specguard_test.go`, replacing `huma_guard_test.go`):
  1. Parse the committed spec: **no** operation may declare a path/query/header param
     or requestBody property named `orgHandle|org|orgId|organization`.
  2. Carve-out exactness: every key corresponds to a spec operationId (title-cased
     mapping asserted); the test prints the full gated/carved partition of all ops.
  3. Componenttest smokes (ENFORCE 401 bare / authed 200 / cross-org 404) stay as the
     behavioral pin through `NewHandlerForTest`.

## 6. Request handling: binding + body limits

**No runtime request validator** (D7). Generated strict-server code does type-binding +
required-*parameter* checks; no OpenAPI document is loaded at runtime. The edge keeps
exactly the enforcement codegen gives for free, plus body-size caps; everything beyond
field *type* is the service layer's job — as it already must be, since services never
trusted edge validation for domain rules.

```go
apiHandler := withBodyLimits(strictHandler)   // strictHandler = NewStrictHandlerWithOptions(...)
mux.Handle("/api/", jwt(ensureOrg(stampGateMode(apiHandler))))
```

- **What the edge enforces**: JSON that mismatches a generated field *type* fails binding
  → `apierr.RequestError` → **400** problem (I4); required path/query/header *params* are
  checked by generated code. That is the whole shape gate.
- **What the edge no longer enforces** (was Huma, now handler/service-owned — D7):
  `enum` membership, `minimum`/`maximum`, `minLength`/`maxLength`/`pattern`, and
  required-*body*-field presence (a missing body field binds to its zero value). Handlers
  validate these where they matter, returning `apierr.Unprocessable` (422) or
  `apierr.BadRequest` (400) in the same problem shape. Spike S2 enumerates each of the 23
  former-Huma-422 cases and where it lands now (handler 422 / 400 bind error / dropped
  because no consumer relied on it); the re-pointing is applied in C10.
- **Body limits** (I7): a single `withBodyLimits` middleware — `http.MaxBytesReader`,
  1 MiB default / 10 MiB on create-turn + apply-files; `MaxBytesError` → **413** problem
  via `apierr`, in one place. This is the only body-buffering bound and needs no spec.
- **Routing**: generated routes register with BaseURL `/api/v1` on `apiMux` — **one**
  router, no gorillamux, no double-routing (that whole class of validator/server-path
  matching friction disappears with the validator).
- Response shape stays gated by goldens + component tests, as before.

## 7. SSE ops (create-turn, plan-tasks): exclude + raw

`exclude-operation-ids: [create-turn, plan-tasks]`; hand-mount raw `net/http` handlers;
**both ops stay fully modeled in the spec** (they finally gain honest
`text/event-stream` 200s + their bespoke 409/413 responses).

Why not strict streaming (it does work since v2.7.0 — verified with a local demo):
strict handlers cannot set response headers, and today's handlers **do** —
`Cache-Control: no-cache` and `X-Accel-Buffering: no` (genai_huma.go:111-113,
task_huma.go:96-98) — dropping them regresses SSE behind buffering ingress. Plan-tasks
is additionally a mid-flight *tap* (writes into an `io.Writer` with flush callbacks),
which under strict mode needs an `io.Pipe` bridge + a customized
`ResponseErrorHandlerFunc` to avoid mid-stream corruption. That is novel machinery on
the two hardest-to-verify endpoints (streaming must be verified from mid-stream
evidence on a fresh cluster). The raw port is a line-for-line translation of the
existing `StreamResponse` bodies — every hard-won semantic survives untouched (I10),
and pre-stream errors (`{"code":"turn_in_progress"}` 409, 413) are written exactly as
now. Exclude+raw also matches the existing house pattern (webhook/callback are already
raw routes coexisting with the API). Revisit strict streaming later only if the raw
handlers chafe.

Wiring (`internal/api/sse_routes.go`): `genai.RegisterTurnRoute(apiMux, d.GenAISvc,
requireOrg, maxBytes(10<<20))` + `task.RegisterPlanRoute(apiMux, d.TaskPlan,
requireOrg)` — inside the `/api/` chain (jwt/ensureOrg/gateMode apply), gated by the
shared `requireOrg` adapter (no validator to skip past). Guarded by I8's set-equality:
spec opIds == strict methods ∪ pinned raw-op list `{CreateTurn, PlanTasks}` — the
exclusion list cannot silently grow, and the mount sweep proves the routes resolve.

## 8. Spec transforms (exact, exhaustive — everything else byte-identical)

Applied once to the committed yaml by a one-shot script + hand review; `oasdiff` runs
as the audit — its changelog must contain exactly these items, nothing else:

1. `openapi: 3.1.0` → `3.0.3`.
2. 31 × `type: [T, "null"]` → `type: T` + `nullable: true` (openapi-typescript still emits `| null`).
3. 43 × `examples: [...]` → single `example:`.
4. Strip the 38 injected `$schema` properties (Huma artifact; goldens already strip it).
5. Multipart file schema → `type: string, format: binary`.
6. **read-file redesign** (the `{path...}` wildcard is invalid OpenAPI): re-model as
   `GET /projects/{projectName}/files/content?path=<url-encoded>` (required query
   param), fully in-spec and strict-generated. Console-visible change is allowed:
   apps/console has no files usage; legacy console may break (D2). Query-param beats
   encoded-slash path segments (Go 1.22 mux `%2F` traps) and beats off-spec raw
   (keeps the op compiler-checked + validated).
7. **get-conversation**: `schema: {}` → `type: object` + explicit
   `additionalProperties: true` + inline `x-go-type: encoding/json.RawMessage` so the
   handler stays a verbatim byte passthrough (re-marshaling `any` would silently
   transform agents-service bytes). This is the **only** x-go-type in the spec (I15).
8. **SSE modeling**: create-turn + plan-tasks empty 200s → `text/event-stream` string content.
9. **Bespoke error responses promoted to first-class**: apply-files `409 {conflicts:[…]}`;
   create-turn `409 {code}` + `413 ErrorModel`; plan-tasks `409 {code}` — byte-for-byte
   as the FE consumes them today.
10. Explicit `additionalProperties: true` on the free-form map bodies (skills
    list/updates/sync/delete, github status, idp profile-or-null) — oapi-codegen
    ignores implicit true; these deliberately stay free-form (real schemas would be a
    contract change, not a migration).

**Not transformed**: operationIds stay kebab-case (title-case cleanly);
`*InputBody`/`*OutputBody` schema names stay; `Project`, `CreateProjectRequest`,
`ProjectList`, `ErrorModel` keep their exact names (apps/console pins them); tags,
descriptions, `servers: [/api/v1]`, per-op `security`, `deprecated` flags — all
byte-identical.

## 9. DTO strategy

**Generated types are the wire DTOs; explicit mapping at handlers.** No `x-go-type`
reuse of `models`/feature types (except §8.7): reusing them would reintroduce exactly
the unchecked spec↔Go drift that spec-first exists to prevent. Since the bootstrap
spec was generated *from* the models, the generated structs are near-field-identical —
the mapping layer (`toWireX` funcs in per-feature `*_wire.go`) is mechanical and
reviewable. `models` stays the service-tier vocabulary; zero service-layer change.

Marshal fidelity: goldens pin field SETS; spike S0 byte-diffs generated-type field sets
against the `models` types they replace. Per-field escape hatches (`x-omitempty`,
`x-go-name`) only on demonstrated drift — no blanket pointer-behavior flags.

## 10. Toolchain / pipeline

- **Pinning**: reuse the Makefile variable pattern —
  `OAPI_CODEGEN ?= go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.7.1`
  — and bump the OC-client invocation to the same version in the same commit. (The Go
  1.24 tool-directive form is a fine later refinement; not now — it changes two
  pipelines at once.)
- **services/aep-api/Makefile**:
  ```make
  gen-api:            ## spec → Go (replaces openapi: code → spec)
      cp ../../packages/contracts/api/v1/openapi.yaml internal/api/apigen/openapi.yaml
      $(OAPI_CODEGEN) -config internal/api/apigen/oapi-codegen-types.yaml  internal/api/apigen/openapi.yaml
      $(OAPI_CODEGEN) -config internal/api/apigen/oapi-codegen-server.yaml internal/api/apigen/openapi.yaml
      gofmt -w internal/api/apigen
  gen-api-check: gen-api    ## exact clone of gen-oc-client-check
      git diff --exit-code -- 'internal/api/apigen/*' || (echo "run make gen-api"; exit 1)
  ```
  `openapi:`/`openapi-check:` targets and `cmd/openapigen` die.
- **Root Makefile**: the openapi-export line becomes `$(MAKE) -C services/aep-api gen-api`
  — spec edits regenerate Go before build; turbo already feeds the same spec to
  apps/console `gen`.
- **Spec lint**: `vacuum` (Go-native, keeps Node out of the Go path) inside `gen-api`,
  plus greps rejecting `openapi: 3.1` and `type:\s*\[` (I15).
- **oasdiff**: one-shot as the §8 transform audit; standing breaking-change gate
  deferred until CI exists on this branch (documented as the first CI addition).
- **License**: root `LICENSE_FILES` already excludes `\.gen\.go$`; the vendored
  `openapi.yaml` is data (a codegen input), not source — no header needed.

## 11. Internal S2S surface (2 runner endpoints → plain net/http)

- `RegisterAllInternal(mux *http.ServeMux, d InternalDeps)` registers directly on the
  outer mux (the separate `internalMux` double-mount existed only to host the second
  Huma API — deleted):
  `GET /internal/v1/executions/{executionId}/skills` and
  `POST /internal/v1/tasks/{taskId}/credentials/refresh`, handlers in their feature
  packages (`execution/skills_s2s.go`, `orgcreds/credentials_internal_http.go`),
  `r.PathValue(…)`, `authz.Authorize(ctx, r.Header.Get("Authorization"), id)` at the
  top, bodies serialized byte-identically to today (runner wire-compat, I11).
- `RunnerAuthorizer.Authorize` returns `*apierr.Error` instead of `huma.Error*`;
  dual-token logic untouched.
- **Global seam dissolved**: `RunnerScopedInput`, `ExecutionScopedInput`,
  `SecurityRunner`, the package-global `runnerAuthorizer` + `SetRunnerAuthorizer`
  (which existed only because Huma builds inputs from zero values) are deleted; the
  authorizer is constructor-injected via `InternalDeps` — real DI.
- `GenerateInternalOpenAPIYAML` + `build/internal-openapi.yaml`: deleted (zero
  consumers, verified). No internal spec, per the locked premise. Fix the stale
  surfaces.go comments (internal-spec path; "idp discover" carve-out claim).

## 12. Migration plan

### Phase 0 — pre-flip, lands under live Huma (each commit green)

- **P0.1 `apierr` adoption**: land `internal/platform/apierr`; convert all ~23
  `mapXError`/service files + 14 test files from `huma.StatusError` to `*apierr.Error`
  behind a one-line temporary shim (`humaError(p *apierr.Error) error` wrapping into a
  Huma status error at the `*_huma.go` call sites). The widest blast radius is defused
  and independently verified while the wire is unchanged; the flip later deletes one
  shim instead of touching 23 files mid-swap.
- **P0.2 internal S2S port** (§11): the internal surface has zero spec consumers and
  its own tests — port it to plain net/http and delete its Huma API ahead of the flip.

### Spike phase (throwaway branch; explicit pass criteria; nothing merges until proven)

- **S0 generation round-trip**: §8 transforms scripted; both configs run; clean build;
  57 strict methods; console-pinned schema names generate under those names;
  field-set marshal diff generated-vs-models == empty.
- **S1 vertical slice: `project`** (5 ops covering query/cursor, 201, in-handler 400 /
  handler-422, 404 problem, 204; org-gated; THE feature apps/console consumes; has a
  component test). Full plumbing built once (spike-scoped `include-tags` so the interface
  is 5 methods). *Pass*: `project_component_test.go` green (modulo the §6 re-pointed
  binding/status assertions, enumerated in S2); ENFORCE/authed smokes green; curl parity
  vs the Huma build for all 5 ops (status + body field-set diff empty modulo enumerated
  detail/status deltas).
- **S2 binding + limits matrix** (D7, no validator): type-mismatched body → **400**
  problem via `RequestErrorHandlerFunc`; missing required body field → binds to zero
  value (enumerate which of the 23 former-422 cases this is, and where each now lands —
  handler 422, 400, or intentionally dropped); 10 MiB+1 → **413**; 1 MiB default cap on
  an ordinary op; unknown query param ignored. Output: the re-pointing table applied in C10.
- **S3 tenant gate**: three humakit gate cases replicated; **pin the exact title-cased
  operationID strings** StrictMiddlewareFunc receives; mechanical carve-out enumeration
  from `*_huma.go` input structs (expected ≈ `{ListOrganizations}`; explicitly verify
  ValidateCollabAccess and DiscoverIdp embed the gate today); specguard prototype green.
- **S4 create-turn raw port**: mid-stream incremental delivery evidence; upstream kill
  → truncation without `[DONE]`; client disconnect cancels upstream (agents-svc log);
  409 body byte-identical; 413 pre-stream; `Cache-Control`/`X-Accel-Buffering` headers present.
- **S5 plan-tasks tap port**: same + the mid-stream tap still persists.
- **S6 multipart import-skill (decision gate)**: strict `*multipart.Reader` handler with
  LimitReader cap; skills component test + curl upload green. Pre-approved fallback if
  #1782 friction breaks the contract: exclude+raw, same pattern as SSE — decided here,
  not mid-flip.
- **S7 read-file redesign**: `/files/content?path=` end-to-end; traversal validation
  preserved; files component tests updated to the new URL.
- **S8 internal port verification** (P0.2): httptest matrix + byte-goldens + runner smoke.
- **S9 console codegen**: `pnpm gen` + `tsc` on apps/console; `aep-api.d.ts` diff
  reviewed — only §8 deltas.

### Big-bang flip (one PR; additive commits C1–C8, one atomic swap C9)

- **C1** transformed spec + vacuum config + oasdiff audit + apps/console regen.
- **C2** apigen package (full configs, generated output, vendored spec) +
  `gen-api`/`gen-api-check` + root Makefile rewire + OAPI_CODEGEN bump.
- **C3** platform scaffolding: `tenant.WithOrg/RequireOrg`, `httpkit.APIV1`,
  `orggate.go`, `bodylimit.go` (additive, unused).
- **C4–C7** feature ports, grouped: `*_http.go`/`*_wire.go` + SSE registration funcs
  land additively; old `*_huma.go` stays wired so every commit compiles and tests green.
- **C8** wiring prep: `server.go`, `deps.go`, `sse_routes.go` (compiled, unmounted).
- **C9 THE FLIP** (single atomic, revertible commit): surfaces.go swaps the Huma mount
  for `NewServer` + strict handler + body-limit middleware + SSE mounts; `HumaDeps`→`Deps`; delete
  all 16 `*_huma.go`, `huma.go`, `huma_register.go`, `humakit/`, `cmd/openapigen/`,
  the P0.1 shim; `go mod tidy` (huma gone).
- **C10** test migration: `specguard_test.go`, `orggate_test.go`, `spec_test.go` in;
  `huma_guard_test.go`, `huma_registration_test.go`, `internal_test.go`,
  `humakit_test.go`, `project_huma_test.go` out; component-test updates: the S2
  re-pointing table (former-422 → handler-422 / 400 / dropped), detail-string, and
  files-URL changes; doc sweep (`packages/contracts` package.json + AGENTS.md now say
  hand-authored source of truth; componenttest package doc).
- **Verify**: `make build test lint typecheck license-check`; full fresh-cluster e2e
  per the e2e discipline (teardown → setup → console flows incl. mid-stream streaming
  evidence for both SSE ops, skills import, files read/apply, runner skills-pull +
  creds-refresh). Post-ship: `design/` note + ADR per repo policy.

### Deletion inventory

| Item | Fate |
|---|---|
| `cmd/openapigen/` | delete |
| `internal/api/huma.go` | delete (public `/openapi.yaml` + `/docs` serving dropped, D6 — no successor) |
| `internal/api/huma_register.go` | → `deps.go` + `server.go` |
| `huma_guard_test.go`, `huma_registration_test.go`, `internal_test.go` | → `specguard_test.go` + internal handler tests |
| `internal/api/internal.go` Huma parts + `internalMux` double-mount | rewrite plain (P0.2) |
| 16 × `internal/feature/**/*_huma.go` | → `*_http.go` ports |
| `internal/platform/humakit/` (+ tests) | delete; APIV1→httpkit, ErrorFromStatus→apierr, Resolve→orggate |
| `auth/runner.go` resolver structs + `SetRunnerAuthorizer` global | delete (constructor injection) |
| `build/internal-openapi.yaml` + `openapi`/`openapi-check` targets | delete/rewire |
| `go.mod`: `github.com/danielgtaylor/huma/v2` | remove |
| console-legacy `gen:api` script | delete (dead output) |

### go.mod delta

Out: `github.com/danielgtaylor/huma/v2` (and kin-openapi as a transitive). In:
`github.com/oapi-codegen/runtime` **only** (the generated strict-server depends on it).
No `nethttp-middleware` / `getkin/kin-openapi` — the runtime validator is gone (D7).
Generator pinned via Makefile `go run …@v2.7.1`, not a module dep.
