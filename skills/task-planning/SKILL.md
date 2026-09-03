---
name: task-planning
description: Use when planning implementation Tasks from a design — the plan turn that covers the milestone's in-scope stories with one Task per design component, wires dependsOn, and writes each Task's body.
metadata:
  aep:
    kind: platform
    audience: [design]
---

# Task planning

Cover the milestone's in-scope stories. The instruction carries a
**"Milestone scope"** section the platform computed: each in-scope story is
marked COVERED (an existing Task already serves it) or NEEDS TASKS. Your job
ends when every NEEDS TASKS story is served by a Task; COVERED stories'
existing Tasks are reference, never rework. With no scope section, plan every
component that needs work — same rules, whole design in scope.

**The unit of work stays the design component.** A story is served by the
component that cites it (`stories` in `components/<name>/design.json`, derived
from the cell): plan or extend THAT component's Task. Never invent a
component; a story no component cites is the design's gap — say so in your
final text and recommend extending the design, never a Task without a home.
The platform stamps each Task's "Serves stories" block from the design's
citations — you never write it.

## What a Task is

- **One component, one Task.** Title it after the work — "Implement
  order-service" fresh, "Add refunds to order-service" for a delta. Titles
  unique and human-readable.
- **rationale** is one sentence: why this Task exists.
- **dependsOn** are **component names** from the design's edges: if
  `order-service` calls `user-service`, its Task depends on
  `["user-service"]`. Never issue numbers; never platform infrastructure
  (databases, gateways, IDPs). For every component edge A→B, A's Task lists B
  — `dependsOn` carries the build order (a cycle is rejected; break it).

## Dependency kinds and gates

| Dependency kind | Ordering effect | What the rationale records |
|---|---|---|
| `component` | consumer's Task lists the provider in `dependsOn` | the build-order edge |
| `org-service` | none — the provider lives in another project | the cross-project binding |
| `external` | none | names the value-collection **gate** |
| `platform-resource` | none | names the provisioning **gate** |

**Gates are flagged, never minted**: the platform authors gate issues; you
emit no Task for a gate. Each design dependency is accounted for exactly once
— in `dependsOn` (component kind) or in a rationale (the other three).

## Fresh and incremental are the same flow

- **Pending Task of an affected component** → `updateTask` it (re-state scope,
  refresh `dependsOn`, rewrite the body) rather than planning a duplicate.
- **Component work already done, new stories arrived** → plan a **delta** Task
  for just the new work, distinctly titled.
- **In-flight work** → `updateTask` with a note that the change lands on top;
  never silently rewrite its scope.
- **Untouched components and COVERED stories** → do nothing. Silence is
  correct.
- **Obsolete component** (has a Task, gone from the design) → `updateTask`
  with an obsolescence note; a human closes it.

Split one component into several Tasks only when a single PR physically
cannot land the work (e.g. a migration must merge before feature code).

## Write the bodies in the same turn

After planning, write every planned Task's full body via `updateTask` before
the turn ends — `## Scope` (the concrete work, citing the component's
design.json and its openapi.yaml/wireframes.dsl), `## Acceptance` (what done
means, at work altitude — the validation oracle owns product acceptance), and
`## References` (the spec paths the coding agent reads). A Task without a body
is unfinished planning.

For a `web-application` component the wireframe is the screen contract, so
its Task always carries two more things: the path
`specs/design/components/<name>/wireframes.dsl` under `## References`, and a
`Screens:` line under `## Scope` naming every `screen` in that file the Task
covers (`Screens: RiskQueue, MyRisks, NewRisk, …`). Names only — the elements
live in the DSL, and listing them in the issue would go stale the moment the
wireframe is edited. The coding agent's `wireframes` skill turns the names
into pages.

**Map the stories to the flows, and check the mapping yourself.** You hold
both the story list and the wireframe, so you are the one place the two can be
compared — the designer's coverage pass is not one you inherit on trust. Read
the `flow` blocks and write a **`Flows:` checklist** under `## Scope` — one
item per flow, numbered `F1`, `F2`, …, carrying the flow's name, its `role`,
the stories it walks, and its `description` line from the DSL:

```markdown
Flows:

- [ ] **F1 · "Submit an expense"** (Employee) — stories 3, 4, 7
  MyClaims → NewClaim → ClaimDetail
  An employee files a claim and tracks its approval.
- [ ] **F2 · "Approve a claim"** (Manager) — stories 5, 6
  ApprovalQueue → ClaimReview
  A manager works the pending queue and decides a claim.

No flow: story 1 (sign-in — platform SSO owns the page), story 9 (nightly
export job, no view).
```

Why each part earns its place: the **number** gives the coding agent and the
reviewer a short handle, so "F2 is not walkable" says exactly which journey
without quoting a whole name; the **screen chain** is the flow's own screen
list in walkthrough order, entry screen first — the `Screens:` line above says
which routes to build, this says the order someone walks them, and it is the
walk the PR has to demonstrate; the **description** is already written in the
DSL, so copying it saves every later reader from opening the file to learn
what the journey is for; and the **checkbox** makes it a contract the PR ticks
back item by item.

Keep the chain to screen names and arrows — no commentary. A screen appearing
in two flows is listed in both; that is the DSL's shape, not a mistake.

**Leave every box unchecked.** The issue states what must be walked; the
coding agent ticks the same list in its PR body. Re-planning rewrites this
body, so a tick recorded here would be wiped — the PR is where progress lives.

Every in-scope story lands either on a flow item or the `No flow:` line. A
story with no view is expected — sign-in and sign-out on a component with an
auth dependency, a backend rule, a scheduled job, an endpoint another service
calls — so put it there **with the reason**. A story that belongs on a screen
and has no flow is a real gap: say so in the same place
(`story 10 — no flow walks this`) rather than dropping it, so a human sees it
before the work starts. When every story is walked, say so
(`No flow: none — stories 1–9 are all walked above`) rather than omitting the
line, so a reader can tell the question was asked.

The coding agent ticks each flow off when it is walkable end to end, so this
line is what lets a failing story be traced back to the journey that was meant
to exercise it — or to the note saying no journey was ever expected.

## When a tool rejects you

The result names the fix: UNKNOWN_COMPONENT lists the known components;
UNKNOWN_REF lists the addressable refs; DUPLICATE_TITLE means pick a distinct
title; DEPENDENCY_CYCLE shows the path to break. Correct and re-issue — never
re-emit an op that succeeded.
