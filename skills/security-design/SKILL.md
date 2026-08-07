---
name: security-design
description: Use when a design involves sign-in, roles, or permissions — writing specs/design/security.md, deciding the roles-to-permissions matrix, or configuring Thunder authentication at design altitude.
metadata:
  aep:
    kind: platform
    audience: [design]
---

# Security design (security.md)

`specs/design/security.md` is where the PRD's Actors become enforceable
access: one project-level document the openapi security schemes, the
wireframes' per-role screens, and the coding agent's auth wiring all read.
Every access rule cites the stories it serves, so security traces back to
requirements like everything else.

## Sections, in order

1. **Roles → permissions** — a matrix: role × component × allowed actions and
   screens. Roles come from the PRD's Actors section — define no role the PRD
   has no actor for, and give every actor a row. Cite stories per row.
2. **Authentication (Thunder)** — the design-altitude Thunder facts: the
   shared `thunder-app` dependency NAME (the same name on the SPA and every
   protected service — that shared name is what ties sign-in to
   token-carrying API calls), the scopes (default `openid profile email`),
   and the explicit list of which components sit on each side of sign-in.
   The `thunder-authentication` skill owns the build-time mechanics; this
   section owns the design decisions it consumes.
3. **Role resolution** — how each service maps a token to a role: the claim
   or lookup used, and what an unmapped caller gets (deny by default).

## Rules

- The organization skill's Security & compliance and Authentication defaults
  apply before you invent policy — a filled org entry is the decision.
- Public, unauthenticated surfaces are declared here too ("no sign-in:
  <component> — serves stories …"), so absence of auth is a decision, not an
  omission.
- Keep it at design altitude: which role may do what, never how a middleware
  implements it.
