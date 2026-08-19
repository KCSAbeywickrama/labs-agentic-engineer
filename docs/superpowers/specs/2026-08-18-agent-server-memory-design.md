# Agent server memory — design

**Status:** approved in conversation, 2026-08-18.
**Scope:** first cut of server-side conversation memory for generated `ai-agent`
components: per-agent database, direct access, store-shaped wire contract.
**Relates to:** `2026-08-18-component-test-tab-design.md` (sequenced AFTER this —
the Test tab's chat tester consumes the contract defined here).

## Problem

Generated agents declare `memory: { type: "client" }`: the caller holds the full
conversation and echoes it back every turn. That contract already shipped one
silent product bug (the webapp rendered an empty transcript off a 200), it makes
every caller responsible for state it cannot inspect, and a page refresh loses
the conversation. The team decided conversation history moves server-side.

## Decisions (made in conversation, with alternatives rejected)

| # | Decision | Why / rejected alternatives |
|---|---|---|
| D1 | **Server memory**: conversation history lives behind the agent, not in the caller. | Ends the class of bug where callers mishandle the history array — the wire no longer carries one. |
| D2 | **First cut: the agent gets a Postgres via a platform-resource dependency and accesses it directly. No store service yet.** Dedicated instance by default; **sharing the project's instance is a design-time choice made by dependency naming** (same name as the sibling → same instance, the `thunder-app` sharing rule). | Cheapest real first cut: the `postgres-cnpg` ClusterResourceType exists and platform-resource wiring is fully generic (`derive_wiring.go` stamps any resourceType's catalog outputs), so provisioning + env injection need **zero Go changes** — for either form. Team decision (2026-08-19): the skill states the NEED ("an agent with server memory needs a Postgres") and leaves dedicated-vs-shared to the design/org; what stays fixed is the contract, the prescribed persistence code, and table ownership (D2a). Rejected for the first cut, not forever: the platform conversation-store (D5). |
| D2a | **Shared instance ≠ shared tables.** In a shared Postgres the agent's `conversations` table is exclusively its own; no sibling reads or writes it, and the agent touches nothing else in that instance. | This is what keeps the shared form from collapsing into rejected option 4: what was wrong there was components reaching into each other's data, not sharing a Postgres process. Component data ownership holds at table granularity. |
| D3 | **The wire contract is store-shaped from day one** (see Contract). Callers never see storage. | This is the load-bearing discipline: moving to the store later becomes a skill edit + rebuild, never a contract migration across webapps/console. |
| D4 | **Storage is durable — `postgres-cnpg`.** REVISED 2026-08-19 after syncing upstream: the cluster installs `postgres-cnpg` (a CloudNativePG `Cluster` with a PVC) and does NOT install the emptyDir `postgres` type at all. A design naming `postgres` would reference a resource type that does not exist. | The accepted "restart = amnesia" limitation is therefore GONE — conversations survive pod restarts. Cost: `postgres-cnpg` outputs `host`/`port`/`dbname`/`user`/`password` rather than a single `url`, so the prescribed store composes its own DSN. |
| D5 | **End state (recorded, not built now): one platform conversation-store service, one database per org.** | Full option analysis done in conversation: (1) store + one shared DB — rejected: all orgs' conversations logically separated only, wrong for end-user data; (2) store + per-project DB shared with project services — rejected: dual-ownership databases, migration fan-out; (3) per-agent DB direct — accepted as first cut only (this doc); (4) per-project DB, no store — rejected: breaks component data ownership. The store exists because agents' code is *generated per build*: persistence, user fencing, schema migration, and platform-wide operations (retention, delete-my-data) must live in code the platform owns, one version, outside the agent's trust domain. Org is the isolation line because it is already the platform's trust boundary (keys, Thunder OUs). The design agent's own store (`services/agents/src/store/`) is the proven prototype: same JSONB aggregate, same load-append-save, same org fence — this feature's end state is that store, extracted and given an end-user fence. |
| D6 | Memory is a **capability, not a declared dependency choice** — but the first cut's DB IS declared. | AFM gets `memory: { type: "server" }`. In the first cut this pairs with an explicit `postgres-cnpg` platform-resource dependency in design.json (that is how provisioning works today). When the store lands, the dependency disappears and the capability is granted by component type, exactly like model access (ADR-0016). |

## Wire contract — `POST /chat` (v2, replaces the client-memory shape)

```
in:  { conversationId?: string, message: string }
out: { conversationId: string, text: string, toolCalls: unknown[] }
```

- Omitted/unknown `conversationId` → the agent creates a conversation and
  returns its id. The caller stores **only the id**.
- `text` is what a UI renders; `toolCalls` is what a test asserts on. No
  `messages` array crosses the wire in either direction — the failure class the
  old contract enabled cannot recur.
- Conversations are keyed by (`conversationId`, `x-user-id`). A request for a
  conversation owned by a different user is a **404** (not 403 — do not confirm
  the id exists).
- `GET /healthz` unchanged. No list/history endpoints in the first cut — the
  caller renders its own transcript from the turns it makes; recalling an old
  conversation's rendered history is a store-era feature.
- Auth unchanged: 401 without gateway-injected `x-user-id`; bearer forwarded to
  tool providers as today.

## First-cut mechanics

### design.json (authored by `architecture` skill)

The skill states the need — *an `ai-agent` with server memory needs a Postgres
for its conversation store* — and the design declares it one of two ways:

```json
// default: dedicated instance for the agent
{ "kind": "platform-resource", "name": "memory-db", "resourceType": "postgres-cnpg" }

// org/user prefers one instance: SAME dependency name as the sibling service
{ "kind": "platform-resource", "name": "project-db", "resourceType": "postgres-cnpg" }
```

Same-name resolution to one shared instance is the existing `thunder-app`
sharing mechanism — no new platform machinery. `postgres-cnpg` emits no `url`
output; generic wiring injects its five catalog outputs as `<NAME>_HOST`,
`<NAME>_PORT`, `<NAME>_DBNAME`, `<NAME>_USER`, `<NAME>_PASSWORD` — the skill
teaches composing the pool config from all five. No aep-api changes. The
generated code is IDENTICAL in both forms; only the env var prefix differs.

### agent.afm.md (authored by `agent-design` skill)

```yaml
x-aep:
  memory:
    type: "server"
```

`agent-afm-schema.ts` (and the Go gate mirror `afmgate.go`) extend the `memory`
enum: `"client" | "server"`. `client` remains valid — existing designs keep
working; the skills switch the default guidance to `server`.

### Generated agent (taught by `agent-building` skill)

The skill PRESCRIBES the persistence code — schema and queries appear verbatim
in the skill so the coding agent copies rather than invents:

- One table: `conversations(id uuid pk, user_id text not null, messages jsonb
  not null, created_at, updated_at)` — the design agent's proven aggregate
  shape. `CREATE TABLE IF NOT EXISTS` at startup (single table, idempotent; a
  real migration story arrives with the store).
- Turn flow: load by (`id`, `user_id`) → append user message → `generateText`
  → append trail → save. Append-only (stable prompt-cache prefix).
- **Every read and write is scoped `WHERE user_id = $x_user_id`. Stated as the
  security boundary in the skill, with its own pitfall row.**
- Dependency: `pg`. `MEMORY_DB_HOST`, `MEMORY_DB_PORT`, `MEMORY_DB_DBNAME`,
  `MEMORY_DB_USER`, `MEMORY_DB_PASSWORD` read at startup; `/healthz` reports
  whichever of the five are unset in its `missing` list, per the existing
  config pattern.

### Callers (taught by `react-webapp` skill; Test tab follows)

Replace the "render text / store messages" guidance: the caller holds
`conversationId` + its own rendered transcript `{role, text}[]`. Send
`{conversationId, message}`; append `text` on reply. "New conversation" =
drop the id. The UIMessage/ModelMessage normalisation guidance is retired from
the caller side (nothing to normalise — no array on the wire); the agent-side
normalisation section is superseded by the new turn flow.

## Accepted limitations (first cut, all resolved by the store or the platform)

| Limitation | Resolution path |
|---|---|
| User fencing lives in generated SQL | Store enforces it platform-side (D5) |
| One Postgres pod per agent (~200–300 Mi node cost each), unless shared | Store consolidates to one DB per org |
| Shared instance: agent + services share restart/resize blast radius | The org's accepted trade when choosing the shared form; store removes it |
| No cross-agent platform surface (retention, delete-my-data) | Store API (D5) |
| Schema changes require regenerating agents | Store owns the schema |

## Testing

- **Schema/gate**: `agent-afm-schema` accepts `server`, rejects unknown types;
  Go gate mirror stays in lockstep (existing mirror tests extended).
- **Contract pin**: extend `services/agents/test/agent-chat-contract.test.ts`
  style — a test that drives the prescribed turn flow (mock model, in-memory pg
  substitute or the real query text) asserting: new conversation returns an id;
  second turn with the id sees the first turn's trail; a different `user_id`
  gets 404-shaped denial.
- **Skill-level proof**: build a real project; verify the five `MEMORY_DB_*`
  vars resolve in the pod, `hi` → follow-up turn remembers, refresh keeps the
  conversation (same id), and a pod restart KEEPS it — the store is
  PVC-backed (D4).
- PR carries proof of real execution per repo guidelines.

## Out of scope

The conversation-store service and per-org DBs (D5 — recorded end state).
Durable volumes. Conversation listing/history UI. Summarisation/retention.
Agent-to-agent memory. Changes to the design agent's own store.

## Docs to update when shipped

`skills/agent-design`, `skills/agent-building`, `skills/react-webapp`,
`skills/architecture` (the dependency stanza); `packages/agent-stream` schema +
`agentfold` gate; Test tab spec's chat-tester section (consume this contract);
ADR: "agent memory is server-held behind a store-shaped contract" (final-state
wording per repo doc rules).
