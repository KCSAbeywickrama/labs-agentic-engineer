# ADR-0041 — A build is a selection of features

**Status:** Accepted · 2026-10-01
**Related:** [ADR-0011](ADR-0011-milestone-is-the-unit-of-execution.md),
[ADR-0034](ADR-0034-only-the-deployed-version-can-be-revalidated.md),
[ADR-0039](ADR-0039-requirements-are-features-with-stable-ids.md),
[ADR-0040](ADR-0040-a-design-goes-out-of-date-per-feature.md)

## Context

A build built everything the spec defined. With features, users want to ship
one at a time, keep a half-interviewed or blocked feature out, and see what a
change since the last build touches — and validation must judge only what was
built, and say when a later version broke an earlier one.

## Decision

1. **A build carries a selection** (`BuildRequest.selection`): the picked
   features and product-wide items. The server plans the rest
   (`reqspec.PlanBuild`): unbuilt features a picked one needs, unbuilt P items
   that reach a carried feature, and holds back a story that needs a feature
   neither built nor carried. A feature not interviewed, held by a blocking
   question, out of date, or waiting on an open external dependency (by its
   component) is refused with the reason.
2. **The tag is the record.** The version's annotation lists `Features:`,
   `Product-wide:`, `Held back:` (and `Fixes:` for a repair). What was built so
   far is the union of earlier annotations; `GET /versions` serves each
   version's features with their lines at the tag, so the console can say what
   changed in a feature since it was last built.
3. **Planner and coder read the version, not main**: the plan snapshots
   `tags/<version>`, and the coding runner swaps in the tag's `specs/`.
4. **Tasks are per feature per component**, plus a foundation Task per
   component for shared setup and the carried P items; the platform links them
   in dependency order.
5. **A version validates its built scope**: every feature built in it or
   before, minus held-back stories. The validation issue, the pod's report
   checker and the Go reader all narrow to it. Scenarios are keyed by feature
   ID, rule and scenario.
6. **"Was passing" compares with the previous validated version's final
   attempt.** A regression gets its own `regression` issue naming both versions,
   the range and what this version built; still failing comments on the open
   issue; the ledger row carries the count.
7. **A repair build** (`BuildRequest.repair {of}`) cuts `v1.1` at v1's commit,
   files v1's final failures as its work and skips planning.

## Consequences

- A product with an unresolved external dependency still ships the features
  that do not need it.
- Versions cut before selections name nothing they built; they validate the
  whole oracle and count as building nothing.

## Amendment (2026-10-10): one build issue, worked feature by feature

Decision 4 is replaced. **A build is one issue**: its body is an ordered
checklist, an optional Foundation item (the shared setup and the carried P
items), then one item per carried feature, each after the features it needs.
The plan turn writes it with one tool, `planBuild`, which refuses an item the
version does not carry, a carried feature left out, and a feature before one
it needs; the plan tap mints the issue (`Build <version>`, dedupe key
`DedupeKeyBuildIssue`) once the turn completes. The coding run works the
items in order, one subagent per component of an item, one commit per item
(`(#N <item>)`), and ticks each item's line when it is pushed. A cycle that
finishes some items lands them with `Advances #N`, a non-closing reference
the merge policy admits for the build issue; the run's no-progress rule counts
the unticked items, so the next cycle continues. Consequences: the plan scope
carries no stories or coverage, the Serves-stories stamp and per-task
dependency links are gone, and an item's stories are read from its feature
file. The full decision, with its context and alternatives, is
[ADR-0050](ADR-0050-a-version-builds-as-one-issue-with-an-ordered-checklist.md).
