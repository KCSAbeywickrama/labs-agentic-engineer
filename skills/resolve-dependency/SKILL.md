---
name: resolve-dependency
description: Use for taking one external dependency from open to resolved — `/resolve-dependency <name>` names it; `/resolve-dependencies` walks every open one in turn. Choose the provider, get its contract on disk (found, uploaded, or assumed with the user's permission), settle the config keys.
metadata:
  aep:
    kind: platform
    audience: [design]
---

# Resolve a dependency

One external dependency, taken from whatever state it is in to **resolved**:
a chosen provider, a committed contract in its own directory, and the config
keys every consumer codes against. The instruction names the dependency — the
one the user clicked **Resolve** on. `/resolve-dependencies` (plural, no name)
walks every dependency that is still open, one at a time, in the order the
Build drawer lists them, and ends with the list empty or with what is left
named plainly.

`architecture` owns the definition's shape and the research playbook; this
skill is the guided flow over it. `grilling` owns the question mechanics.
Everything you write goes to `specs/design/dependencies/<name>/` — never to a
component's `design.json`, which only references the dependency by name.

## Read the state first

Read `specs/design/dependencies/<name>/dependency.json` from the snapshot and
say, in one line, where it stands:

| On disk | State | This flow's job |
|---|---|---|
| `candidates` (2+) | ambiguous | choose the provider |
| no `provider`, no `style`, no `candidates` | needs-input | identify the system |
| `provider` + `style`, no `contract` (or no `sdk` for style `sdk`) | needs-contract | get the contract |
| contract on disk, `assumed` absent, contract marked assumed | needs-acceptance | ask the user to accept |
| contract on disk | resolved | nothing — say so and stop |
| `source: "org"` | registered | nothing — the org record owns it |

Do the steps below in order, skipping the ones the state has already passed.
Each step is at most one `ask_question`; a `/resolve-dependencies` walk asks
them per dependency, never as one batch across dependencies — the user
answers one system at a time.

## 1. Choose the provider

With `candidates`, put the choice to the user: each candidate with the one
distinction that matters for THIS product, your recommendation marked, and
"another system" as a free-text option. With nothing identified, ask what the
system is and how it authenticates. A real signal (the requirement names it, a
Registered External resource fits, an org skill mandates it) lets you choose
without asking — say which signal.

Write the choice: `provider` and `style` set, `candidates` removed. For a
Registered External resource, write only `{ "name", "source": "org" }` — the
platform fills the rest at save, and no contract step follows.

## 2. Get the contract

Three routes, tried in this order, and the user is told which one you took:

1. **Find it.** `web_search` for the provider's published OpenAPI or GraphQL
   document. Name the operations the design actually calls (the flows and
   the component's description say which) and call `slice_openapi_spec` with
   the URL and those operations. It fetches the whole document outside your
   context, cuts the slice, validates it, and returns the slice with its
   provenance. `addFile` the slice as `openapi.yaml` in the dependency's
   directory and record `contract` plus the `provenance` block the tool
   returned. If you cannot name the operations, you do not understand the
   dependency well enough to slice it — go back to the flows before asking
   the user for anything.
2. **Ask for it.** When no public document exists (most couriers, most
   private APIs), ask ONE question: whether the user can provide the document
   — as a URL, or by uploading it on the dependency page — or would rather
   proceed on your assumption. Say what a document from them buys (the
   validation checks run against it) and what an assumption costs (the
   coding agent builds to a guess you will name).
3. **Assume it, with permission.** Only when the user chose that option.
   Write the contract yourself from the provider's documentation pages and
   what you know — the operations the design needs and nothing more — as
   `openapi.yaml` in the dependency's directory, with `x-aep-assumed: true`
   at the document root and, in the `info.description`, a short note of what
   you are unsure about (auth scheme, pagination, error shapes). Record
   `contract` and a `provenance` block with `sourceUrl` naming the
   documentation you read. Then tell the user the contract is written and
   waits for their acceptance on the dependency page — you cannot write the
   `assumed` record; only they can. The dependency stays needs-acceptance
   until they do.

An `sdk` style needs its manifest too: write `sdk.json` with a `packages`
entry for every implementation language the design's components use (the
ecosystem-prefixed identifier the provider publishes), the docs URL, and the
calls the design relies on; set `"sdk": "sdk.json"`. Put the API slice beside
it when the provider has one — without it the dependency is SDK-only, and
you say so.

## 3. Settle the config keys

Derive `config` from the contract — a REST API's `securitySchemes`, an SDK's
constructor arguments — following the `architecture` skill's conventions
(SCREAMING_SNAKE_CASE, `secret` only for credentials, a `description` saying
where the user finds the value). Keys already on the file stay unless the
contract contradicts them.

## Close

One line per dependency you touched: its name, the state it is in now, and
the one thing (if any) still needed from the user — "accept the assumption on
the dependency page", "upload the document". Nothing else: the files carry the
detail, and the Build drawer re-reads them.
