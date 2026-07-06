# Backend Testing — Real-Stack, Headless

**Status:** Design — implementation-ready
**Owner:** Platform / BFF
**Supersedes:** the previous in-process / mock-middleware taxonomy, and the "Test Types" section of `docs/design/testing.md` (see §11)
**Reference pattern:** `agent-manager` `test/e2e/` — a repo-root **separate Go module**, black-box over HTTP, real services, real token.

---

## 1. Goal & scope

**One goal:** prove the **whole backend works without a frontend** — by driving the **real, running stack over HTTP** with a **real token**, and asserting real behavior. No mocked clients, no mocked auth, no in-process handler.

### The three test levels (and where "e2e" lives)

Everything that hits the backend over HTTP is an **integration** test — the only things that vary are *which slice of the lifecycle* it covers and *how expensive* it is. The word **"e2e" is reserved for the future frontend (browser) suite** so it never sits on a backend-only tier.

| Level | Lives in | Driver | Frontend? | Status |
|---|---|---|---|---|
| **1 · Unit** | `asdlc-service/**/*_test.go` | Go `testing`, in-process | no | exists, untouched |
| **2 · Integration** | repo-root **`test/`** Go module | Ginkgo, real HTTP → BFF | **no** | **this doc** |
| **3 · E2E** | `console/tests/e2e/` | Playwright, browser → full stack | **yes** | future; the **only** "e2e" |

Level 2 (this doc) splits into two subsets — exactly the two the lifecycle splits into — **by folder** and by which stack they run against:

| Subset | Folder | Lifecycle slice | Stack | When |
|---|---|---|---|---|
| **Authoring** | `test/authoring/` | project · requirements · architecture(design) · tasks → **stops at `ready_for_review`** (+ auth, webhook-contract, health) | **shared local dev** | locally + manual CI; day-to-day |
| **Delivery** | `test/delivery/` | remote-worker → PR → build → **`deployed`**, on a **hello-world API** (low Anthropic + build cost) | **separate / throwaway** | manual CI only, fresh stack |

**Why split:** the delivery slice needs a GitHub App + smee + minutes-long builds and leaves real components/PRs behind — fine on a throwaway stack in CI, but it would pollute the shared dev stack and slow the everyday loop. This is the test-pyramid rule: keep the few expensive full-lifecycle tests separate.

**Language = Go**, mirroring agent-manager's `test/e2e/` directly: same language as the backend, one toolchain for backend devs, can import the BFF's exported response DTOs for typed assertions. The black-box tests only send HTTP + assert JSON, so the language is a developer-ergonomics choice, not a fidelity one.

**No backend browser tests.** Level 2 never opens a browser. The **Playwright CLI is used only as a one-time harvest tool** (§8) to drive the console during bring-up and capture the real token + request/response values that the Go specs assert on. It is tooling, not a test suite. A maintained Playwright suite is a *future Level 3* and lives under `console/`, not here.

**In scope**
- A reusable Go **framework** (`test/framework/`) — config, auth, HTTP client, stack-readiness, fixtures — mirroring agent-manager's `test/e2e/framework/`.
- The **authoring** suite (`test/authoring/`) and the **delivery** suite (`test/delivery/`).

**Out of scope (dropped — "drop only the in-process machinery")**
- In-process Go testing (`httptest` + `NewHandler`), the injectable `AuthMiddleware` seam, `NewMockMiddleware`, the `apptest` factory, `moq` client fakes, the per-instance gate-mode refactor, and the L0–L4 sub-layer taxonomy. **The black-box suite stays Go** — only this machinery is removed.
- The whole TS `tests/` tree (vitest API tests + Playwright browser tests) — retired (see §10).
- Existing colocated Go `*_test.go` unit tests are **left as-is** — they remain Level 1 (§2).
- A maintained frontend Level-3 e2e suite — **future**; this doc only reserves its name/location.

---

## 2. Layering — reflected in the folder tree

The **folder is the signal**. No build tags.

| Level | Lives in | Module | Transport | Auth | Stack |
|---|---|---|---|---|---|
| **1 · Unit** (existing, out of scope) | colocated `asdlc-service/**/*_test.go` | service module | none (pure) | n/a | none |
| **2 · Integration · authoring** | `test/authoring/` (+ `test/framework/`) | repo-root **`test/go.mod`** | real HTTP → BFF `:9090` | real Thunder token | shared local dev |
| **2 · Integration · delivery** | `test/delivery/` (+ `test/framework/`) | repo-root **`test/go.mod`** | real HTTP → BFF | real Thunder token | **throwaway** |
| **3 · E2E** (future) | `console/tests/e2e/` | (frontend) | Playwright, browser | real OIDC login | full stack |

> **Why a repo-root `test/` module (the key mechanism):** putting the suite in its **own module at the repo root** — entirely outside `asdlc-service/` — keeps it out of the unit run: `cd asdlc-service && go test ./...` cannot reach a sibling directory in another module, so unit `make test` never tries to boot a live stack. This is exactly how agent-manager isolates `test/e2e/`, and gives folder-only separation with **no build tags**. The module imports the BFF's exported DTOs via `replace github.com/wso2/asdlc/asdlc-service => ../asdlc-service` for typed assertions (optional); its Ginkgo/Gomega + test-only deps don't touch the service module. Living at the repo root also matches what "whole backend" means — the BFF is the entry point, but flows fan out to agents-service / git-service / coding-agent.

---

## 3. Folder structure

```
asdlc-service/
  **/*_test.go                     # LEVEL 1 · UNIT — colocated, Go (existing, untouched; `make test`)

test/                              # LEVEL 2 · INTEGRATION — repo-root, OWN Go module; backend, NO frontend
  go.mod                           # replace ../asdlc-service for typed DTOs; Ginkgo v2 + Gomega here only
  framework/                       # reusable harness (mirrors agent-manager test/e2e/framework/)
    config.go                      # endpoints + creds from env, with defaults
    auth.go                        # FetchToken → a REAL BFF-accepted bearer (§5)
    client.go                      # HTTP client → BFF, attaches Bearer, get/post/del + SSE
    stack.go                       # readiness gate: poll /health + Thunder, fail loud
    fixtures.go                    # unique-name create + cleanup registry
  authoring/                       # AUTHORING subset — shared stack, → ready_for_review (NO build/deploy)
    authoring_suite_test.go        # RunSpecs bootstrap + BeforeSuite readiness
    auth_test.go                   # 401 no token, 200 with token, cross-org 404 (IDOR)
    projects_test.go               # project CRUD
    requirements_test.go           # generate → save (v1) → version → get-at-version
    design_test.go                 # generate (needs v1) → save (v1-1) → version
    tasks_test.go                  # generate → dispatch → ready_for_review (STOPS here)
    webhook_test.go                # GitHub HMAC validation + dedup (no token; HMAC path)
    health_test.go                 # /health smoke (ungated)
  delivery/                        # DELIVERY subset — throwaway stack, manual CI
    delivery_suite_test.go         # RunSpecs bootstrap + BeforeSuite readiness
    lifecycle_test.go              # hello-world API: spec → dispatch → merge → building → deployed

console/tests/e2e/                 # LEVEL 3 · E2E — Playwright, browser → full stack (FUTURE; not built here)
```

The whole TS `tests/` tree is **removed**: `tests/api/` vitest coverage moves to `test/authoring/` (Go); `tests/helpers/` ports into `test/framework/`; `tests/e2e/` Playwright tests are deleted (the future maintained browser layer will live under `console/`, freshly written).

Each Ginkgo package (`authoring/`, `delivery/`) has a `*_suite_test.go` `RunSpecs` bootstrap; specs are `Describe`/`It` with Gomega `Expect`; stack readiness runs once in `BeforeSuite`.

---

## 4. The framework (`test/framework/`)

agent-manager analogue: `test/e2e/framework/{auth.go,client.go,config.go}`. Both subsets import it; the only difference between them is which `ASDLC_API_BASE_URL` they target.

### `config.go` — everything from env, with local-stack defaults
| Env var | Default | Purpose |
|---|---|---|
| `ASDLC_API_BASE_URL` | `http://localhost:9090` | BFF base (authoring = shared; delivery = throwaway URL) |
| `THUNDER_TOKEN_URL` | `http://thunder.openchoreo.localhost:8080/oauth2/token` | token endpoint |
| `ASDLC_TEST_ORG` | derived from token | org handle used in `/organizations/{org}/...` paths |
| `ASDLC_API_TOKEN` | _(unset)_ | pre-issued token override (mirrors agent-manager `AMP_API_TOKEN`) — skip minting |
| `ASDLC_ADMIN_USER` / `ASDLC_ADMIN_PASS` | `admin` / `admin` | console/IDP login (if user-token flow is used, §5) |

### `auth.go` — `FetchToken()` → a REAL BFF-accepted bearer
A pluggable `TokenProvider` interface returning a token the BFF's JWKS verifier accepts (`iss=thunder`, `aud=asdlc-*`, plus the org claim the tenant gate requires). Precedence:
1. If `ASDLC_API_TOKEN` is set, use it verbatim (CI / pre-issued).
2. Otherwise **mint one** against Thunder — the exact grant + client is **pinned by the Phase-0 harvest (§8)**, not guessed. (Port the `client_credentials` logic currently in `tests/helpers/architect.ts`.)

### `client.go` — `NewClient(baseURL, token)`
Thin `*http.Client` wrapper: `Get/Post/Delete`, sets `Authorization: Bearer` + `Content-Type`, decodes JSON, plus an SSE reader for streaming endpoints (requirements-chat, design/task generate). This is `agent-manager test/e2e/framework/client.go:NewAMPClient`.

### `stack.go` — readiness gate (Ginkgo `BeforeSuite`)
A top-level `BeforeSuite` (per suite package) polls `GET {ASDLC_API_BASE_URL}/health` + the Thunder token endpoint until ready, then **fails loud** if down (no silent skip). On the **shared** stack it **does not truncate the DB** — specs namespace data (unique names) + clean up in `DeferCleanup`/`defer` via `fixtures.go`. On the **throwaway** delivery stack the DB starts empty, so cleanup is best-effort.

### `fixtures.go` — data lifecycle
Unique-name project creation + a cleanup registry drained at teardown. The **org** is JIT-provisioned on first authenticated request and isn't deletable, so a **single stable test org** is reused (cleaned of projects between runs); only projects/components are created and torn down.

---

## 5. Auth against the real BFF

The BFF gates every `/api/` route on a Thunder RS256 token (`iss=thunder`, `aud=asdlc-*`) **and** a tenant gate matching the token's org claim (`OuHandle`) to `{orgHandle}` in the path. So a useful token must **carry an org claim**. Two ways:

- **User token (faithful to the console):** replay the OIDC flow the console uses (admin/admin against the per-project Thunder client) → full user + org claims; exercises the exact SPA path.
- **M2M token (simplest):** `client_credentials` (as `tests/helpers/architect.ts` already does). Easiest, but a plain M2M token may **lack `OuHandle`** → tenant gate 401s. Usable only if a test client is provisioned in Thunder to emit the org claim (or for ungated/HMAC routes).

**We do not guess — we observe it (§8).** Non-token routes need no decision: `/health` is ungated; `/webhooks/github` is HMAC-signed (compute the signature, no token); `/api/v1/credentials/*` uses a Task-JWT (out of scope for now).

---

## 6. What we test

Black-box, against the real stack, following the user scenarios in `requirements/`. Each spec creates and cleans up its own data. Assertions are **structural / contract only** — status codes, response shape, version-tag creation, presence of components/tasks/state — never exact Anthropic-generated text.

### 6.1 Authoring subset — `test/authoring/` (shared stack, → `ready_for_review`)

| Spec | Flow (over the BFF API, real services) | Seam proven |
|---|---|---|
| `auth_test.go` | no token → **401**; valid token → **200**; org-A token on org-B path → **404** (IDOR) | **real Thunder JWKS + tenant gate** |
| `projects_test.go` | create → get → list → delete; reject missing name (400) | JWT + gate |
| `requirements_test.go` | generate (agents) → save (`v1`) → edit → save → list versions → get-at-`v1` | JWT + gate + agents-service + git-service |
| `design_test.go` | requires `v1` → generate design → save (`v1-1`) → components present → list versions | JWT + gate + agents-service + git-service |
| `tasks_test.go` | generate `ComponentTask`s → dispatch → reaches `ready_for_review` (**stops; no merge/build**) | JWT + gate + GitHub (issue/branch/PR) + coding-agent dispatch |
| `webhook_test.go` | valid HMAC → 200; bad/missing signature → 401; duplicate `X-GitHub-Delivery` → deduped | **HMAC (no token)** + state machine |
| `health_test.go` | `/health` → 200 | none (ungated) |

### 6.2 Delivery subset — `test/delivery/` (throwaway stack, manual CI)

| Spec | Flow | Notes |
|---|---|---|
| `lifecycle_test.go` | **hello-world API** component: spec → tasks → dispatch → **merge PR** → webhook-driven `merged → building → deployed`, long-timeout poll | One scenario, end to end. **Hello-world keeps Anthropic + build cost low.** Teardown: delete project (cascade) + best-effort GitHub (issues/PRs/branches) + deployed-component cleanup |

Together these verify the whole spec-driven backend — project → requirements → design → tasks → webhook-driven transitions → `deployed` — with **no console involved**. Fan-out to agents-service / git-service / coding-agent is exercised transitively (no mocks).

---

## 7. Running & config

```bash
# bring up the canonical local stack
bash deployments/scripts/setup.sh && bash deployments/scripts/start.sh

# Level 1 · unit (service module; repo-root test/ module is outside it)
cd asdlc-service && make test

# Level 2 · authoring (shared stack, → ready_for_review)
cd test && ginkgo -v ./authoring/...                # → real BFF :9090  (ginkgo CLI; `go test ./authoring/...` also works)

# Level 2 · delivery (point at a SEPARATE/throwaway stack)
cd test && ASDLC_API_BASE_URL=http://<throwaway>:9090 ginkgo -v ./delivery/...
```

Add convenience targets (root or service `Makefile`): `test-authoring` (`cd test && ginkgo ./authoring/...`) and `test-delivery` (`cd test && ginkgo ./delivery/...`). All suites fail loud via `stack.go` if their stack is down. Config is env-driven (§4) so the same code runs against local compose, a throwaway CI stack, or a deployed cloud tier by changing `ASDLC_API_BASE_URL` + `THUNDER_TOKEN_URL`.

---

## 8. Harvesting the real values (Playwright CLI — a one-time tool step, not a test)

The framework gives the *shape*; the **actual assertion values + the exact token flow** come from observing a real run. This is done **once, by the implementer, using the Playwright CLI skill** as a harvesting tool — it produces values for the Go specs and is then discarded (no maintained backend browser tests). Once `test/framework/` exists:

1. Bring up the stack (`setup.sh` + `start.sh`).
2. Drive the console with the **Playwright CLI skill** as a real user (login admin/admin → create project → generate requirements → design → tasks → the hello-world deploy).
3. Tail `docker compose logs -f asdlc-api` alongside, and capture:
   - **The real Bearer token** the console sends (`Authorization` header) → decode to pin `iss`/`aud`/`OuHandle`/`sub`/scope and the **exact grant + client** `auth.go` replicates (resolves the §5 fork empirically).
   - **Real request/response shapes** (version tags `v1`/`v1-1`, component/task ids, status strings) → become the structural assertions in §6.
4. Encode the observed values into the `test/authoring/*_test.go` and `test/delivery/*_test.go` specs.

---

## 9. CI

Real-stack suites are **manual/scheduled**, never blocking PRs (they need k3d + compose + Thunder + Anthropic):

| Workflow | Trigger | Stack | Steps |
|---|---|---|---|
| **unit** (recommended add) | per PR | none | `cd asdlc-service && make test` (repo-root `test/` module excluded) |
| **backend-authoring** (new) | `workflow_dispatch` (+ optional nightly) | brought-up shared-style stack | `setup.sh` → `start.sh` → `cd test && ginkgo -v -p ./authoring/...` |
| **backend-delivery** (new) | `workflow_dispatch` | **fresh / throwaway** stack | `setup.sh` (clean cluster) → `start.sh` → `ginkgo -v ./delivery/...`; needs GitHub App + Anthropic secrets |
| **build** (existing) | per push | — | image builds (`build-images.yml`) — unchanged |

Agent suites that burn Anthropic stay env-gated where applicable.

---

## 10. Migration of the existing `tests/` tree

| Item | Fate | Why |
|---|---|---|
| `tests/api/*.test.ts` (vitest) | **retire → reimplement in Go** under `test/authoring/` | one black-box language, real-token, co-located at repo root |
| `tests/helpers/api-client.ts` | → `test/framework/client.go` (with auth + base `:9090`) | root cause of current 401s — sent no token; also fix the `:8080` default |
| `tests/helpers/architect.ts` (mint) | → `test/framework/auth.go` (port `client_credentials`) | reuse the mint as the starting `TokenProvider` |
| `tests/helpers/db-reset.ts` | **delete** | no truncate on shared stack; cleanup is per-spec |
| `tests/e2e/*.spec.ts` (Playwright) | **delete** | the future maintained browser layer (Level 3) lives under `console/`, freshly written; the CLI is harvest-only (§8) |
| `architect.test.ts`, `tech-lead.test.ts` (direct agents-service) | **delete** | covered transitively via the BFF generative flows (Phase 4); no separate direct-agent suite |

Net: the whole TS `tests/` tree is removed; coverage lives in the Go authoring suite (§6.1) + delivery suite (§6.2).

---

## 11. Relationship to `docs/design/testing.md`

`testing.md` is **superseded** where it conflicts:
- Its claim *"all tests run against the real stack, no mocked infrastructure"* is **true by design** for these suites — keep the compose/setup detail, re-scoped to the integration level.
- Replace its "Test Types" with the three levels in §1–§2 and the folder map (§3). Add a pointer: *"Headless backend testing (framework, auth, coverage) is specified in `docs/design/backend-testing.md`."*
- Update root `CLAUDE.md` "Testing" to: unit = `cd asdlc-service && make test`; authoring = `cd test && ginkgo ./authoring/...` (shared stack); delivery = `ginkgo ./delivery/...` (throwaway stack). No backend browser layer.

---

## 12. Implementation plan (handover)

Build order is deliberate: **pin the empirical moving parts first (Phase 0)**, then the framework, then specs outward from cheap/deterministic to the delivery lifecycle. Each phase below lists the **parts under test** so coverage is auditable. **Locked decisions:**
- **Levels** — 1 unit (exists) · 2 integration (this doc: `authoring/` + `delivery/`) · 3 e2e (future, frontend, `console/tests/e2e/`). "e2e" names only Level 3.
- **Language / location** — **Go**, a repo-root `test/` module, mirroring agent-manager `test/e2e/`.
- **Test lib** — **Ginkgo v2 + Gomega** (agent-manager parity); `RunSpecs` bootstrap per package, readiness in `BeforeSuite`.
- **No backend browser tests** — Playwright CLI is a harvest tool only (§8).
- **Auth** — pluggable `TokenProvider`; the exact grant + client is **pinned by the Phase-0 harvest**, not guessed.
- **Assertions** — **structural / contract only** (status, shape, version tags, presence) — never exact generated text.
- **Flow depth** — **authoring subset stops at `ready_for_review`** (no build/deploy); the **delivery subset** drives **one** full spec → `deployed` using a **hello-world API** on a **throwaway stack**.
- **Stack** — authoring = **shared local dev, no DB truncate**, self-cleaning; delivery = **fresh throwaway**.

### Phase 0 — Pin the moving parts (before any framework code)
Output: `test/OBSERVED.md`.
1. Bring up the stack; confirm `:9090`, Thunder, agents, smee, GitHub App live.
2. **Auth harvest (Playwright CLI skill):** log in (admin/admin), create a project, **capture the console's `Authorization: Bearer`** + decode (`iss`/`aud`/`OuHandle`/`sub`/scope) and the **grant + client_id** → what `auth.go` replicates.
3. **Shape harvest:** drive one full flow (incl. the hello-world deploy) with `docker compose logs -f asdlc-api` running; record response shapes, version-tag strings, component/task id + state values → the structural assertions.
4. Confirm delivery prereqs (disposable GitHub repo under the App, smee delivering, Anthropic key). Flag any missing one as a blocker.

**Parts under test:** none yet (observation only). **Pins:** token grant/client/claims · all assertion values · GitHub artifact names.

### Phase 1 — Framework skeleton (`test/`)
Init the repo-root module (`go.mod` + `replace ../asdlc-service`). Write `config.go`, `client.go` (Bearer + get/post/del + SSE), `stack.go` (readiness, fail-loud, no truncate), `auth.go` (pluggable provider = Phase-0 result, `ASDLC_API_TOKEN` override), `fixtures.go` (unique-name + cleanup; single stable test org), and the `authoring/authoring_suite_test.go` `RunSpecs` bootstrap whose `BeforeSuite` runs readiness.

**Parts under test:** stack readiness (`/health`, Thunder token endpoint), the auth attach path. **Acceptance:** `health_test.go` green; Bearer attached; no-token → 401; `cd asdlc-service && make test` unaffected.

### Phase 2 — Auth proof (`test/authoring/auth_test.go`)
no token → 401; valid → 200; org-A token on org-B path → 404 (IDOR).

**Parts under test:** `middleware/jwt` + `jwtassertion` (JWKS verify), the tenant/org gate (`ensureOrg`/`ResolveOuHandle`), Thunder JWKS. **Acceptance:** real JWKS + tenant gate proven headlessly.

### Phase 3 — Deterministic CRUD + versioning (no agents)
`projects_test.go`; requirements/design **versioning** asserted structurally (`v1`/`v1-1`, files present); generation may be seeded here to stay Anthropic-free.

**Parts under test:** project CRUD handlers + store, `ArtifactStore` read/write, git-service commit + `artifact_versioning.go` tag logic (`v<N>`, `v<N>-<M>`), input validation (400s). **Acceptance:** through design-versioning, self-cleaning.

### Phase 4 — Generative flows (real agents)
requirements / design / tasks **generate** via agents-service + Anthropic; assert shape + that artifacts/tasks were produced; honor SSE. `tasks_test.go` stops at `ready_for_review`.

**Parts under test:** BFF → agents-service fan-out (BA / Architect / TaskGen), SSE streaming endpoints, `ComponentTask`/`ComponentConfig` creation, GitHub issue+branch+draft-PR provisioning + per-task JWT, coding-agent dispatch (`WorkflowRun`), webhook transition `in_progress → ready_for_review`. **Acceptance:** generate-and-persist proven end to end (authoring subset complete).

### Phase 5 — Delivery lifecycle (`test/delivery/lifecycle_test.go`, throwaway stack)
Hello-world API: spec → dispatch → merge PR → webhook-driven `merged → building → deployed` (long-timeout poll). Teardown: delete project (cascade) + best-effort GitHub + deployed-component cleanup.

**Parts under test:** full webhook state machine (`ready_for_review → merged → building → deployed`), merge-handler build dispatch (pinned to merge SHA), build watcher (`WorkflowRun` poll → `build.{succeeded,failed}`), the `deployed` cascade hook (sibling-CORS re-emit + `env-config.js` + `on_hold` re-eval), OC client + ReleaseBinding. **Acceptance:** one project goes spec → `deployed` entirely over the API, no console.

### Phase 6 — Migration + CI
Remove the TS `tests/` tree (port helpers → `test/framework/`); add `Makefile` `test-authoring` / `test-delivery`; add the `workflow_dispatch` CI jobs (§9) — delivery job spins a fresh stack.

**Parts under test:** the suites themselves run in CI. **Acceptance:** `make test` unaffected; `backend-authoring` + `backend-delivery` jobs green on dispatch.

### Prereqs
| Need | For | Source |
|---|---|---|
| Shared stack (`:9090`, Thunder, agents, smee) | authoring suite | `deployments/` |
| Anthropic key | Phase 4 generation + hello-world deploy | `.env` |
| GitHub App + disposable repo + smee relay | delivery suite | `.env` `GITHUB_APP_*` |
| Throwaway stack | delivery suite | CI (fresh `setup.sh`) |
| Pinned token flow | auth | Phase-0 harvest |

### Resolved in Phase 0 — no guessing in code
Exact grant + client_id · whether the token carries `OuHandle` · version-tag strings · response shapes · component/task id + state values · GitHub artifact names for cleanup.

### Deviations log
Divergences found during implementation (2026-06-28). Full values in `test/OBSERVED.md`.

**Auth (§5 fork resolved):**
- The headless `client_credentials` flow **is sufficient** — no console OIDC/user token needed. But the token client is **`asdlc-api-client`** (the BFF's own service identity, bound to the OpenChoreo `admin` role via `ClusterAuthzRoleBinding` on `sub=asdlc-api-client`), **not** the `asdlc-bff-to-agents-service` SA the framework first defaulted to. That SA passes the tenant gate (carries `ouHandle`) but **403s on writes** — authz is OC-side on the forwarded JWT's `sub`/`groups`, not an OAuth scope. Framework default updated.
- Thunder **rejects ROPC** (`grant_type=password`), so there is no headless *user* token path; the `Administrators`-group route is browser-only and unneeded.

**Response shapes (§6.1):**
- Validation failure returns **422** (Huma), not `400` as the table said. Spec asserts 422.
- Every response body carries a Huma **`$schema`** field; list is `{"$schema":…,"items":[…]}`.
- **Delete is async** — `DELETE` returns `204` but a `GET` immediately after still `200`s (OC namespace termination). The spec polls with `Eventually(…).Should(404)` rather than asserting an immediate 404.

**Harvest method (§8):**
- **Playwright not used.** The headless token flow made a browser run unnecessary; the token + all shapes were pinned by direct API probing (more authoritative, repeatable in-suite). Playwright stays available for a future user-token path.

**Toolchain (§2):**
- `test/go.mod` declares **`go 1.23.0`** with **Ginkgo v2.22.2 / Gomega v1.36.2** (not 2.28.3) to match the locally-installed go1.23 and avoid a toolchain download (the service module's `go 1.26` only builds in Docker). Parity is *Ginkgo v2 + Gomega*, held.
- The optional `replace ../asdlc-service` import is **deferred**; the framework defines minimal local DTOs so the test module builds standalone (the service module needs go 1.26).

**Status (2026-06-28):**
- **Phases 0–4 complete and green.** Authoring suite = **12 specs** (health, auth×3, projects×2, webhook×3, generative×3). `cd test && make authoring` passes; fast subset via `--label-filter='!generative'`. Secrets (Anthropic + GitHub PAT) connected to the `default` org via `deployments/scripts/seed-dev.sh`.
- **Phase 4 deviation:** the three §6.1 generative concerns are **one Ordered chain** over a single project (`generative_test.go`, Label `generative`) — steps depend on each prior save, so one project = 1× Anthropic + GitHub cost. Generation is SSE (`framework.ConsumeSSE`, done on `data-finish`). Version surfaces as an **int** (`version:1`) with the git tag in `tagName` (`v1`, `v1-1`).
- **Phase 5 complete and green.** `cd test && make delivery` (with `ASDLC_GITHUB_PAT` set) = **5/5 specs** in ~13 min: generate spec→design→tasks → dispatch (pending→in_progress) → coding-agent opens PR (ready_for_review) → merge PR → merged→building → **deployed**. Run on a fresh full teardown/setup stack. Pinned shapes (`test/OBSERVED.md`): dispatch is a bodyless POST → `[{taskId,componentName,runName,status:"running"}]`; the task `status` field is the lifecycle (`pending→in_progress→ready_for_review→building→deployed`; `merged` is transient — status reads `building` right after merge); `pullRequestNumber` set at ready_for_review; the suite merges the PR via the GitHub API (PAT). Timings: dispatch→ready_for_review ~6-8 min, merge→deployed ~3-4 min.
- **Phase 6 done:** the TS `tests/` tree is removed, CLAUDE.md updated, `test/Makefile` + `.github/workflows/backend-{authoring,delivery}.yml` added.
- **Two async deviations** required `Eventually` polls instead of immediate asserts: project delete (204 then GET 200 for a beat) and dispatch (returns `running` but task flips to `in_progress` a beat later).
- One-time env recovery was needed (post-sleep). The durable fix was a **full teardown + fresh `setup.sh`** (preserving `.env`+keys) after restarting Colima with explicit DNS (`--dns 8.8.8.8`) — `setup-k3d.sh` has its own node-DNS fix, so the fresh cluster pulled cleanly and OpenBao reseeded itself. Infra, not test design.

---

## 13. Summary

- **Three levels, "e2e" reserved for the frontend:** Level 1 unit (`asdlc-service/**/*_test.go`, exists) · Level 2 integration (this doc, backend over HTTP, **no browser**) · Level 3 e2e (future Playwright under `console/`).
- **One direction for Level 2:** test the whole backend headlessly, against the **real stack**, with a **real token** and **real clients** — no mocks, no in-process Go harness, no browser.
- **Go, repo-root `test/` module, Ginkgo v2 + Gomega:** mirrors agent-manager's `test/e2e/`; folder-isolated from the unit run (no build tags); `replace ../asdlc-service` for typed DTOs.
- **Two subsets, folder + stack reflect the lifecycle split:** `test/authoring/` = project→tasks on the **shared stack** (stops at `ready_for_review`); `test/delivery/` = one full spec→`deployed` lifecycle on a **hello-world API** against a **throwaway stack** (manual CI, low cost).
- **Framework first, values second:** build `test/framework/`, then harvest the real token flow + assertion values via a one-time Playwright-driven run + logs (§8), then write the specs.
