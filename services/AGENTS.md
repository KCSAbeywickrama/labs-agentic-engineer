# AGENTS.md — services/

| New | From | Tech |
|---|---|---|
| `aep-api/` | `asdlc-service/` | Go BFF + GitHub webhooks (git ops folded in) |
| `agents/` | `agents/` | TS interactive spec agents (Vercel AI SDK) |
| `collab/` | `collab-server/` | TS Yjs collaboration server |

## Conventions

- Config/env parsing in one place per service; add every var to `.env.example`.
