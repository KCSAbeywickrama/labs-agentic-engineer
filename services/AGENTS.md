# AGENTS.md — services/

| New | Tech |
|---|---|
| `aep-api/`| Go BFF + GitHub webhooks (git ops folded in) |
| `agents/` | TS interactive spec agents (Vercel AI SDK) |
| `collab/`|  TS Yjs collaboration server |

## Conventions

- Config/env parsing in one place per service; add every var to `.env.example`.
