# ADR-0020: The console never creates document nodes — agents do

- **Status:** Accepted
- **Date:** 2026-08-25
- **Context:** grilled on #586 (a failed room seed rendering a blank PRD). The
  console's two collab reads were asymmetric: `getFileText` reads through
  `filesMap(doc).get(path)` and returns `null` for a path the room lacks, while
  `getFileFragment` called `Y.Doc.getXmlFragment(path)`, which **creates** a
  fragment for any path asked for. A read that writes made "does the room hold
  this file?" unanswerable, because asking made the answer yes.

## Decision

- **Reads of the collab document are non-creating.** `getFileFragment` returns a
  fragment only when `doc.share.has(path)`, matching `getFileText`. No render
  path may bring a node into existence as a side effect of looking at it.
- **One narrow exception, and it is the caller's assertion, not the getter's
  guess:** `getFileFragment(path, { create: true })` materialises the fragment
  for a path **git already holds**. It exists because presence cannot answer for
  an *empty* file — an empty or whitespace-only markdown file seeds to a
  zero-length fragment, which generates no update and so never replicates its
  key to a joining client, leaving `share.has` false for a document the room
  genuinely owns. Without the exception such a file would open read-only forever
  and nobody could type its first character. The flag is passed only from the
  committed file list the Files API returned — never from `docPaths`, which
  would let a phantom vouch for itself.
- **A path enters a room from exactly two sources:** the server's seed from git
  (`onLoadDocument`), and peers over sync — agents writing spec files, or
  another client that already holds them. The console authors *edits to nodes
  that exist*; it never authors their existence.
- **Therefore `docPaths` is a fact about the room**, not about what the console
  has looked at, and `usesCollab` means what it says: the room really holds this
  file, so the live editor owns it and the committed-git fallback stands down.
- Should the console ever need to create a spec file, it is an **explicit user
  action** that says so — never a getter.

## Consequences

- The committed-git fallback becomes reachable again. It was suppressed for any
  path the console had merely rendered, which is what let an unseeded room paint
  a blank document over a PRD that exists in git.
- The file list stops gaining phantom entries. `listDocPaths` reads
  `doc.share.keys()`, so a console-created fragment appeared as a real file —
  on a project with no `prd.md` yet, reading the PRD for the rail conjured a
  requirements entry that suppressed both the empty state and the failed-kickoff
  banner.
- The rule is checkable in review: a `getXmlFragment` call in console code is a
  defect unless it is guarded by `share.has` or by a committed-file list that
  proves git holds the path.
- Agents keep full authority to introduce files mid-session; nothing about the
  live agent-authoring flow changes, because those nodes arrive over sync with
  their share entry already present.
