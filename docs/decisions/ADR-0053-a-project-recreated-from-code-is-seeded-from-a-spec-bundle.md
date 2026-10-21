# ADR-0053 — A project recreated from code is seeded from a spec bundle, and never interviewed

**Status:** Accepted · 2026-10-21
**Related:** [ADR-0027](ADR-0027-one-external-dependency-one-definition.md) (one
dependency, one definition), [ADR-0040](ADR-0040-a-design-goes-out-of-date-per-feature.md)
(design runs and the finished-turn ledger), ADR-0045 (design work runs in the
organization's AE Studio).
**Detail:** `services/aep-api/internal/platform/specbundle` (the format),
`services/aep-api/internal/spec/seed.go` and `kickoff.go`,
`skills/recreate/SKILL.md`, `.agents/skills/code-to-spec/` (the writer),
[`docs/developer-guide/code-to-spec.md`](../developer-guide/code-to-spec.md).

## Context

A product that already exists as code is recreated on AEP. The platform's own
flows start from an idea: `/start` interviews a person, the design agent
discovers what the product calls and invents the dependencies it needs. For a
recreate the code already answers those questions, and a developer skill,
`code-to-spec`, writes the answers in the platform's own shape: the
requirements with a coverage file per module, the domain model, and one
dependency definition per upstream the recreate keeps calling, with a contract
derived from the client code.

Two things made the first rehearsal manual and fragile. The design agent,
treating the pushed tree as a greenfield start, wrote the five upstreams
again as open needs under the right names with no keys and no contract, and
every feature blocked on them; teaching `/design` to keep pre-existing
definitions would have changed the second iteration's semantics for every
project. And getting the tree into a project meant creating it, letting the
kickoff interview flush, closing every tab, pushing, and reopening. The design
agent has no shell and reads one commit's snapshot, so it cannot read the
legacy code itself; the reading stays on the developer's machine.

## Decision

1. **The tree travels as a bundle.** `code-to-spec` packs its output as an
   `.aespecs` archive: `manifest.json` (format `aespecs/1`, the producer, the
   product, the source repository and commit) and the `specs/` tree. The
   console takes it at project create beside the reference documents and
   sends it to `seed-project` before them.
2. **The platform validates before it commits.** `specbundle` opens the
   archive under fixed bounds and a path allow-list, requires UTF-8 text, and
   refuses anything that looks like a credential; the seed then holds the
   content to the readers the save gates use. A raw commit applies none of
   the Room's write rules, so the seed applies them itself. Nothing lands on
   any refusal.
3. **One commit, one fact.** The files and a `[recreate]` table in the
   project descriptor land in one commit. The table is the only place the
   platform records that a project is a recreate; the kickoff reads it and
   refuses `/start` however the held kickoff is released, and the status poll
   surfaces it as `spec.recreate`.
4. **The first design is its own flow.** `/recreate` walks the `design`
   lineup with the seeded definitions as givens, referenced and never
   rewritten; `design` and `architecture` are unchanged, and the second
   iteration is `/design`'s converge pass for every project alike. The
   console offers Recreate on the design card while the project is seeded and
   no design has run.
5. **Seeding is the second door.** "New project from existing specs" later is
   create plus seed; nothing in the seed knows which dialog called it.

## Consequences

- A recreate reaches its first design with no interview, no tab discipline
  and no credentials on the platform: values are collected on the Deploy page
  after the design, as for any project external, and Promote to organization
  shares a definition.
- The legacy code is read where it lives. A server-side run that executes
  `code-to-spec` on the coding runner stays open as the next step.
- The playground's snapshot filter admits dependency definitions so the
  `writing-skills` verify loop sees what the Room sees; a flow token is
  registered in the pod's gates and aep-api's design-run list, as `/design`
  is.
