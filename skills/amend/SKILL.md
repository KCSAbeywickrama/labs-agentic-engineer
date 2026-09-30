---
name: amend
description: Use for a scoped change to existing requirements — adding a feature or adding an actor. The instruction names the scope; touch nothing outside it.
metadata:
  aep:
    kind: platform
    audience: [design]
---

# Amend

A scoped edit to the requirements under `specs/requirements/`. The instruction
names the scope — a feature to add or an actor to add. **Scope is the
contract**: files and sections the scope doesn't touch stay byte-identical, and
IDs are only ever added — an ID is never edited or reused, because designs,
criteria, and tasks cite it.

Revising a point the document already carries is the `settle` skill's job, not
this one: that edit propagates by design, and propagation is the opposite of
the promise made above.

The requirements' shape and ID rules are defined by the `prd-contract` skill —
follow it when writing.
The `grilling` skill owns the question mechanics for every branch below.

**The document is already there to ask against**, so amend starts where `start`
has to arrive: every question can name the line it would change. Write each
answer in as it settles rather than banking them to the end, and keep the edit
inside the scope — rounds are cheap, a widened edit is not.

## Add a feature

Interview for what the feature does, for whom, and any policy it implies —
skipping what the instruction already says. Then place it by `prd-contract`'s
feature rule:

- **A new capability a user would name** is a new feature: create
  `features/F<n>-<slug>.md` with the next feature ID, and add its one line to
  the Features list in `prd.md`. Its stories are `F<n>.1`, `F<n>.2`, …; its
  own decisions, out-of-scope lines and open questions go in its file.
- **Stories that belong to an existing feature** are an amendment to that
  feature: add them to its file with that feature's next story IDs.
- **An idea that cannot be named with a purpose yet** is a Fog entry in
  `prd.md`, not a feature.
- **Work that should not ship yet** is an Out of Scope line instead.

Record what the new stories need: a feature they wait on is a `Needs:` line
(`prd-contract`), and a rule that applies to more than one feature goes in
`product-wide.md` with the next P ID. New decisions follow the contract as
ever: org defaults answer silently, and a new external capability is a
Registered External resource or a service the user already uses, else
capability-only.

Done when every new story has an ID and names an actor `prd.md` defines.

## Add an actor

Define the actor in `prd.md`'s **Actors** (product-level: name + what they can
broadly see/do), then add or amend **only the stories their arrival implies**,
each in the feature it belongs to.

Two entrances reach this branch, and the second is the common one:

- **The user asked for the actor.** The instruction is the brief, and the
  stories it implies are the ones it names.
- **You noticed one mid-conversation.** *"Managers approve them"* names a
  Manager the Actors section has never defined, and their stories are already
  under discussion. Define the actor in the same turn those stories are
  written, so every story names an actor the document defines.

## Close

Summarize exactly what changed — new IDs, files and sections touched — in a few
lines. The rest of the flow (design, build) stays untouched by this skill.
