# Active-org token-derivation — design blockers register

**Status:** 🧱 Blocker register. Companion to `active-org-path-vs-token.md`.

**Scope.** That doc establishes the *migration* (drop `{orgHandle}` from the URL, source org from the verified token at one seam — console/handler/test churn is understood and not in scope here). This file records only the cases where token-derivation has **no clean option** — a genuine design issue, not migration work. One section per case: the hard blockers in full, the exempt-by-design cases in brief so the register is provably complete.

**Legend.** 🔴 **Blocker** — cannot derive org from a token (no usable token). 🟡 **Latent** — a token exists but carries no org; not live today. 🟠 **Tension** — the token *model* can't express the concept. 🟢 **Exempt** — org is established without path *or* user token by design; path removal doesn't touch it.

| # | Case | Verdict | Org source today |
|---|---|---|---|
| B1 | Anthropic effective-key (S2S) | 🔴 Blocker | path `{orgHandle}`, no token |
| B2 | Service-JWT platform token | 🟡 Latent | token, but no org claim |
| B3 | Multi-org / active-org switching | 🟠 Tension | single-org token can't name another org |
| E1 | Webhook HMAC | 🟢 Exempt | HMAC-validated body → DB row |
| E2 | Service-Identity M2M (dispatch/watcher/sweeps) | 🟢 Exempt | `task.OrgID` DB row |
| E3 | Task-JWT / Publisher-CC runner callbacks | 🟢 Exempt | signed claim; path is `{taskId}` |
| E4 | `_test/sm-api-resync` (local dev) | 🟢 Exempt | `?org=` query, dev-gated |

---

## B1 — Anthropic effective-key (unauthenticated S2S) 🔴

**Route.** `GET /internal/credentials/orgs/{orgHandle}/anthropic/effective-key` — `huma_infra.go:61-79`, routed outside the JWT wrapper (`app.go:126`).

**Org source.** The `{orgHandle}` path value, slug-validated, nothing else (`huma_infra.go:68-74`). Deliberately UNGATED, trusted S2S — `huma_infra.go:36`.

**Why there's no option.** agents-service calls this with **no Authorization token** — `agents/src/shared/anthropic-key-resolver.ts:114` builds `…/orgs/${ocOrgId}/anthropic/effective-key` and sends no bearer. The handler signature has only `OrgHandle`; the route isn't under the `jwt` middleware, so even a token sent would not land claims in context. There is literally no token to derive from. The runner pod knows its `ocOrgId`; the path is the only channel to pass it.

**Implication.** This route **keeps `{orgHandle}` permanently**. A fully org-less surface is therefore impossible — any migration ships a hybrid (gated routes org-less, this one path-based). Already isolated in the `api` package, exempt from the feature arch-lock (`huma_infra.go:37-39`), so it doesn't pollute the "no hand-rolled orgHandle on user routes" rule.

**Options if we ever want it gone (none cheap, all deferred):**
- Give agents-service a token — a per-task/publisher JWT it already holds, verify it here and read the org claim. Turns B1 into E3. Cost: agents-service auth wiring + a verifier on this route.
- Keep as-is and document. ✅ recommended — it's a trusted in-cluster S2S call, slug-validated, single purpose.

---

## B2 — Service-JWT platform token 🟡

**Definition.** `SourceServiceJWT` — "platform-wide Service JWT (no org claim); org is bound from a resolved row, providing scoping/observability not authz" (`tenant.go:48-50`).

**State today.** **Never constructed.** No inbound route builds a `SourceServiceJWT` caller (grep: zero hits outside the enum definition). The only live "was-service-JWT" surface is B1, which is now unauthenticated.

**Why it's a latent blocker.** By definition this token has no org claim — `ResolveOuHandle` returns `""`. If a future platform-wide service token is ever pointed at an org-scoped route, there is nothing in the token to derive org from; it would need the path (or a body/row resolution) exactly like B1. So the *capability* to derive-from-token does not exist for this source.

**Implication / action.** Not a live blocker. Decide one of:
- **Delete** the unwired enum + `Source` value (lazy; resurrect when a real service-token surface lands). ✅ recommended.
- **Keep** as a documented latent case so whoever wires a platform token knows org must come from path/row, not the token.

---

## B3 — Multi-org user / active-org switching 🟠

**The actual "active org" question.** A Thunder user JWT carries **one** scalar org (`ouHandle`, precedence in `jwt.ResolveOuHandle`). The console org-switcher only `navigate()`s; it does not re-mint the token. With the strict-equality gate, switching to org B 404s — so multi-org switching is **already non-functional**, regardless of path vs token.

**Why the path *looks* like it solves it but doesn't.** The path is the only place that *could* carry an active-org ≠ home-org — which is presumably the original intuition for "active org in the path." But the gate forbids `pathOrg != tokenOrg`, so the path cannot actually express a switch today. Removing the path doesn't lose a working feature; it removes a dormant affordance.

**Why no option from the current token.** A single-org token structurally cannot name a second org the user may legitimately belong to. Deriving "the active org" from the token gives you exactly the home org and nothing else.

**Implication / action.** If real multi-org is a product requirement, it needs a **different token model**, not a path:
- per-switch **token re-mint** (Thunder issues a token scoped to the selected org), or
- a **membership-set claim** (token lists all orgs; a separate `X-Active-Org` header or path selects within the verified set, gated against the set instead of a scalar).

Until that decision lands, treat multi-org as aspirational UI (`active-org-path-vs-token.md` §5.2). The path param does **not** unblock it.

---

## E1 — Webhook HMAC 🟢

Org (`ocOrgID`) comes from the HMAC-validated request body (installation id / repo) resolved to an `org_credentials` row (`webhook/installation_handlers.go`, `deliveries.go:56-64`). Route is the fixed `/webhooks/github` — no `{orgHandle}`, no user token. Path removal doesn't touch it. Not a derivation case.

## E2 — Service-Identity M2M (dispatch / build-watcher / sweeps) 🟢

Internal loops, no inbound HTTP request. Org is per-row DB state (`task.OrgID`, e.g. `task_controller.go:423`); one tick spans many orgs. Outbound OC calls set the namespace from that row, not a path or token. Not a derivation case.

## E3 — Task-JWT / Publisher-CC runner callbacks 🟢

`/api/v1/tasks/{taskId}/…` — path is `{taskId}`, not org. Org comes from the **signed claim**: Task-JWT `claims.OcOrgID` (`task_controller.go:166`); Publisher-CC org from the `asdlc-publisher-{org}` audience (`publisher_token_verifier.go:127`), cross-checked against `task.OrgID` (`task_controller.go:179`). Already token-derived — just a different claim than `ouHandle`. Not a blocker.

## E4 — `_test/sm-api-resync` (local dev) 🟢

`POST /internal/v1/_test/sm-api-resync`, org from `?org=` query (`app.go:308`). Gated on `TestMode && LocalOpenBaoRepairEnabled` — never registers off a dev plane. Not a production surface; out of scope.

---

## Summary

- **One hard blocker:** B1 (Anthropic effective-key) — keep its path forever, or give agents-service a token.
- **One latent:** B2 (Service-JWT) — dead enum; delete or document.
- **One product tension:** B3 (multi-org) — needs a token-model change, not a path; path doesn't deliver it today anyway.
- **Everything else (E1–E4)** establishes org without a user token *and* without a removable path — untouched by the migration.

Net: the path-removal migration is unblocked for the entire User-JWT surface; the only permanent path-bearing org route is B1.
