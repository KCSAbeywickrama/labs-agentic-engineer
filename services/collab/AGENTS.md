# AGENTS.md — services/collab (`@aep/collab`)

Yjs collaboration server for spec files —
[#86](https://github.com/wso2/labs-agentic-engineer/issues/86). Hocuspocus
(`Server` from `@hocuspocus/server`) hosting one room + one Y.Doc per project
(room `spec-<org>-<project>`, `Y.Map('files')` of file-path → `Y.Text`).

**Read #86 (body + design comments) before changing anything here** — the
truth model (doc live / repo durable), persistence tiers, and agent write
path are all decided there.

## Trust model

This service verifies nothing itself. Room access is delegated whole to the
BFF oracle (`validate-collab-access`: JWT + tenancy + project ownership) —
the room ID is *shape-checked only* (`room.ts`) because `spec-<org>-<project>`
cannot be split without the org from the caller's token. Seeding reads the
spec bundle **as the first joiner** (their token); the `project` ws request
parameter names the project for that read.

## Modes

- **Dev mode** (`COLLAB_DEV=1`, implied when no BFF at all): oracle bypassed,
  rooms seed from `fixtures.ts`. The auth/seed code paths are NOT exercised.
- **Mock BFF** (`COLLAB_MOCK_BFF=1`): an embedded stand-in for the BFF
  (`mockbff.ts`) serves `validate-collab-access` + `get-project-spec` from
  the same fixtures, and the service runs its **real** auth and seed paths
  against it. Token `deny` exercises the rejection path; a JWT-shaped token's
  `name`/`email` claims become the identity.
- **Real BFF**: set `AEP_API_BASE`.

Never enable dev mode or the mock BFF in a cluster.

## Persistence + ops (shipped)

- **Committer**: quiet-period flush (`COLLAB_COMMIT_DEBOUNCE_MS`, default 60s)
  commits via the BFF `files/apply`; `COLLAB_COMMIT_MAX_DEBOUNCE_MS` caps
  continuous editing. Last-leave and shutdown also force a flush.
- **D6 token freshness**: clients push refreshed JWTs over the stateless
  channel; on apply 401/403 the server may pull once via `token-please`.
  Residual: a last-leave forced flush often has no client for pull — exposure
  stays the ≤60s debounce window.
- **Health**: `GET /healthz` → 200 `ok`. Helm: replicas **1**, probes on
  `/healthz`, 512Mi memory, `terminationGracePeriodSeconds: 30`, concurrent
  shutdown flush (pool 8).

## Env

| Var | Default | Meaning |
|---|---|---|
| `COLLAB_PORT` | `8091` | ws listen port |
| `AEP_API_BASE` | unset | BFF base incl. prefix, e.g. `http://localhost:9090/api/v1` |
| `COLLAB_DEV` | off | force dev mode (implied when no BFF, real or mock) |
| `COLLAB_MOCK_BFF` | off | run the embedded mock BFF; overrides `AEP_API_BASE` |
| `COLLAB_MOCK_BFF_PORT` | `8092` | mock BFF listen port |
| `COLLAB_COMMIT_DEBOUNCE_MS` | `60000` | quiet period before a flush commits |
| `COLLAB_COMMIT_MAX_DEBOUNCE_MS` | `300000` | max wait during continuous editing |

Commands: uniform verbs via the root `Makefile`; locally
`pnpm --filter @aep/collab dev|test|lint|typecheck`.
