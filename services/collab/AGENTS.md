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

## Dev mode

`COLLAB_DEV=1` — or simply no `AEP_API_BASE` — bypasses the oracle and seeds
rooms from `fixtures.ts` (mirrors the console mock layer's demo-shop).
Never enable in a cluster.

## Env

| Var | Default | Meaning |
|---|---|---|
| `COLLAB_PORT` | `8091` | ws listen port |
| `AEP_API_BASE` | unset | BFF base incl. prefix, e.g. `http://localhost:9090/api/v1` |
| `COLLAB_DEV` | off | force dev mode (implied when `AEP_API_BASE` unset) |

## Phase status (#86)

- Phase 1 (this): rooms, oracle auth hook, lazy seed, dev mode. **No
  persistence** — docs live only while a room has connections
  (`unloadImmediately: true`); the seed is the recovery story.
- Phase 3 adds the committer worker (disk flush ~30s, GitHub commit at
  session end / max age) — replaces the no-persistence stance.

Commands: uniform verbs via the root `Makefile`; locally
`pnpm --filter @aep/collab dev|test|lint|typecheck`.
