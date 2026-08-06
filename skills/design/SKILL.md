---
name: design
description: Use when generating a project's design from its PRD — the /design flow that turns specs/requirements/prd.md into the cell-first design under specs/design/, then mints the validation criteria. Also the flow for a delta pass when a later phase starts.
metadata:
  aep:
    kind: platform
    audience: [design]
---

# Design

The design step: derive the complete design of ONE PRD phase from
`specs/requirements/prd.md`, cell-first. The build gate checks the result
mechanically — a phase declared, every in-scope story cited, every in-scope
component enriched — so the way to a clean Build is to follow the order below.

## The PRD is the brief

Design FROM `specs/requirements/prd.md`. Do not interview the user again and
do not widen or narrow the scope: what the PRD says is what gets designed. A
missing or empty PRD means the user needs `/start` first — stop and say so.

**Open questions gate:** any PRD Open Question neither answered nor marked
"deferred" blocks design — stop and point the user at the amend flow's
resolve-open-questions branch. Deferred questions never block.

## The lineup, in order

1. **design.cell** — load `cell-design` and emit the cell FIRST: the `phase`
   this version details, every component with its story citations, boundaries
   and edges. The console streams it into the live diagram, and the platform
   scaffolds a design.json skeleton per deployable component when it lands.
   Components whose stories all belong to LATER phases still appear — they are
   the walking skeleton, and the gate exempts them from detail.
2. **Component enrichment** — load `architecture` and fill each in-phase
   component's design.json: language (org Tech stack default first),
   dependencies (discover before you invent), description, pinned skills.
3. **design.md** — a DIAGRAM document, mermaid throughout: one Overview
   paragraph, then `## Context (C1)` (a mermaid graph: the PRD's actors, the
   system, external systems), `## Domain model (ER)` (a mermaid erDiagram:
   entities, key fields, relations — these become the API schemas), and
   `## Key flows` (one mermaid sequenceDiagram per core workflow). No
   Components or Interactions prose — the cell owns C2.
4. **security.md** — when the design has sign-in or roles, load
   `security-design` and write it.
5. **Per-component artifacts** — every in-phase `service` gets `openapi.yaml`
   (load `openapi-conventions`); every in-phase `web-application` gets
   `wireframes.dsl` (load `wireframes`). Stubs get neither yet.
6. **Validation criteria** — load `validation-criteria` and mint
   `specs/validation/validation-criteria.json` LAST. A design without its
   acceptance oracle is unfinished — never skip this.

## Regeneration and the delta pass

A design already exists → CONVERGE it to the current PRD: update what
drifted, remove what the PRD no longer calls for, keep what holds.

Starting a LATER phase is a **delta pass with shipped parts protected**:
update the cell's `phase`, deepen that phase's stubs into full detail, and
touch shipped components only where the new phase's stories require it —
calling out every such change. When built reality contradicts the skeleton,
surface the conflict to the user; never silently redraw shipped architecture.

## Where this stops

`/design` ends at the design and its validation criteria — no task planning,
no application code. Close with three parts and nothing more: one line per
component (name, type, one-clause role); a **"Needs your input"** block
listing only the dependencies still ambiguous or unresolved; and a one-line
pointer to `specs/design/`. The dependency narration during the turn (the
`architecture` skill owns its format) already carried the play-by-play.
