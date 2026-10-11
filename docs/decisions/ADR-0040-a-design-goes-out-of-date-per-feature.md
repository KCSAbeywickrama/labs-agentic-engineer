# ADR-0040 — A design goes out of date per feature

**Status:** Accepted · 2026-10-01 · Amended 2026-10-07 (the pod reports what a design run covered) ·
Amended 2026-10-11 (a design run's basis is read where it ended)
**Related:** [ADR-0039](ADR-0039-requirements-are-features-with-stable-ids.md),
[ADR-0041](ADR-0041-a-build-is-a-selection-of-features.md)

## Context

A design was out of date when anything in the requirements changed after it,
so an edit to one feature blocked building every other. With per-feature
requirements, a design can be judged per feature.

## Decision

1. **A feature's basis is what its design reads**: its file's lines by their
   words (IDs kept; sources, clauses and closing tags dropped), then the words
   of each P item that reaches it (`reqspec.Basis`). Confirming an assumed line
   or adding a source changes no basis; editing the product page changes none.
2. **A design run records what it covered in the line that started it**
   (`/design F1 F2`; a bare `/design` covers every feature designable at the
   commit it read). Nothing new is stored: the turn store already keeps each
   turn's instruction and base commit.
3. **A feature is out of date when its basis now differs from its basis at the
   commit of the newest run that designed it.** A feature no run covered is
   undesigned, not out of date. The build gate refuses only a build that
   carries an out-of-date feature (`FEATURE_NOT_BUILDABLE`).
4. **The console works out the same thing live** (`designWork.ts`) from the
   room's documents and `designedFrom` (`GET /spec/state`, each designed
   feature's basis at design time). Both readings are held to `basis.json`.
5. **Acceptance criteria are per feature** (`specs/validation/acceptance/F<n>-…
   .feature`, rules tagged `@story-F<n>.<m>`), and the gate checks only the
   features the version carries.

## Consequences

- Editing Approvals leaves Submit expenses buildable.
- A design turn can be scoped (`/design F2`) to bring one feature up to date.

## Amendment 2026-10-07 — the pod reports what a design run covered

Design turns run in the org's AE Studio
([ADR-0045](ADR-0045-design-work-runs-in-the-organizations-ae-studio.md)), so
aep-api no longer keeps a turn's instruction. Decision 2 now reads: the design
agent reports the feature IDs a `/design F1 F2` turn named with the turn's
usage (`record-turn-usage`), and aep-api's turn ledger keeps them with the
turn's base commit (`agent_turns.summary`, `services/aep-api/internal/spec/design_runs.go`).
A bare `/design` reports none, which still means every feature designable at
that commit.

## Amendment 2026-10-11 — a design run's basis is read where it ended

A design run now edits requirements while it runs: the gap check writes
`*assumed*` lines and open questions
([ADR-0050](ADR-0050-design-is-a-review-loop-and-build-reads-the-prototype.md)),
and Address comments can edit them too. Read at the commit the run started
from, every feature the run touched was out of date as soon as the run
finished. Decision 3 now reads as follows.

- **A feature's basis is read where the run that designed it ended.** As a
  design or Address comments run ends, the pod asks the Room for a forced
  save, reads the project's head and reports it with the turn's usage
  (`endRef`). The ledger keeps it as `end_ref`. A run with no end recorded is
  read at its base commit. The run's own edits are therefore part of what it
  designed, and only a later edit makes the feature out of date.
- **Which features a run covered** is still read at its start for a bare
  `/design` (every feature designable at the commit it read) and from its
  line for `/design F1 F2`. An Address comments run counts as a design run
  only for the features its own requirement edits reached. Every other feature
  keeps its earlier basis, so an edit made before that run still shows as out
  of date.
- The status poll's coarse `designOutdated` flag follows the same rule.
