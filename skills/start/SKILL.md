---
name: start
description: Use when kicking off a project from its idea — the /start flow that interviews the user section by section and writes the PRD at specs/requirements/prd.md; also the flow for re-running /start on a project that already has a PRD.
metadata:
  aep:
    kind: platform
---

# Start

A user arrives with one sentence and leaves with a PRD the rest of the flow can
build on. The interview is a **coverage walk**: the PRD's own sections are the
plan, you visit every one, and nothing lands in the document that was neither
asked about nor visibly assumed.

## The idea comes to you

The user's idea is attached to this instruction when the project captured one.
Read it as the brief — it is what the user actually asked for, in their words.
It is not a file: it is attached or it is absent. When absent, open with one
`ask_question`: "What are you building?" — a few concrete example options,
free text welcome. The answer is the brief.

## The coverage walk

Interview section by section, in the PRD's own order:

1. **Problem** — who hurts, how, today.
2. **Actors** — who uses the system, at product altitude.
3. **Journey & stories** — what each actor does, end to end.
4. **Product decisions** — policy choices: sign-in, notifications, integrations.
5. **Phasing** — what ships first; a thin vertical slice makes the best MVP.
6. **Out of scope** — what this project is explicitly not.

For each section, in this order:

- **Consult the organization skill first.** A question its defaults answer is
  never asked — record the default as a plain Product Decision instead. A
  section fully covered by defaults and the brief asks nothing.
- **Ask ONE `ask_questions` form** (the `grilling` skill owns the question
  mechanics) with the 1–3 questions whose answers change the document. Skip
  questions the brief already answers.

The walk is complete when every section has been visited — covered by the
brief, by org defaults, by a form, or by the skip valve below. Depth is opt-in:
after generating, the user can go deeper in chat on any feature.

## The skip valve

At any point the user may say "just generate" / "skip". Stop asking
immediately: fill every remaining decision with your recommended answer and tag
each one `*assumed*` where it lands in the PRD. An assumption the user can see
is a decision they can overturn; a silent one is an invention.

## Write the PRD

Write `specs/requirements/prd.md` — always that full path. Load this skill's
reference `references/prd-contract.md` (via `loadSkillReference`) and follow it
exactly: it defines every section, the story numbering rules, and what the PRD
deliberately excludes. Per-feature depth goes to
`specs/requirements/features/<slug>.md`, never into the PRD body.

Anything genuinely unanswerable now goes to **Open Questions** — mark it, never
guess it.

## Running /start again

`specs/requirements/prd.md` already exists → this is an **amendment**, never a
rewrite: append new stories with fresh numbers (story numbers are permanent),
update only the sections the change touches, and leave the user's hand-edits
alone. Regenerate from scratch only when the user explicitly asks, and confirm
before overwriting.

## Where this stops

`/start` ends at the PRD. Design, components, and tasks are later steps with
their own skills and gates. Close with a one-paragraph summary of the decisions
taken (calling out every `*assumed*` one), then point the user at the next
step: review `specs/requirements/prd.md`, then run `/design` — open questions
must be answered or explicitly deferred before design can proceed.
