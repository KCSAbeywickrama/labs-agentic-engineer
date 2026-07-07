# ADR-0005: Project creation is requirement-first

- **Status:** Accepted
- **Date:** 2026-07-03 (grilling of the projects-listing feature,
  [#71](https://github.com/wso2/labs-agentic-engineer/issues/71))
- **Context:** the projects listing feature needed a "Create project"
  action. A plain metadata dialog (name/description → `POST /projects`) was
  proposed and rejected.

## Decision

Creating a project starts from a **requirement prompt**, not metadata. The
console's create flow (a dedicated `/projects/new` page) asks *what do you
want to build*, then confirms a suggested project name and the repo URL
(derived by convention from the connected GitHub org + project name), and
sends the prompt with `POST /projects`. The backend persists the prompt as
the project's initial requirement and kicks off spec derivation; the user
lands on the new project's overview.

Any future surface that creates projects follows the same rule: a project
is born from a requirement (PRD: "give a requirement → project is born"),
never as an empty metadata shell.

## Consequences

- `CreateProjectRequest` carries a `prompt` field (contract change agreed
  via the BE handshake for #71).
- The PRD's Home/empty-state description becomes shipped behavior rather
  than aspiration once #71 ships.
- Metadata-only creation is not exposed in the console UI; if an
  API-level escape hatch stays possible, the console never offers it.
- Name suggestion is client-side in v1; a smarter backend suggestion can
  replace it without changing this decision.
