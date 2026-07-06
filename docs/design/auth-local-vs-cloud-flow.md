# Auth Flow: local k3d ⇄ wso2cloud — Path Trace & Comparison

> Evidence-based trace of the BFF (`asdlc-service`) auth/login path on **both** deployment planes,
> built from the live pod logs + env (June 2026 dry run; orgs `default` local, `anjana112` cloud).
> Companion to `asdlc-service-modularization.md` §6.10/§6.12/§6.13 (the seam canon) and
> `wso2cloud-dual-path-pr-analysis.md`. **Headline finding: the two planes now run the SAME auth
> code path — every difference is an injected config *value*, not a Go branch.** Two documented
> "forks" (`IsLocalDevEnv` unverified JWT, `ImpersonateOrgResolver==nil` DirectOC) were **not taken
> by either real deployment** — latent/test-only. **Update (cloud-test branch): the `IsLocalDevEnv`
> unverified-JWT fork has been deleted** — `validateJWT` now fails closed when JWKS is nil; the flag,
> the `extractClaimsUnverified` helper, and the test-only setters are gone. See §4.1.

## 1. The inbound auth chain (one path, both planes)

Wiring: `api/app.go:209` → `mux.Handle("/api/", jwt(ensureOrg(apiMux)))`, then a per-route gate.

```
Browser (Asgardeo SDK, PKCE against Thunder/platform-idp) ──► Authorization: Bearer <User JWT RS256>
        │   (the BFF is NEVER in the OAuth handshake — no /login,/callback,/token; verify-only)
        ▼
[1] jwtmw.Middleware (middleware/jwt + jwtassertion)        — verify + project claims
        validateJWT:  JWKS!=nil ─► "jwks-verified" (RS256)            ◄── BOTH planes
                      JWKS==nil ─► fail-closed (401)   ← misconfig only; no unsigned-claim fallback
        match iss + aud ; project Claims{OuHandle,OuName,OuId,Subject}
        [SHAKEOUT:CLAIMS] validateJWT branch
        ▼
[2] orgensure.Middleware                                    — JIT side-car row + namespace verify
        ResolveOuHandle(claims) → EnsureForOuHandle(ouHandle, ouId)
        (best-effort: never 5xx; namespace-not-found logs + passes through)
        [SHAKEOUT:ORG]
        ▼
[3] BindUserOrg gate (platform/tenant/gate.go), PER ROUTE   — the IDOR fence
        tokenOrg = ResolveOuHandle(claims) ; pathOrg = PathValue("orgHandle")
        enforce: tokenOrg=="" → 401 ; slug(pathOrg) bad → 400 ;
                 !EqualFold(tokenOrg,pathOrg) → 404 (same body as no-such-org)
        bind Caller{Org, ThunderUUID=ouId, Source=SourceUserJWT}
        [SHAKEOUT:CLAIMS] (gate) + [SHAKEOUT:would-deny] canary
        ▼
[4] handler → OpenChoreo client authEditor (clients/openchoreo/transport.go) — outbound OC auth
        useServiceIdentity = IsServiceIdentity(ctx) || userJWT=="" || ImpersonateOrgResolver==nil
          false → forward the inbound user JWT          (user-initiated calls)
          true  → M2M token + X-Impersonate-Org=ouId    (async: dispatch/webhook/watchers)
        [SHAKEOUT:OCAUTH]
```

`ResolveOuHandle` precedence is `ouHandle > ouName > ouId` (`middleware/jwt/jwt.go:49`), mirrored in
`console/src/utils/orgClaims.ts` — change both together.

## 2. Local vs cloud — same path, different injected values

All values below are from the live pods (`docker exec asdlc-api printenv` / `kubectl exec … printenv`
+ boot logs). **Every row is the same code; only the value differs.**

| Seam | Local (k3d / compose) | wso2cloud (`development`) | Forks in code? |
|---|---|---|---|
| Inbound issuer (`JWT_ISSUER`) | `http://thunder.openchoreo.localhost:8080` | `platform-idp` | no |
| Inbound audience (`JWT_AUDIENCE`) | `asdlc-*` (prefix) | `APP_FACTORY_CONSOLE` (exact) | no (matcher handles both) |
| `JWKS_URL` | local Thunder `/oauth2/jwks` | `https://platform-idp-…/oauth2/jwks` | no |
| **validateJWT branch** | `jwks-verified` | `jwks-verified` | **none — `IsLocalDevEnv` OFF both** |
| Claim shape | Thunder sets `ouHandle` slug (`default`) | platform-idp sets `ouHandle` slug (`anjana112`) | no — §7.14 risk did **not** materialise; cloud DOES populate a usable handle |
| M2M token (`SERVICE_AUTH_*`) | `asdlc-api-client` @ local Thunder | `APP_FACTORY_BFF_TO_PLATFORM_API` @ platform-idp | no — **both configure a token provider** |
| OC base URL (`PLATFORM_API_SERVICE_BASE_URL`) | `http://k3d-openchoreo-serverlb:8080` (direct OC, host `api.openchoreo.localhost`) | `https://…/platform-api-service-platform-api-endpoint` (platform-api gateway) | no (same client, different URL) |
| `ImpersonateOrgResolver` | **wired** (`main.go:374`) | **wired** | **none — `nil`/DirectOC branch never taken** |
| User call → OC | forward user JWT | forward user JWT | no |
| Async call → OC | M2M + `X-Impersonate-Org=ouId` | M2M + `X-Impersonate-Org=ouId` | no |
| handle → namespace | BFF sends handle `default`; OC serves it directly | BFF sends handle `anjana112`; **platform-api** maps → `wc-<ouId8>-<hash8>` and bills by `ouId` | no BFF fork — the mapping lives in cloud platform-api, outside the BFF |
| `TENANT_GATE_MODE` | `enforce` | `enforce` (default) | no |

### Log evidence (verbatim)

Inbound — identical branch both planes:
```
local : [SHAKEOUT:CLAIMS] validateJWT branch  jwksConfigured=true branch=jwks-verified iss=http://thunder.openchoreo.localhost:8080 aud=[…]
cloud : [SHAKEOUT:CLAIMS] validateJWT branch  jwksConfigured=true branch=jwks-verified iss=platform-idp aud=[APP_FACTORY_CONSOLE]
```
Outbound — identical async path both planes (impersonation):
```
local : [SHAKEOUT:OCAUTH] impersonation org resolved  namespace=default     impersonateOrg=019ee92d-… explicitServiceIdentity=true
cloud : openchoreo: service-identity call — impersonating org  namespace=anjana112 orgUUID=019eef3c-… explicitServiceIdentity=true
```
Boot (both log "Inbound JWT verifier" with a JWKS URL + "Service auth configured" with a client_id) —
confirming neither plane takes the JWKS-less / no-M2M path.

## 3. Live vs dead branches (the cleanup surface)

| Code branch | Condition to take it | Taken by local? | Taken by cloud? | Verdict |
|---|---|---|---|---|
| `validateJWT` → `jwks-verified` | `JWKS != nil` | ✅ | ✅ | **the only live path** |
| `validateJWT` → `fail-closed` (401) | `JWKS == nil` | ❌ | ❌ | misconfig guard; `localdev-unverified` + `IsLocalDevEnv` **deleted** (§4.1) |
| `authEditor` → forward-user-jwt | user call, resolver set | ✅ | ✅ | live |
| `authEditor` → service-identity (M2M + impersonate) | async / no-JWT | ✅ | ✅ | live |
| `authEditor` → `ImpersonateOrgResolver==nil` (DirectOC) | resolver nil | ❌ | ❌ | dead (`main.go:374` always wires it) |

`IsLocalDevEnv` **has been deleted** (cloud-test branch, §4.1). It was previously set **only** at
`api/app.go:202` as `params.ThunderJWKS == nil`, read **only** by `validateJWT` +
`jwtassertion/auth_test.go`. Since both deployments set `JWKS_URL`, `ThunderJWKS` was always non-nil
and `IsLocalDevEnv` always false — so the flag and its unverified branch were pure dead weight. The
`DeploymentEnv`/`DirectOC`-vs-`ImpersonatingOC`
two-adapter design in §6.10a never landed — there is **one** OC adapter with a per-call branch, and the
local-vs-cloud difference is the injected `BaseURL`/`AuthProvider`/resolver values.

## 4. Simplification opportunities (local vs cloud)

Ordered by value. All are "make the converged reality explicit + delete phantom forks."
**Status:** §4.1 **DONE on `cloud-test`** — resolved by *deleting* the `IsLocalDevEnv` fork outright
(build/vet green; `jwtassertion` + `api` tests green). §4.2, §4.3 **IMPLEMENTED** on branch
`modularization/feature-extraction` (build/vet/full-test-suite green; local `asdlc-api` boots clean,
gate enforce, health 200 / unauth 401). Per §6.13 the cloud-plane reconciliation (SHAKEOUT diff on a
real platform-idp token) is still required before merge — consistent with the branch's
DO-NOT-MERGE-until-cloud-verified posture. §4.4, §4.5 remain proposed.

### 4.1 Fail closed on missing JWKS — don't auto-enable unsigned-JWT acceptance (security) — DONE (deleted)
The original problem: `api/app.go:202` set `IsLocalDevEnv: params.ThunderJWKS == nil`, so **forgetting
`JWKS_URL` silently turned on claim-extraction-without-signature** — a cloud release binding that drops
`JWKS_URL` would accept any unsigned token naming any org. The two concepts ("no JWKS configured" and
"trusted local dev") were conflated.

**Resolution (cloud-test branch): the unverified path was deleted outright** rather than gated behind an
explicit flag. Since no real plane ever ran JWKS-less (both compose and helm set `JWKS_URL`), the safest
clean-up is to remove the fork entirely: `validateJWT` now returns `JWKS not configured` (→ 401) when
`JWKS == nil`. Changes:
> - `middleware/jwtassertion/auth.go`: removed the `IsLocalDevEnv` Config field, the `localdev-unverified`
>   branch, and the `extractClaimsUnverified` helper (+ now-unused `base64`/`json`/`time` imports).
> - `middleware/jwt/jwt.go`, `api/app.go`: removed the `IsLocalDevEnv` field + wiring.
> - `cmd/asdlc-api/main.go`: boot log now `slog.Error`s loudly when `JWKS_URL` is unset (every `/api/`
>   request will 401 — fail closed).
> - `jwtassertion/auth_test.go`: dropped the two test-only `IsLocalDevEnv: true` setters (tests pass
>   unchanged — they exercise missing/malformed headers that 401 regardless).
>
> An earlier variant on `modularization/feature-extraction` instead added an explicit `IS_LOCAL_DEV_ENV`
> config flag; that approach is superseded by the deletion here. Neither real plane changes behaviour.

### 4.2 Delete the dead DirectOC concept — IMPLEMENTED
The `|| cfg.ImpersonateOrgResolver == nil` clause in `transport.go:126` and the "nil resolver = local"
prose are never exercised (resolver always wired). Either drop the clause (and the §6.10a `DirectOC`
adapter idea) or, if kept as a guard, comment it as "defensive; not used by any current deployment."

> Implemented: dropped the `|| cfg.ImpersonateOrgResolver == nil` arm in `transport.go`; the
> impersonation block already self-guards on a nil resolver.

### 4.3 Fold `orgensure` into the gate (one org seam, not two) — IMPLEMENTED
`orgensure.Middleware` and `BindUserOrg` both run on every `/api/` request and both call `ResolveOuHandle`.
`orgensure` does the JIT row + namespace verify (best-effort); the gate does the claim-vs-path check +
`Caller` binding. §6.1b's target is to run `EnsureForOuHandle` **inside** the gate, *after* the path==claim
check (so JIT-ensure only fires for the caller's own org). Merging removes a redundant pass, a duplicated
`ResolveOuHandle`, and the ordering coupling — and consolidates `[SHAKEOUT:ORG]`+`[SHAKEOUT:CLAIMS]`.

> Implemented: `humakit` gains `OrgEnsurer` + `SetOrgEnsurer`; `OrgScopedInput.Resolve` now runs
> `EnsureForOuHandle(tokenOrg, ouId)` (best-effort, `[SHAKEOUT:ORG]`) after the no-org-claim check and
> before the mismatch 404. `api/app.go` drops the `orgensure` `/api/` wrapper (`jwt(apiMux)`) and the
> import, and wires `humakit.SetOrgEnsurer(params.OrganizationService)`. There were **zero** live stdlib
> `OrgScoped` routes (all org routes are Huma), so this single fold covers every org-scoped request.
> The legacy `middleware/orgensure` package is now unused (left in place; delete in a cleanup pass).

### 4.4 Retire the `[SHAKEOUT:*]` Info logs (now that both planes are reconciled)
These were mandated (§6.13) to be removed at the phase DoD **once both planes produce matching values** —
which this dry run confirms for `:CLAIMS`/`:ORG`/`:OCAUTH`. They currently flood the cloud BFF log at Info
on every request. Recommend: downgrade to `Debug` (or delete via `grep -rln '\[SHAKEOUT' asdlc-service`),
keeping `:DISPATCH`/`:CRED`/`:SMAPI` until the coding-agent + secret paths get the same both-plane sign-off.

### 4.5 Align the audience config shape
Local uses a prefix wildcard `asdlc-*`; cloud uses an exact `APP_FACTORY_CONSOLE`. Both are accepted by
`compileAudiences`, but the local wildcard is looser than necessary. Prefer explicit exact lists on both
planes so the matcher's wildcard path is reserved for genuine multi-audience needs.

### Not worth changing
- `PLATFORM_API_SERVICE_BASE_URL` pointing at the OC serverlb locally (vs platform-api in cloud) — the var
  name is slightly misleading locally, but it correctly models "the OC access URL" injection seam.
- `AGENT_PLATFORM_URL` value difference — that is the runner-callback URL, fixed separately (see
  `wso2cloud-dry-run-findings.md`); not part of the inbound auth path.
```

