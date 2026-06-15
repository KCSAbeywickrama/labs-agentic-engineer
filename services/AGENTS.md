# AGENTS.md — services/

Long-lived deployables (polyglot). One package per service; `services/<name>`.

**Status:** empty bucket. Ported in one at a time (`plan.md` §10):

| New | From | Tech |
|---|---|---|
| `aep-api/` | `asdlc-service/` | Go BFF + GitHub webhooks (git ops folded in) |
| `database/` | `database-service/` | Go data service |
| `agents/` | `agents/` | TS interactive spec agents (Vercel AI SDK) |
| `collab/` | `collab-server/` | TS Yjs collaboration server |

## Conventions

- Layering, no skipping: **routes → domain → repositories**. Routes are thin.
- Go modules join `go.work`; TS services join the pnpm workspace.
- Config/env parsing in one place per service; add every var to `.env.example`.
- Each service owns the OpenAPI it produces in `packages/contracts/<service>/`.
