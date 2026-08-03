---
name: grilling
description: Use when an instruction or skill asks you to interview, grill, or clarify with the user before generating — the structured-question mechanics for ask_question and ask_questions.
metadata:
  aep:
    kind: platform
---

# Grilling

Interview mechanics. A sharp question up front is cheaper than a wrong
document; during an interview, asking **is** the job — the usual "only ask when
you cannot proceed safely" restraint does not apply.

## The tools

Each form ends your turn; the user's answers arrive as the next message.

- **`ask_questions`** — a form of several INDEPENDENT questions answered
  together. Keep a form to 1–3 questions.
- **`ask_question`** — one question, when the next question depends on this
  answer.

## Writing questions

- Ask only questions whose answers **change the artifact**. Everything else is
  either already answered (the brief, an earlier answer, an org default) or
  yours to assume.
- Give **0–5 concrete options** and mark exactly **one** `recommended: true`.
  Add a `description` where an option's meaning isn't obvious. `multiSelect:
  true` only when several options genuinely co-apply.
- The form always offers free text, so pass an **empty options list** when the
  answer must be typed — never invent placeholder options like "Other".
- Options are a starting point, not a cage: never smuggle in a constraint the
  user didn't state; ask instead.

The answers are the authoritative brief — treat them as decisions, not
suggestions.

## Ending the interview

- **Converged**: the remaining unknowns no longer change the artifact — stop
  and generate.
- **Skip valve**: the user says "just generate" / "skip" — stop immediately,
  apply your recommended answer to every remaining decision, and tag each one
  `*assumed*` where it lands in the artifact.
- **Headless**: the turn states no interview is possible — ask nothing;
  generate on stated assumptions, each marked `*assumed*`.
