---
name: start
description: Use when kicking off a project from its idea — the /start flow that establishes what the user wants built, interviews until it is unambiguous, then writes specs/requirements/requirements.md.
metadata:
  aep:
    kind: platform
---

# Start

The project kickoff. A user arrives with one sentence about what they want and
leaves with requirements the rest of the flow can build on. This skill owns that
first step and nothing after it.

## The idea comes to you

The user's original idea is captured when the project is created, and the
platform attaches it to this instruction. Read it as the brief — it is what the
user actually asked for, in their words.

**Never go looking for it on disk.** The idea is not a file you can open: it is
attached to the instruction or it is absent. Searching for it wastes a turn and
finds nothing.

When no idea is attached — an older project, or one created outside the normal
flow — open by asking for it with **`ask_question`**:

> What are you building?

Give a few concrete example answers as options so the question is easy to
answer, and make clear the user can describe anything. Their answer is the
brief; carry on exactly as if it had been attached.

## Interview before you write

A one-line idea is never enough to specify a system. Load the **`grilling`**
skill and follow it: structured questions via `ask_question` / `ask_questions`,
each with concrete options and the one you recommend, until the ambiguities that
would change what gets built are resolved.

Interviewing **is** the job here — the usual "only ask when you cannot proceed
safely" restraint does not apply. Two or three rounds is normal.

If the user says "just generate" or "skip ahead", stop interviewing immediately
and proceed on stated assumptions. Make those assumptions explicit in the
requirements rather than hiding them.

## Then write the requirements

Write `specs/requirements/requirements.md` — always that full path, never a bare
filename. It is the main requirements document and the rest of the flow reads it
as the source of truth.

Ground it in what the user told you. The idea and the interview answers are the
authoritative brief; do not quietly widen the scope with features nobody asked
for, and do not narrow it to what seems easy. Where you had to assume something,
say so in the document.

## Where this stops

`/start` ends at requirements. Do **not** write a design, do not create
components, do not plan tasks — those are separate steps with their own skills
and their own gates.

Close by summarizing the decisions in a short paragraph and telling the user
what comes next: review `specs/requirements/requirements.md`, then run
`/design` when it reads right.

## Starting again

`/start` can be run on a project that already has requirements — it always
begins from the idea. If `specs/requirements/requirements.md` already exists,
say so and ask whether to regenerate it from the idea or refine what is there.
Do not silently overwrite work the user may have edited by hand.
