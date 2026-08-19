# ADR-0020 — Agent conversation memory is server-held behind a store-shaped contract

**Status:** Accepted

## Context

A generated `ai-agent` component's conversation history lives behind the
agent, not in the caller. The caller — a generated web app, the console's Test
tab, or any other client — holds only the `conversationId` it was issued and
its own rendered transcript; it never assembles, inspects, or replays a
message array. This ends the class of bug where a caller mishandles the
history it is responsible for: the wire no longer carries one.

## Decision

**`POST /chat`** is the entire wire contract, for every `ai-agent`:

```
in:  { conversationId?: string, message: string }
out: { conversationId: string, text: string, toolCalls: unknown[] }
```

An omitted or unknown `conversationId` starts a new conversation and returns
its id. `text` is what a UI renders; `toolCalls` is what a test asserts on. No
`messages` array crosses the wire in either direction, in either request or
response.

Conversations are keyed by (`conversationId`, gateway-injected `x-user-id`).
Every store statement — read and write alike — is scoped by that user id. A
request for a `conversationId` that does not exist, or that belongs to a
different user, answers **404**, never 403: a 403 would confirm the id exists,
which is exactly the information a foreign or guessed id must not get back.

The AFM declares the capability: `x-aep: memory: { type: "server" }` (the
`client` type remains valid for designs that predate this decision). The
generated agent reaches its store through a `postgres-cnpg` platform-resource
dependency, declared in `design.json` like any other platform resource:

```json
{ "kind": "platform-resource", "name": "memory-db", "resourceType": "postgres-cnpg" }
```

The dependency is **dedicated to the agent by default**. A design may instead
share the project's existing Postgres by giving the dependency the **same
name** a sibling component already uses — the ordinary `thunder-app`
same-name sharing rule, not new platform machinery. Either way, the agent owns
its `conversations` table exclusively: no sibling reads or writes it, and the
agent touches nothing else in a shared instance. Sharing a Postgres process is
permitted; sharing data ownership is not — a shared instance is not licence to
reach into another component's tables, and the platform's data-ownership rule
holds at table granularity regardless of which physical database a table
lives in.

Full reasoning, the rejected alternatives, and the schema and turn-flow
prescribed to the generated agent are recorded in
`docs/superpowers/specs/2026-08-18-agent-server-memory-design.md`. The
console's Test tab chat tester, the first caller built against this contract,
is specified in
`docs/superpowers/specs/2026-08-18-component-test-tab-design.md`.

## Consequences

- Every caller of an `ai-agent` — generated web apps, the console Test tab,
  anything else — is symmetric: hold an id, render a transcript, never touch
  a message array. A caller cannot reintroduce the old failure mode because
  the contract gives it nothing to mishandle.
- Conversation storage is **per-agent** (or per-project, where a design shares
  the dependency by name): each `ai-agent` with server memory owns a
  `conversations` table in a Postgres it either has to itself or shares with
  named siblings. This is a recorded, permanent design point for agents
  built this way, not a stage awaiting consolidation on its own timeline.
- The recorded end state for the platform overall is a single
  conversation-store service with one database per org, replacing per-agent
  direct access outright. That store is not built by this decision; its
  trigger is the point at which agent code stops being able to own
  persistence, user fencing, schema migration, and cross-agent operations
  (retention, delete-my-data) itself — because that code is generated per
  build and those concerns need to live in code the platform owns, once,
  outside any single agent's trust domain. The full option analysis for that
  service (rejected shared-DB and per-project-DB shapes included) is in the
  design spec above; this ADR does not reproduce it.
