---
name: design
description: Use when generating a project's design from its PRD — the /design flow that turns specs/requirements/prd.md into the component design under specs/design/, then mints the validation criteria.
metadata:
  aep:
    kind: platform
---

# Design

The design step. Requirements exist; this flow derives the complete component
design from them and finishes by generating the validation criteria. It owns
that step and nothing after it.

## The requirements are the brief

Design FROM `specs/requirements/prd.md` — it is the source of truth the
kickoff produced, and it is already in the workspace. Do not interview the
user again and do not widen or narrow the scope: what the PRD says is what
gets designed. If the PRD is missing or empty, stop and say so — the user
needs to run `/start` first; inventing a design from nothing is always wrong.

**Open questions gate:** check the PRD's Open Questions section first. Any
question neither answered nor marked "deferred" blocks design — stop and tell
the user to resolve them (the amend flow's resolve-open-questions branch)
before designing. Deferred questions never block.

## Generate the design

Load the **`high-level-architecture`** skill and follow it — it owns the
decomposition into components and the design-file structure. The
**`cell-architecture-dsl`** skill governs `specs/design/design.cell` and moves
first on any architecture change; load it alongside. For webapp components,
**`excalidraw-wireframes`** covers the UI wireframes.

If a design already exists, this is a regeneration: drive the design to match
the CURRENT requirements. Update what drifted, remove what the requirements no
longer call for, and keep what still holds — do not start from a blank page
when the existing design is largely right.

## Then mint the validation criteria

As the final step, load the **`validation-criteria`** skill and generate the
validation criteria. A design without its acceptance oracle is unfinished —
never skip this because the design part felt complete.

## Where this stops

`/design` ends at the design and its validation criteria. Do **not** plan
tasks and do not write application code — those are separate steps with their
own skills and their own gates.

Close by summarizing the component breakdown in a short paragraph and telling
the user what comes next: review the design, then plan tasks when it reads
right.
