# ADR-0006: The checklist is planned from the prototype

**Status:** Accepted (2026-10-11)

## Context

The planner (ADR-0004) derived every case's `checklist.yaml` from
`wireframes.dsl`: its screens, its `-> <Screen>` targets and its `flow` blocks.
The prototype then replaced the wireframes as a web-application's UI contract
(root ADR-0042, amendment 2026-10-11). The design agent no longer writes
wireframes, and the coding run builds the screens, display states and labels
of `prototype.json` and `prototype.tsx`. A checklist planned from the
wireframes would score a build against a contract nobody built to. In one
platform run (2026-10-10) the wireframe had two screens and the reviewed
prototype four.

## Decision

**The planner reads the prototype, not the wireframes** (`src/planner.ts`). Its
inputs are the feature files (or a flat `prd.md`), `prototype.json` (roles,
display states, screens with their `roleIds`, flows per role) and
`prototype.tsx`. It skips any `wireframes.dsl`. The wireframe rules move over
one to one:

- **Editable and actionable come from kit elements** (rule 4). A `<Field>` in
  a `<Form>` or `<Filters>` is editable, unless it has a `value` and no
  `onChange`. A `<Button>`, `<Link>`, navigation item, breadcrumb with a `to`,
  tab and step header, row with a `to` and row action are actionable.
  Everything else is read-only. Where the stories and the prototype disagree,
  the prototype wins for the walk, and the difference goes into `gaps`.
- **`screen` is the manifest `name`** of the screen an item ends on (rule 10).
- **Coverage adds the shell screens** (rule 11): every prototype flow, every
  story with a UI, and one item each for Account and Settings, reached through
  the user menu. The coding run builds them in every app.
- **Display states count when the walk can cause them** (new rule 12). A state
  the UI can bring about from an empty database (an empty list, a required
  field left blank) is an item, with the state named in `expect`. A state that
  needs the backend to fail is not walkable: it goes into `gaps`, and mock
  verification covers it in the coding run.

**A case without a prototype is refused.** `save` and `replan` refuse a case
with a `web-application` that lacks `prototype.json` or `prototype.tsx`
(`webappsWithoutPrototype`), naming `play <dir> prototype` as the fix. A
checklist planned without the contract would be one the build cannot match.

## Consequences

- The seven cases carry a prototype pair per web application, made with
  `play <dir> prototype` (playground ADR-0006) and checked with
  `prototype check`. Every checklist was re-planned on it.
- A score from before the re-plan is not comparable with one after it: the
  checklists changed (item counts moved, for example, from 15 to 22 and from 42
  to 35). A new baseline sweep is needed before skill changes are scored.
- The cases still carry `wireframes.dsl`, flat PRDs and per-component issue
  files. The planner ignores the wireframes. A flat PRD cannot be planned into
  a build issue (root ADR-0039, ADR-0050), so a case moves to one build issue
  only when it is made again with feature files.
