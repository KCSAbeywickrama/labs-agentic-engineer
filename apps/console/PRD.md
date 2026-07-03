# AEP Console — Product Requirements (living document)

> **What this is:** the stable product picture of the console — who it's for,
> how it's organized, and what it does today. All sections describe **shipped**
> software, except **In flight**, which lists features currently being built.
>
> **Update rules:** a feature entering build adds one line to *In flight*
> (flow step 5); shipping a feature moves that line into the feature
> inventory and amends any affected sections (flow step 8) — both are
> required steps, not courtesies. Keep entries to one line/paragraph + a
> link; detail belongs in the feature's own docs.

## Purpose

The AEP Console is the web frontend of the Agentic Engineer Platform: a
spec-driven SDLC surface where engineers define, track, and steer AI-assisted
development work. It is a single-page React app served alongside the `aep-api`
BFF, which is its only backend.

## Personas

<!-- Who uses the console and what they need from it. Fill during the first
     real feature grilling; keep to 2–4 personas. -->

- _TBD — defined with the first shipped feature._

## Information architecture

<!-- Top-level navigation map: sections, what lives in each, how users move
     between them. Update when navigation changes. -->

- _TBD — defined with the first shipped feature._

## In flight

Features currently being built. One line each; **must be emptied on ship**
(the line moves to the inventory below). If a line sits here for weeks,
that's a stalled feature — investigate, don't ignore.

- _none_

## Feature inventory

One row per **shipped** feature. Newest first.

| Feature | Shipped | Summary | Docs |
|---|---|---|---|
| _none yet_ | — | — | — |

## Non-goals

<!-- Things the console deliberately does not do. Prevents re-litigating the
     same scope debates every session. -->

- _TBD_

## Cross-cutting requirements

- All API access through the generated `aep-api` client; contract-first
  (see `design/api-guidelines.md`).
- Oxygen UI design system throughout (see `design/design-system.md`).
- UI must be fully developable and demoable against the mock layer, without a
  running backend.
