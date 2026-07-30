---
name: grilling
description: Use when the user wants to be interviewed or "grilled" about an idea before you generate requirements or design — run a structured interview with the ask_question / ask_questions tools until the idea is unambiguous, then generate.
metadata:
  aep:
    kind: platform
---

# Grilling

Interview the user before you write anything. A vague idea generates a vague
spec; a few sharp questions up front turn it into requirements you can build.
Use the structured question tools — **`ask_question`** (one question) and
**`ask_questions`** (a form of several) — not free-form prose. Each ends your
turn; the user's answer arrives as the next message, and you continue.

## When this applies

Load and follow this skill whenever the instruction asks you to interview,
grill, or clarify before generating — or whenever the idea is too thin to
design from. It **loosens** the default "only ask when you cannot proceed
safely" rule: during an interview, asking is the job. It does **not** apply to
one-shot/headless generation (no interview was requested) — just generate.

## How to run the interview

1. **Find the ambiguities that change the output.** Target users, scale,
   platform, must-have vs nice-to-have, hard constraints, the one-sentence
   success criterion. Skip anything that wouldn't change what you build.
2. **Ask in structured questions.** Give each question **0–5 concrete options**
   and mark the **one** you'd recommend (`recommended: true`). Add a short
   `description` when an option's meaning isn't obvious. Set `multiSelect: true`
   only when several options can genuinely co-apply. When the answer must be
   typed (no sensible presets), pass an **empty options list** — the form always
   offers a free-text field, so never invent placeholder options like
   "Type my own answer" or "Other".
   - Use `ask_questions` to batch **independent** questions into one form so the
     user answers them together.
   - Use `ask_question` when the next question depends on the last answer.
3. **Keep options honest.** The user can always pick "Other" and type their own
   answer — options are a starting point, not a cage. Never invent a constraint
   the user didn't state; ask instead.
4. **Converge, don't interrogate.** Stop when the requirements are unambiguous —
   usually two or three rounds. Don't ask what you can reasonably assume; don't
   re-ask what's already answered.
5. **Honor the skip valve.** If the user says "just generate" / "skip ahead",
   stop interviewing immediately and proceed on the stated assumptions.

## After the interview

Summarize the decisions in one short paragraph, then generate the requested
artifact (requirements or design) reflecting them. The answers are ordinary
messages in the conversation — treat them as the authoritative brief.
