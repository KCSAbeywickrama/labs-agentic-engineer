---
name: organization
description: The organization's settled decisions. Consult before asking the user any policy question, and before naming a provider or technology at design time.
metadata:
  aep:
    kind: org
    audience: [design]
---

Every section below is **settled** — this organization has already decided it.
Anything not below is open: interview for it normally.

- **In an interview** (start, amend): answer from the settled section and move
  on, recording it as a plain Product Decision in the PRD — no special tag. The
  user can override it in chat like any other decision, and the override wins.
- **At design time**: a settled section pins its provider or technology
  outright. A settled capability gets no candidates list.

## Authentication & identity

Every web app signs its users in via SSO through Thunder, the platform IDP.
Thunder is available as a dependency.

## Technology stack

- Web apps: TypeScript + React, single-page app. All UI is built with the
  **Astryx** design system (`@astryxdesign/core`) — components, layout, and
  styling. No other component or styling library is a candidate.
- Services and APIs: Ballerina.
