---
name: high-level-architecture
description: Use when turning requirements into a design — creating or restructuring specs/design/design.md, deciding which components the system decomposes into, or writing a component's design.md and its frontmatter.
---

# High-level architecture

Derive the design tree from `requirements.md`. The design lives under
`specs/design/` — never at the bundle root.

```
specs/design/design.md                        # the top-level design (this skill)
specs/design/components/<name>/design.md      # one per component
specs/design/components/<name>/openapi.yaml   # services only (openapi-conventions skill)
specs/design/components/<name>/wireframes.dsl  # webapps only (excalidraw-wireframes skill)
```

## The top-level design.md

YAML frontmatter first, then these sections. Depth rule: **every requirement
must have a home** in a capability, entity, role, or screen below — a
requirement you can't point to in this document is a defect, not an editing
choice.

1. **Overview** — what the system is, in one paragraph.
2. **Components** — a bullet per component: name, `type`, one-line
   responsibility.
3. **Capabilities** — per component, the exhaustive feature list the
   requirements imply, each with 1–2 sentences of responsibility. Group by
   module when the requirements do (e.g. "Risk register", "Audit evidence").
   This list drives the component's API resources and screens — anything
   missing here silently disappears downstream.
4. **Data model** — the core entities, their key fields, and relationships.
   These become the API's `components/schemas`.
5. **Roles & access** — the actors from the requirements and what each may
   see/do. Drives auth design and per-role screens.
6. **Interactions** — who calls whom and for what: component-to-component
   plus external integrations (email, AI/LLM, object storage, ...).
7. **Data flow** — the main lifecycles end to end (one numbered walkthrough
   per core workflow).

Do NOT add platform-owned boilerplate: no Kubernetes/monitoring/backup
sections, no generic performance targets, no "future enhancements" — unless
the requirements state them.

After emitting or changing the design, record the skills you actually applied:
use `setFrontmatterField` on `specs/design/design.md` with key `skillsApplied`
and the list of skill names (e.g. `["high-level-architecture",
"openapi-conventions"]`). Never hand-edit frontmatter with editFile.

## Deriving components — fewest deployable units

A component is one independently deployable unit, NOT a domain concept.
Default to **one `service` + one `webapp`** and add more only when the
requirements force it (independent scaling, conflicting runtimes, genuinely
separate lifecycle).

- Do NOT create a service per entity (claims-service, users-service,
  receipts-service... is wrong for an MVP — that is a domain model, not a
  deployment topology; fold them into one service).
- Infrastructure is NEVER a component: no api-gateway, database, queue, or
  auth-server components. The platform provides those.
- Name components in kebab-case after their responsibility (`expense-api`,
  `expense-webapp`).

## Per-component design.md

Frontmatter with exactly these keys, then a one-paragraph single
responsibility (what it does, its port/entrypoint expectations, what it
explicitly does not do):

| Key | Value |
|---|---|
| `type` | `service` (backend/API) or `webapp` (user-facing UI) |
| `language` | implementation language, e.g. `Go`, `TypeScript` |
| `buildpack` | always `docker` |
| `appPath` | repo-relative source dir, the component name, e.g. `expense-api` |
| `entrypoint` | deploy entry, e.g. `deployment/service` |

One component per directory. Every `service` gets an `openapi.yaml`
(load `openapi-conventions` before writing it); every `webapp` gets a
`wireframes.dsl` (load `excalidraw-wireframes` before writing it).
