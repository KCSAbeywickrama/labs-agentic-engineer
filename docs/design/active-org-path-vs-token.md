# Active org: path param vs. token-derived — analysis & recommendation

**Status:** 📐 Analysis / proposal. No code written. Decision pending.

**Audience:** whoever owns the BFF tenant model (`asdlc-service`) + the console org routing. Read alongside `docs/design/asdlc-service-modularization.md` (§auth, the IDOR fix), `docs/design/bff-openapi-huma-migration.md` (the Huma gate), and `docs/design/auth-local-vs-cloud-flow.md` (impersonation / namespace derivation).

**The central question.** Every org-scoped BFF route is shaped `/api/v1/organizations/{orgHandle}/…`. The tenant gate forces `pathOrg == tokenOrg` and 404s on mismatch. If the path org must always equal the token org, the path appears redundant — it could be derived from the token. This doc answers: (1) why org is in the path, (2) whether it can be derived from the token, per request case, (3) the exact changes to do so safely, (4) what the path buys us, (5) a recommendation.

**Bottom line:** for the User-JWT surface the path org is **currently redundant** (provably `== ResolveOuHandle(claims)`), not structurally required. But removing it is a large, low-value refactor that also silently neuters the IDOR arch-lock. **Recommended: keep the path, document it as a defensively re-verified mirror.** See §8.

---

## 1. Why active org is a path param today

No design doc states an *affirmative* benefit of org-in-path. It is an **inherited REST resource-hierarchy convention** (`/organizations/{orgHandle}/projects/…`), and the modularization work found it was being *trusted as the org source with no JWT comparison* — that was the systemic IDOR (`asdlc-service-modularization.md:17`). The refactor's intent was never to justify the path; it was to **gate** it:

> identity (`Caller.Org`, `Caller.ThunderUUID`) is derived from the verified JWT claim, never from config or the URL path — `asdlc-service-modularization.md:638`

So the path's role narrowed to **the equality target of the IDOR fence**: the gate compares the path value against the token org and 404s on mismatch. The docs are explicit that a *pure* claim-vs-path `strings.EqualFold` closes IDOR-1..5 with no resolver at all (`asdlc-service-modularization.md:392`).

Two live forms of the gate:
- **Huma (live surface):** `humakit.OrgScopedInput` embeds `OrgHandle string \`path:"orgHandle"\``; its `Resolve()` does the `EqualFold(tokenOrg, pathOrg)` check, 404 on mismatch / 401 on no-org-claim — `humakit.go:62, :74-75, :95-102`. It binds **no** `Caller` into ctx.
- **Legacy (`tenant.BindUserOrg`, `gate.go:69-145`):** the same check, plus it binds a `Caller`. **Dead** — no non-test route wires it; the Huma surface superseded it (see §6.3).

The path also serves a second, *non-security* role: it is the **structural marker** that makes a route org-scoped-by-construction. The arch-lock test `TestOrgScopedInputIsOnlyOrgHandleBinding` scans every `*_huma.go` for the literal `path:"orgHandle"` and fails unless the binding goes through `OrgScopedInput` (`huma_guard_test.go:51-77`). That convention — not any behavioral requirement — is the real reason the path param still exists.

**Scope correction.** The brief says "16 ops"; the live count is **71 org-scoped Huma operations** across 13 feature files (task 12, design 11, skills 8, requirements 8, component 8, requirements-chat 5, project 5, github 4, idp 3, anthropic 3, config 2, collab 1, board 1). In **every** one, the `{orgHandle}` path value is threaded downstream as `in.OrgHandle` — the first arg to `svc.X(ctx, in.OrgHandle, …)` — selecting the OC namespace / DB rows / git repo / Thunder client. So the path is **not** "nothing but the gate echo": it is the actual tenant-key data carrier. It is *redundant* only because the gate proves it equals the token org.

---

## 2. Can it be derived from the token? — per-case verdict table

Org provenance differs by inbound `tenant.Source` (`tenant.go:44-60`). The "derive from token" question only *applies* to the User-JWT surface; every other source establishes org without an `{orgHandle}` path at all. The 10 cases:

| # | Request case | How org is determined today | Path role | Derivable from token? | What's needed |
|---|---|---|---|---|---|
| 1 | **User-JWT** — console → org-scoped route (71 Huma ops) | gate proves `i.OrgHandle == ResolveOuHandle(claims)`; handler acts on `in.OrgHandle` threaded into every `svc` call | gate equality target **+** the tenant key passed downstream (`project_huma.go:68/87/102`, `task_huma.go:182`, `design_huma.go:95…`) | **YES — fully** | Inject token-org into ctx, read it in handlers instead of `in.OrgHandle`, drop the path param. §3 |
| 2 | **User-JWT carve-outs** — list-orgs, idp-discover, collab-validate, `_test/reset` | no `{orgHandle}` at all; org derived in-handler from the token (or none) | none — deliberately omit `OrgScopedInput` (`organization_huma.go:32-37`, `idp_huma.go:49-53`, `collab_huma.go:108-119`) | **YES (already)** | Nothing — these are the existence proof the codebase already omits the path when not per-org-scoped |
| 3 | **Task-JWT** — runner pod callback (`/tasks/{taskId}/…`) | `claims.OcOrgID` from the BFF-minted RS256 token; path is `{taskId}`, asserted `== claims.TaskID` | **no `{orgHandle}`**; `{taskId}` is the anti-confused-deputy key | **n/a** (already token-only) | Nothing. `task_bearer.go:65-69`, `task_controller.go:158-168` |
| 4 | **Publisher-CC** — runner callback alt verifier | `orgHandle` from `asdlc-publisher-{org}` audience, cross-checked vs `ouHandle` claim, then vs `task.OrgID` | **no `{orgHandle}`**; `{taskId}` only | **n/a** (already token-only) | Nothing. `publisher_token_verifier.go:117-140`, `task_controller.go:170-187` |
| 5 | **Webhook HMAC** — inbound GitHub event | org from the HMAC-validated body routing key (installation id / repo full-name) → `org_credentials` lookup | **no `{orgHandle}`**, **no token** — fixed `/webhooks/github` | **n/a** (body-borne) | Nothing. `webhook_routes.go:37-38`, `routing_key.go:46-67`, `tenant.go:55-57` |
| 6 | **Service-Identity** — BFF own M2M (watchers, dispatch, sweeps) | per-row DB state (`task.OrgID`); one tick spans many orgs; no inbound request | **no `{orgHandle}`, no token** | **n/a** (DB-state-borne) | Nothing. `build_watcher.go:99-127`, `dispatch_service.go:910-974`, `main.go:339` |
| 7 | **Impersonation** (`X-Impersonate-Org`) — **outbound** BFF→OC | not inbound; transport maps the OC-URL namespace → org UUID; **user calls forward the user JWT and set no header** | the namespace originates from the (gated) inbound org; resolver fast-path returns `claims.OuId` when `ResolveOuHandle(claims)==namespace` | **YES** (the UUID is already taken from the token, not the path) | Namespace becomes `tokenOrg` (identical value); resolver fast-path still hits. `transport.go:125-164`, `main.go:340-345` |
| 8 | **Unauthenticated S2S** — agents-service Anthropic effective-key | **org SOLELY from `{orgHandle}` path**; no token exists; slug-validated only | **STRUCTURALLY REQUIRED** — the only org input | **NO** | Cannot derive — exempt this route, keep its path (or make it a token-bearing S2S call). `huma_infra.go:30-39, :57-79`, `app.go:121-126` |
| 9 | **Multi-org user / active-org switching** (product concept) | token carries **one** scalar org; switcher only `navigate()`s, no re-mint → switching to org B 404s under the gate | path can never *legitimately* differ from the token org | **YES** (the active org is the single-org token's handle) | Genuine multi-org needs a token re-mint (or membership-set claim) — a *different* token model, not a path. §5.2 |
| 10 | **Service-JWT** — platform-wide token, no org claim | enum defined (`tenant.go:48-50`) but **no inbound route constructs it**; the only "was-Service-JWT" live surface is case 8 | n/a (unwired) | **NO** in principle (token has no org) | Delete the unwired enum, or keep case-8 path. §6.3 |

**Honest summary:** **7 of 10 cases** are derivable-or-already-token-derived for the org axis (1, 2, 3, 4, 7, 9, and 6/5 are token-irrelevant). **Cases 8 and 10 are genuinely NOT derivable** — there is no token to derive from. Cases 5 and 6 are token-irrelevant (org is body/DB-borne). So the central claim — "path org is redundant" — holds **only for the User-JWT gated surface (cases 1, 2, 9)**; it is false for the unauthenticated S2S effective-key route (case 8).

---

## 3. Exact changes to derive org from the token (User-JWT surface)

The **blocker**: no downstream consumer reads `tenant.Caller` for org. `humakit.Resolve` binds no `Caller` (`humakit.go:72-104`); `tenant.MustOrg/Scope/FromContext` are never called outside tests (§downstream finding). Today the only token-org source available to a Huma handler is `jwt.ResolveOuHandle(jwt.ClaimsFromContext(ctx))`. So "just bind org into the Caller and let downstream pick it up" does **not** work — nothing reads it.

Two implementation shapes:

- **(a) Smallest diff — inject, don't rewrite.** Have the gate/resolver populate the org into ctx (or keep populating `in.OrgHandle` from claims at the framework seam) so the 71 handlers and every `svc.X(ctx, org, …)` signature stay untouched. The value is byte-identical to today (gate already proved `path==token`). `// ponytail: keep in.OrgHandle, source it from claims at one seam` — one edit, 71 call-sites unchanged.
- **(b) Honest — rewrite handlers** to read `tenant.MustOrg(ctx)` / `ResolveOuHandle(claims)` and drop the param. ~2× handler count if the dead legacy `*_controller.go` are also migrated.

Option (a) is the lazy-correct path **if** you keep the path param; but the whole point of "derive from token" is to *remove* the path from the URL, which forces the changes below regardless.

**If removing the path from the URL surface:**

### 3.1 BFF
| Area | File | Change |
|---|---|---|
| Gate input | `internal/platform/humakit/humakit.go:55-104` | Replace `OrgScopedInput{OrgHandle path:"orgHandle"}` with a **path-less marker** that still binds via a single seam: resolve `org := ResolveOuHandle(claims)` (401 if empty) and stash it in ctx. The equality check disappears (a token can't mismatch itself). |
| 71 ops | 13 `*_huma.go` files (§huma-ops key files) | Drop `in.OrgHandle`; read the ctx-bound org. **Preserve the org arg to the two IDOR-fence-on-UUID lookups** — `GetTaskScoped(ctx, org, taskID)` (`task_huma.go:182`) and `GetBuildStatus(ctx, org, buildName)` (`component_huma.go:170`) — dropping the arg there turns a same-value refactor into a cross-tenant IDOR. |
| Arch-lock | `api/huma_guard_test.go:51-77` | **Rewrite** — the `path:"orgHandle"` scan goes vacuously green (false-green) once no file has the literal. Replace with: every org-scoped handler derives org from verified claims via the one shared seam, never from a request-supplied field. This is the single most dangerous test-side effect. |
| Legacy gate | `tenant/gate.go:69-145` + `gate_test.go` | Delete (already dead, §6.3). |
| Routes / spec | `api/*_routes.go`, `api/openapi.yaml` | Re-path all 71 ops org-less; `make openapi` to regen; `TestOpenAPISpecFresh` fails until regenerated (`huma_guard_test.go:30-42`). |
| Prefix lock | `api/gate_invariant_test.go:44-48` | Keyed on the `/api/v1/organizations` **prefix**, not the `{orgHandle}` segment — unaffected if the prefix stays; update the slice if the prefix is renamed. |
| **Exempt** | `api/huma_infra.go` (effective-key, case 8), `webhook_routes.go` (case 5) | Must NOT change — no token to derive from. |

### 3.2 Console
| Area | File | Change |
|---|---|---|
| API path builders | `services/api/rest.ts:143-148` (`orgPrefix`/`projectPrefix`) | Drop the org segment; remove the first `orgHandle` arg from ~40 methods. |
| Per-feature modules | `orgGithub.ts`, `orgAnthropic.ts`, `orgIDP.ts`, `orgSkills.ts` (~15 URL literals) | Same — second edit site. |
| SSE flows | `rest.ts:359-361, 459-461, 734-735, 1097-1099` | Drop org from the stream URLs (matching server change applied together). |
| Generated client | `services/api/openapi.gen.ts` | **Zero importers** — regenerate or delete; cosmetic. |
| Client routing | `App.tsx`, `lib/paths.ts`, `AsdlcLayout.tsx` | **Separable decision.** Keeping `:orgId` in the *frontend* URL (bookmarkable per-org URLs, the switcher) does NOT require keeping it in the *BFF* path. Recommend keeping client-side routing; only the API payload drops it. `orgClaims.ts:31-34` (claim precedence) is unaffected. |
| Dead fallbacks | ~22 `'demo-org'`/`'default'` placeholders | Remove in the same pass if org becomes token-derived. |

### 3.3 Tests (the category that dies)
Three tests assert the **"different org in path vs token"** attack and become *inexpressible* (delete, don't edit) — with org from the token there is no second org to put in a path:
- `humakit_test.go:59-70` cross-org-404 + bad-slug-400 cases — unconstructable.
- `tenant/gate_test.go:69-73` cross-org-denied — unconstructable (legacy, delete with the gate).
- `authoring/auth_test.go:47-54` "hides another org (404)" — the **only** black-box cross-org assertion in the integration suite.
- Shared kit `tenancytest.AssertCrossOrgDenied` (`tenancytest.go:45-56`) + template `tenancy_http_test.go` — the §10 "one cross-org assertion per gated route" discipline collapses.

The IDOR class must **re-anchor at the store-scoping layer** — the `task_controller_progress_test.go` pattern (caller org == path org; the real defense is `GetTaskScoped` returning `ErrTaskNotFound` cross-org). That test survives path removal essentially unchanged and is the model the whole class should migrate onto.

Integration URL builders: `test/framework/fixtures.go:171-179` is the single chokepoint (`ProjectsPath`/`ProjectPath`) — mechanical. `config.go:56-58`'s comment claiming token-derived `TestOrg` is **aspirational/dead** today (`:88` just defaults to `"default"`).

---

## 4. What the path param buys us (risks of token-derivation)

| Property the path provides | Lost on token-derivation? | Mitigation |
|---|---|---|
| **IDOR fence explicitness** — a literal 404-on-`pathOrg!=tokenOrg` you can read, test, and grep | Partially. A token can't mismatch itself, so the *visible* fence vanishes; the real isolation moves to store-layer scoping (`WHERE org_id=?`) which is **untested at integration level** today. | Re-anchor IDOR tests at the store layer (the `GetTaskScoped` pattern); add a "token-from-org-B-can't-see-org-A-data" store-level spec to replace `auth_test.go`. |
| **Arch-lock by construction** — every org-scoped op *must* embed `OrgScopedInput`, enforced by a string scan | Yes — the scan goes false-green. | Rewrite the arch-lock to assert claim-sourced org via a shared seam (harder to express as a string grep — §3.1). **This is the main non-security cost.** |
| **Multi-org switching** (future) | The switcher is **already non-functional** under the single-org token + strict-equality gate (`AsdlcLayout.tsx:353-383` only `navigate()`s, no re-mint → 404). | Genuine multi-org needs a membership-set claim or per-switch token re-mint — a different token model either way; the path doesn't deliver it today. |
| **Observability / audit-by-URL** — org visible in access logs & OpenAPI resource shape | Minor — request logs lose the org segment. | Org is already in structured logs from claims (`ocOrgId` fields, e.g. `organthropic_huma.go:93`). Keep client-side `:orgId` routing for shareable URLs. |
| **The SHAKEOUT canary / cross-org probe** — `auth_test.go` is the live attack rehearsal | Yes — deleted. | Store-level isolation spec (above). |
| **OpenChoreo egress / impersonation** | No — the OC namespace + `X-Impersonate-Org` UUID already come from `claims.OuId`, not the path (case 7). | None needed. |

The deepest risk is **silent**: removing the path makes the IDOR arch-lock pass *vacuously*. The change must replace the lock in the same PR or tenant isolation loses its CI fence.

---

## 5. Edge cases worth one line each

### 5.1 Skill actor mis-sourcing (pre-existing quirk)
`skill_huma.go:135/161/242/263` pass `in.OrgHandle` as **both** orgID and actor (`mutationSvc.Create(ctx, org, org, …)`) — the audit-trail actor is the org handle, not the JWT subject. Deriving org from the token is the natural moment to source the actor from `httpkit.ActorFromContext` instead. Out of scope for the gate question; worth fixing opportunistically.

### 5.2 Multi-org is shown but not usable
`list-organizations` can return >1 namespace (`organization_service.go:177-217`), and the switcher lists them — but the gate 404s any org ≠ the single token org. So multi-org is **aspirational UI**, not a live capability. Confirm whether it's a real requirement before treating the path as "structurally intended" for it.

### 5.3 Dead code adjacent to this decision
- `tenant.BindUserOrg` + `gate_test.go` — superseded by `OrgScopedInput`, no live caller.
- The raw `*_controller.go` reading `r.PathValue("orgHandle")` — confirm with a build-time deadcode pass; if dead, delete (`// ponytail`).
- `SourceServiceJWT` (`tenant.go:48-50`) — defined, never constructed inbound; delete if it stays unwired.
- `progress_rate_limit.go:46` reads `r.PathValue("orgHandle")` — verify it's still mounted.

---

## 6. Recommendation

**KEEP the path param.** Document it as a *defensively re-verified mirror of the token org* and move on. Rationale, in the repo's lazy ethos:

1. **It's already correct and tested.** The gate proves `path==token`; the IDOR fence, the arch-lock, and the only black-box cross-org assertion all key on the path's existence. The system works.
2. **Removing it is a large diff for ~zero behavioral gain.** 71 handlers + 13 spec files + ~6 console files + a test-category deletion + an arch-lock rewrite — to make a value the gate already guarantees come from a slightly different place. The smallest change that "preserves the security property" is **the change of doing nothing** plus a one-paragraph comment.
3. **The real hazard is the silent false-green.** Any removal *must* re-express the arch-lock and re-anchor IDOR tests at the store layer, or tenant isolation loses its CI fence. That cost dwarfs the cosmetic URL cleanup.
4. **The path is genuinely required for case 8** (unauthenticated effective-key) — so "no org in any path" is impossible anyway; you'd ship an inconsistent surface.

**If a cleanup is still wanted, do the lazy hybrid, not the removal:**
- Add one line of code-level honesty: at the gate seam, after the equality check, the canonical org is `ResolveOuHandle(claims)` — pass *that* downstream rather than `in.OrgHandle` (identical value, removes the "is the path trusted?" question forever). `// ponytail: path kept as the IDOR fence + arch-lock marker; org value sourced from the token`.
- Keep the URL shape, the OpenAPI surface, the console client, and all tests **unchanged**.
- This captures the entire security benefit of "derive from token" (org provenance = the verified claim) with a **one-seam edit** and **zero test churn**, while the path stays as the explicit fence and the by-construction arch-lock.

**Only pursue full removal** if a product decision lands that the org should *not* be in the REST resource hierarchy — and budget the arch-lock rewrite + store-level IDOR spec as the real work, not the URL edit.

---

## 7. Key files (start here)

**Gate / tenant:** `humakit/humakit.go`, `tenant/gate.go`, `tenant/tenant.go`, `middleware/jwt/jwt.go`, `middleware/jwtassertion/auth.go`
**Token-only sources (no path):** `middleware/task_bearer.go`, `internal/platform/auth/publisher_token_verifier.go`, `internal/feature/task/task_controller.go`, `api/webhook_routes.go`
**Egress / impersonation:** `clients/openchoreo/transport.go`, `cmd/asdlc-api/main.go:330-363`
**Structurally-path-required:** `api/huma_infra.go` (effective-key)
**Arch-lock / tests:** `api/huma_guard_test.go`, `api/gate_invariant_test.go`, `internal/platform/humakit/humakit_test.go`, `test/authoring/auth_test.go`, `test/framework/fixtures.go`
**Console:** `console/src/utils/orgClaims.ts`, `services/api/rest.ts`, `layouts/AsdlcLayout.tsx`, `services/api/openapi.gen.ts`
**Design intent:** `docs/design/asdlc-service-modularization.md` (:17, :392, :638), `docs/design/bff-openapi-huma-migration.md` (:50-51)
