---
name: agent-design
description: Use when creating or editing an agent.afm.md for an ai-agent component — writing the agent's role and instructions, choosing which of a dependency's operations it may call, and declaring its model and interface.
metadata:
  aep:
    kind: platform
    audience: [design]
---

# Agent definitions (AFM)

Every `ai-agent` component gets ONE definition at
`specs/design/components/<name>/agent.afm.md` — YAML front matter plus a
markdown body, in [Agent-Flavored Markdown](https://github.com/wso2/agent-flavored-markdown).

**This document IS the agent.** The coding agent implements it the way a service
implements its `openapi.yaml`: the body becomes the system prompt verbatim, and
the allow-list becomes the only operations the model can reach. Write it as the
contract a reviewer approves, not as notes for an engineer.

Its sibling `design.json` owns the wiring — dependencies, exposure. Never repeat
those here.

## The shape

```markdown
---
spec_version: "0.4.0"
name: "lunch-buddy"
description: >
  One sentence: who it helps and with what.
max_iterations: 12

model:
  provider: "anthropic"            # REQUIRED — see below
  name: "${env:MODEL_NAME}"
  url: "${env:MODEL_ENDPOINT}"
  authentication:
    type: "api-key"
    api_key: "${env:MODEL_API_KEY}"

interfaces:
  - type: webchat
    exposure:
      http:
        path: "/chat"

x-aep:                             # everything AFM does not define
  tools:
    openapi:
      - component: "lunch-api"     # a `component` dependency in design.json
        baseUrl: "${env:LUNCH_API_URL}"
        allow: [listRounds, getRound, listItems, addItem]
  memory:
    type: "server"
  identity:
    mode: "on-behalf-of"
---

# Role
# Instructions
# Style
```

**AFM's own keys are `model`, `interfaces`, `tools.mcp`, `skills`,
`max_iterations`. Everything else goes under `x-aep`** — no exceptions. One rule
means a reader can tell ours from the spec's by looking, and a future AFM version
defining its own `tools.openapi` costs a rename rather than a migration.

**Never write a literal address or credential.** Use `${env:NAME}` and let the
platform inject the value: a dependency named `lunch-api` in `design.json`
yields `LUNCH_API_URL`. `MODEL_*` needs no dependency at all — every `ai-agent`
component gets model access from its component type, on the organisation's own
key. `specs/` is committed to git.

**`model.provider` is required** — `anthropic` unless the requirements say
otherwise. It decides which SDK the build compiles against, and it cannot be
inferred from `url` or `name`. Omit it and the build guesses.

## Writing the body

Three sections, and every line of them reaches the model.

**`# Role`** — two or three sentences: who it serves, what it does for them, and
what it explicitly does not do. The last part matters most; an agent with no
stated edges will try anything.

**`# Instructions`** — the procedure, as bullets. Write only what changes
behaviour:

- **Order of operations** — *"Find the open round before doing anything else."*
- **Confirmation before writes** — *"Read the item back and get a clear yes
  before you add it."* This is the single highest-value instruction in most
  agents: it turns a misheard request into a question rather than a wrong record.
- **What to do when it doesn't know** — *"If they don't give a price, add the
  item without one rather than inventing a number."* Absent this, models fill
  gaps.
- **Honesty on failure** — *"When a tool call fails, say plainly what failed.
  Never claim an order went in when it did not."*

**`# Style`** — length and tone in one or two lines. Be concrete: *"Short and
practical. One or two sentences."*

Write for the model, not for a reader: no background, no rationale, no "please".

## Choosing what it may call

`allow` names operations from the dependency's committed `openapi.yaml` — by
`operationId`, and it is the security boundary. An operation left out is not
generated as a tool, so no phrasing can reach it.

**Never write a path to that contract.** `component:` names it, and its location
is fixed: `specs/design/components/<component>/openapi.yaml`. A path field is
one more thing to get wrong and to drift.

**Read the contract before writing the list.** Every entry must be an
`operationId` that document actually defines — a name you assumed is a tool the
agent will never have, discovered at build time or later.

The platform checks this at design-save: an `allow` entry that is not an
`operationId` of that component's contract, or a `component` that is not a
declared dependency, computes **unresolved**.

**Include** what the agent's job needs, and nothing more.

**Leave out**, by default:

- anything **irreversible or wide-blast** — closing a round cuts off everyone,
  deleting a record cannot be undone by asking nicely
- anything **another role owns** — an admin or opener action is not the
  conversation's to take
- anything the agent has **no way to judge** — settlement figures, billing,
  anything a mistake is expensive in

**A refusal that matters must be enforced by omission, not by prose.** *"Never
close the round"* in `# Instructions` is a strong hint; leaving `closeRound` out
of `allow` is a guarantee. Use the instruction for tone and the allow-list for
control.

**Do not restate the provider's own rules as instructions.** If `lunch-api`
already rejects edits to someone else's item, the agent does not enforce that —
the provider does, on the caller's identity. Say what the agent should *tell the
user* about it, not what it should check.

## Interfaces

`webchat` unless the requirements say otherwise — an HTTP endpoint a web app
calls, which is the only interface the platform carries today. `webhook` and
`platformchat` are defined by AFM but not yet supported here; do not declare one
without confirming it is.

## Memory

`server` unless the requirements say otherwise: the agent keeps the
conversation in its own store, and the caller holds only a conversation
identifier — history never crosses the wire. Declare it and nothing else —
where the store lives is the design.json's `postgres-cnpg` platform-resource
dependency (the `architecture` skill), and how it is used, including the wire
shape, is fixed by `agent-building`. `client` remains valid for an agent whose
caller genuinely owns the transcript (rare; say why in the description).

## Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| The agent does something the design forbade | The prohibition was prose only | Remove the operation from `allow` |
| Build guesses the wrong SDK; every turn fails on a real key | `model.provider` omitted | State it — `anthropic` unless told otherwise |
| A credential or address is committed to git | A literal in the front matter | `${env:NAME}`, injected from the dependency |
| The agent invents values the user never gave | No instruction for the unknown case | Say what to do when a field is missing |
| The agent claims success after a failed call | No honesty instruction | *"Never claim it worked when it did not"* |
| Behaviour and the design disagree after a change | The prompt was edited in the component's code | The document is the contract; edit here and regenerate |
| Instructions read like documentation | Written for a human reviewer | Every line must change what the model does |
