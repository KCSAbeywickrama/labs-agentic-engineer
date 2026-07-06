# Active-org: token-derived — implementation plan

**Status:** 🏗️ In progress. Companion to `active-org-path-vs-token.md` (analysis) and `active-org-token-derivation-blockers.md` (design blockers).

Two changes, landed in order. **Change 1 (Anthropic key inversion) ships first** — it deletes the one hard blocker (B1), after which **Change 2 (path-param removal)** has no design blockers left.

## Decision record (from the grilling session)

| # | Decision |
|---|---|
| Q1 | Split into two changes; key inversion first. |
| Q2 | Resolve + attach the key in the **BFF agents client** via a **resolver func**; `source:"none"` → typed error mapped to the existing SSE error emission. |
| Q3 | **Drop caching entirely**; forward as `X-Anthropic-Key` header; don't forward `source`. |
| Q4 | Bind token org into `tenant.Caller`; handlers read `humakit.OrgFromCtx(ctx)`; the marker becomes path-less. |
| Q5 | **Store is the fence:** user reads via `GetByIDScoped(ctx, OrgFromCtx, id)`; delete/seal unscoped `GetByID`; add a cross-org store-level test. |
| Q6 | Keep an embeddable marker; rewrite arch-lock to **"marker embedded AND no client-supplied org field"** + fail-closed `OrgFromCtx`. |
| Q7 | **Atomic deploy**, no compat shim. |
| Q8 | Cross-org **wiring** test at the **component tier** (faked claims = org B); no two-org integration infra. |

**Recon basis.** `devant/ipaas-service` already runs token-derived org with no path segment (proves the target). `agent-manager-service` supplies the accessor shape (`GetResolvedOrg ≈ tenant.Caller`) and the two-layer fence (gate + `WHERE org=?`). ASDLC is ~90% there: `GetByIDScoped` exists; raw `*_controller.go` are dead; only the unscoped `GetByID` is a live footgun.

---

## Change 1 — Anthropic key inversion

**Goal:** BFF resolves the effective key (it already owns `AnthropicCredentialService.EffectiveKey`) and forwards it to agents-service on the call it already makes; delete the reverse callback + cache.

**BFF (`asdlc-service`)**
- [ ] `clients/agents/client.go` — add `keyResolver func(ctx, orgID) (string, error)` to `NewClient`; in `streamSSE` + `StreamArchitect`, resolve and set `X-Anthropic-Key`. On resolver error, return it (caller maps to SSE error).
- [ ] `cmd/asdlc-api/main.go` — build the resolver from `anthropicCredService.EffectiveKey` (returns typed `ErrNoAnthropicKey` on `source:"none"||key==""`). Fix wiring order (client built before cred svc): construct the client after the cred service, or pass the closure.
- [ ] `api/huma_infra.go` — delete the `get-anthropic-effective-key` op (keep `get-jwks`).
- [ ] `api/app.go` — delete the `mux.Handle("/internal/credentials/orgs/{orgHandle}/anthropic/effective-key", …)` route.
- [ ] `internal/feature/orgcreds/anthropic_credential_service.go` — drop the `anthropicInvalidator` POST to agents `/v1/internal/cache/invalidate` (+ its wiring in main.go). Keep `EffectiveKey`.
- [ ] `api/openapi.yaml` — regen (drops the effective-key path).

**agents-service (`agents`)**
- [ ] `src/server/routes/{architect,tech-lead,document-generation,requirements-chat}.ts` — read `X-Anthropic-Key` and call `createModel({apiKey})` instead of `resolveModelForOrg(orgId)`; if header missing → 400.
- [ ] `src/shared/anthropic-key-resolver.ts` — delete the network resolver + cache (keep `AnthropicKeyError` if still used, else delete).
- [ ] `src/shared/model.ts` — drop `resolveModelForOrg` (or reduce to a header-key helper).
- [ ] `src/server/index.ts` — delete the `/v1/internal/cache/invalidate` route + `invalidateAnthropicCache` import. Keep `X-Oc-Org-Id` middleware (logging/skills).
- [ ] Update tests touching the resolver/cache.

**Verify:** `go build ./... && make test` (asdlc-service); `npm run build && npm test` (agents). E2E proves it on the cluster run.

**Net deletion. After this, no org-bearing path route remains.**

---

## Change 2 — Path-param removal (token-derived org)

**BFF gate seam**
- [ ] `internal/platform/humakit/humakit.go` — `OrgScopedInput` loses the `path:"orgHandle"` tag (becomes an empty embeddable marker). `Resolve` reads claims, 401s on empty token org, and binds `tenant.Caller{Org, ThunderUUID, Subject, Source:UserJWT}`. Add `OrgFromCtx(ctx) string` (reads Caller; the marker guarantees it's set — fail closed: empty ⇒ the handler's scoped query returns not-found).
- [ ] 56 Huma handlers (13 `*_huma.go`) — `in.OrgHandle` → `humakit.OrgFromCtx(c)`. Keep the org arg on `GetByIDScoped`/`GetBuildStatus`.
- [ ] `middleware/progress_rate_limit.go` — re-key on token org (from Caller/claims), not `PathValue`.
- [ ] Routes — drop `/organizations/{orgHandle}` segment from all org-scoped paths; regen OpenAPI.

**Store fence (Q5)**
- [ ] `repositories/task_repository.go` — remove `GetByID` from the public interface (seal as private for the M2M projector only). User reads use `GetByIDScoped`.
- [ ] Callers: `task_stream.go:717`, `task_service.go:162/263` → scoped with `OrgFromCtx`. M2M (`dispatch_service.go:828`, `task_skills_service.go:75`, `projector.go`) keep event/claim org.
- [ ] New `task_repository` test: `Caller`(org B) → `ErrTaskNotFound` on org A's id.

**Arch-lock + tests (Q6, Q8)**
- [ ] `api/huma_guard_test.go` — replace the `path:"orgHandle"` scan: assert (a) every org-scoped op embeds the marker, (b) no Huma input declares a client-supplied org field (`path:"org…"`, `query:"org…"`, org in body).
- [ ] Delete the three now-inexpressible path-vs-token tests (`humakit_test.go` cross-org cases, `tenant/gate_test.go`, `test/authoring/auth_test.go`).
- [ ] Component-tier cross-org wiring test (faked claims org B → 404 on org A) per `bff-component-testing.md`.

**Dead-code sweep**
- [ ] Delete `tenant.BindUserOrg` + `tenant/gate_test.go`; delete unwired `SourceServiceJWT`; delete dead raw `*_controller.go` (deadcode pass confirms).

**Console (`console`)**
- [ ] `services/api/rest.ts` — `orgPrefix`/`projectPrefix` drop the org segment; remove `orgHandle` arg from ~40 methods + SSE URLs.
- [ ] `services/api/{orgGithub,orgAnthropic,orgIDP,orgSkills}.ts` — same.
- [ ] Keep client-side `:orgId` routing (`App.tsx`, `lib/paths.ts`, `AsdlcLayout.tsx`); org-switcher stays dormant. `orgClaims.ts` unchanged.
- [ ] Regen `services/api/openapi.gen.ts`.

**Test infra**
- [ ] `test/framework/fixtures.go` — `ProjectsPath`/`ProjectPath` drop the org segment.

**Verify:** full `make test` (incl. arch-lock + store fence + component cross-org); console build; then the cluster E2E.

---

## Final verification — fresh-cluster E2E

1. `teardown.sh` → `setup.sh` → set `.env` (`ANTHROPIC_API_KEY`, `GITHUB_APP_*`) → `start.sh`. Cluster-health pre-flight via isolated subagent.
2. Full product flow on a **hello-world API** prompt: create project → requirements → design → tasks → dispatch coding-agent (remote worker) → PR ready → merge → build → deployed.
3. Confirms token-derived org end-to-end + the key-forward path.
