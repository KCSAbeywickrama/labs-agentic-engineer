# ADR-0027 — One external dependency, one definition, with its contract beside it

## Status

Accepted. Supersedes ADR-0010 in part (the contract a design commits to).
ADR-0003 (read-time resolution) and ADR-0023 (values are a deploy gate) stand.

## Context

An external dependency used to be defined on every component that consumed it:
`style`, `specPath`, `candidates` and `config` sat in each `design.json`, the
platform unioned the config keys by name at value collection, and "identity"
was the bare name string. A `specPath` could be a URL the platform never
fetched, so a dependency read as resolved on the strength of a link the design
agent could not even open (a 256 KiB tool cap; Stripe's document is over six
megabytes). A dependency the agent could not identify had no route forward but
one chat round trip per dependency from the Build drawer, and no way to hand
the platform a document or to build on a stated assumption.

The walkthrough that prompted this ended with a finished design whose five
external dependencies could not be built against.

## Decision

**An external dependency is defined once, in its own directory, and resolved
means its contract is on disk.**

```
specs/design/dependencies/<name>/
  dependency.json        provider, style, config keys, open candidates, contract ref, provenance, the user's `assumed` record
  openapi.yaml           the REST slice   (or schema.graphql for GraphQL)
  sdk.json               the SDK manifest (style sdk): a package per implementation language, docs, the calls used
```

- `<name>` is the one identifier: the directory, the cell's south node, every
  component's reference, and the org registry key. A component's `design.json`
  carries `{ "kind": "external", "name": "<name>" }` and nothing else of the
  definition; the write-gates refuse the old fields with a message naming the
  file they moved to.
- The platform hydrates every reference from the directory when it reads the
  design, so downstream readers keep the flat edge they had. It writes both
  halves back. A design from before the directory existed is lifted into one
  at its next save — the migration is the ordinary save.
- A **Registered External resource** gets the same directory, stamped by the
  platform at every design save from the org record (`source: "org"`), the way
  `wiring` is derived; the agent does not edit it and the build collects no
  values for it.
- **The contract is a slice**, not the provider's whole document: the
  operations the design uses plus every schema they reference, cut by a
  deterministic platform tool (`slice_openapi_spec`) outside any model's
  context, validated as a standalone document, and recorded with provenance
  (source URL, the full document's hash, when it was read). A user-supplied
  document goes through the same tool. If the agent cannot name the operations
  it needs, it does not understand the dependency well enough to resolve it.
- **An SDK dependency** carries a manifest (`sdk.json`, a package per
  implementation language) plus the API slice beside it when the provider has
  one; without one it is flagged `sdk-only`.
- **An assumed contract** is one the agent wrote from the provider's
  documentation when no document could be found or supplied. The file says so
  (`x-aep-assumed: true`; `"assumed": true` in an `sdk.json`). It counts only
  once a user accepts it: the platform records `assumed: { by, at, note }` in
  `dependency.json` — the one field the agent's write-gate refuses to author —
  and the dependency reads `needs-acceptance` until then, resolved and flagged
  `assumed` after. Replacing an assumption with a real document is the next
  design iteration.
- **State is still derived at read time** (ADR-0003), from the directory:
  candidates → `ambiguous`; org-stamped or registry-known → `resolved`,
  flagged `registered`; no provider → `unresolved / needs-input`; a style with
  no contract or manifest on disk → `unresolved / needs-contract`; an
  unaccepted assumption → `unresolved / needs-acceptance`; otherwise
  `resolved`, flagged `assumed` / `sdk-only`. The build gate blocks on
  `ambiguous` and `unresolved` and on nothing else: an assumed or SDK-only
  dependency builds, flagged wherever it appears.

**The flow.** The design turn researches each dependency, writes its directory
with whatever it found, and ends by naming what is open; it never blocks. Each
dependency has a page in the spec view where the user resolves it: **Resolve**
runs the guided `resolve-dependency` flow, a URL or a dropped file goes
straight into the directory, and an agent-written contract waits for
acceptance there. Build with open dependencies lists them and offers one
button that runs the flow over all of them.

## Consequences

- A coding agent reads the committed slice, never the web, for what the
  design decided; provenance says where to look for what the slice lacks.
- Two components using one provider share one file, one contract and one set
  of config keys; the union-by-name at value collection is gone.
- The contract in the repo is what validation checks against and what the
  cell diagram's south edge means.
- The agent's schema, the Go fold gate and the save-time schema validate the
  same file; the `assumed` record is echoed by the agent but only written by
  the platform.
- `specPath` is retired. A URL was never a contract.
