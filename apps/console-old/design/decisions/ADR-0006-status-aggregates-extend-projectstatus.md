# ADR-0006: Status aggregates extend ProjectStatus, not page-shaped endpoints

- **Status:** Accepted
- **Date:** 2026-07-05 (grilling of the project-overview feature,
  [#77](https://github.com/wso2/labs-agentic-engineer/issues/77))
- **Context:** the overview page needs project-level version/deploy state
  (spec published version + dirty flag, deployed version + result) that no
  endpoint provided. A `/projects/{name}/overview` endpoint shaped like the
  page was proposed and rejected.

## Decision

When a console surface needs project-level status that doesn't exist yet,
**extend the `ProjectStatus` schema** (served by `get-project-status`)
rather than adding an endpoint shaped like one screen. Screens compose from
`ProjectStatus` + the relevant resource lists; the aggregate stays a
domain object, not a view model.

Corollary: don't build on endpoints tagged **Deprecated** in the contract
(e.g. `/design/versions`) — ask for the field on `ProjectStatus` instead.

## Consequences

- #77 adds `specVersion`, `specDirty`, `deployedVersion`, `deployStatus`
  to `ProjectStatus` (BE handshake).
- Future sections (Builds, Deployments, Spec tabs) request status fields
  the same way; page-shaped endpoints stay rejected unless a screen's
  needs outgrow a domain aggregate — supersede this ADR explicitly if so.
