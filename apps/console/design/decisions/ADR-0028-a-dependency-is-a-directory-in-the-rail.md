# ADR-0028 — A dependency has a page, and the Build drawer lists

## Context

An external dependency the design could not settle had one route forward in
the console: "Resolve via chat" in the Build drawer, one full agent round trip
per dependency, with no place to hand over a document and nothing to accept
an assumption on. The drawer was also where the only upload form lived, in
front of the Build button, at the worst moment.

Platform-side, the dependency now has one definition in its own directory
(repo [ADR-0027](../../../../docs/decisions/ADR-0027-one-external-dependency-one-definition.md)),
so it has something to show.

## Decision

**Every external dependency is a row in the rail and a page in the spec
view.** The rail's **Dependencies** group sits between Flows and the
components; a row carries the one thing the user must do (*Choose a provider*,
*Needs a contract*, *Needs your acceptance*, *Needs input*) as an amber mark
with the words on hover, or the qualifier on a resolved one (*Assumed*,
*Registered*, *SDK only*) as quiet text. The dependency's own files (the
contract, an `sdk.json`) are the page's, not rail rows.

**The page owns everything that moves a dependency forward.**

- **Resolve** runs the guided flow — the message is the skill command,
  `/resolve-dependency <name>`, nothing else, because the agent reads the
  definition from its file and the playbook from its skills. A resolved
  dependency offers **Reconsider** instead, which stays prose: it opens a
  conversation about a choice already made.
- **Provide the contract** takes a URL the platform fetches, or a dropped file,
  straight into the dependency's directory. Question cards the flow asks
  render on the spec view around the page, so the user never leaves it.
- **Accept the assumption** appears only for a contract the agent wrote, and
  is the only way the `assumed` record gets written.

**The Build drawer lists; it does not resolve.** One row per blocking
dependency, each with **Open** to its page (an org-service has no page and
stays a design-view matter), and one button — **Resolve all in chat** — that
runs the flow over every open dependency and ends back at Build. Opening a
page or starting the batch closes the drawer, which as an overlay would
otherwise cover what it just opened. The paste-a-spec form is gone from the
drawer; the page owns uploads.

**One state per dependency.** The dependencies read model is per component;
the definition is one file, so the console folds the rows by name
(`dependencyStates.ts`) and the rail, the page and the drawer read one answer.

## Consequences

- "Resolve via chat" is gone from the drawer and from the lexicon; the
  design view's dependency cards keep their chat button, now sending the
  skill command.
- `SpecSelection` gains `{ kind: "dependency", name }`; a `dependency.json`
  in the rail follows to the page, its contract files to the file view.
- Two endpoints back the page: `POST …/dependencies/{name}/contract` and
  `POST …/dependencies/{name}/assumption`.
