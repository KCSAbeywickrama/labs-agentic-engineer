---
name: high-level-architecture
description: Use when turning requirements into a design — creating or restructuring specs/design/design.md, deciding which components the system decomposes into, or writing a component's design.json.
---

# High-level architecture

Derive the design tree from `requirements.md`. The design lives under
`specs/design/` — never at the bundle root.

```
specs/design/design.md                        # the top-level design (this skill)
specs/design/components/<name>/design.json    # one per component (structured facts)
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

## Deriving components — deployment units the requirements justify

A component is one independently deployable unit, NOT a domain concept. The
right number comes from the requirements: for every component you must be
able to say "this deploys and evolves independently because <something the
requirements state>". Write that justification into the component's
`description`.

A requirement justifies a SEPARATE component when it shows:

- a distinct user-facing surface — e.g. an internal admin portal AND a
  customer-facing app with different users and lifecycles → two webapps;
- a genuinely different runtime or scaling profile — e.g. an async
  worker/batch processor beside an interactive API, or a long-running
  AI/inference service;
- a technology the rest of the system doesn't share — e.g. a Python ML
  service beside a Go API;
- an explicitly separate lifecycle or ownership stated in the requirements.

Do NOT split by:

- entity or domain concept — claims-service, users-service,
  receipts-service... is a domain model dressed as a topology; those are
  modules of ONE service;
- layer — auth, notifications, file storage as own services when they are
  modules of the API;
- infrastructure — api-gateway, database, queue, auth server are NEVER
  components; the platform provides them.

When nothing above forces a split, a small system naturally lands at one
service + one webapp — that is an outcome of the rule, not a target. Name
components in kebab-case after their responsibility (`expense-api`,
`expense-webapp`, `report-worker`).

## Per-component design.json

Each component's structured facts live in ONE JSON document (no markdown, no
frontmatter). Every field below is required; the platform validates each
write against this schema and rejects violations:

```json
{
  "name": "expense-api",              // MUST equal the directory name
  "type": "service",                  // "service" | "webapp" | any kind the requirements imply ("scheduled-task", "worker", ...)
  "version": "0.1.0",                 // semantic version; 0.1.0 for a new component
  "language": "Go",                   // implementation language, e.g. "Go", "TypeScript"
  "buildpack": "docker",              // always "docker"
  "appPath": "expense-api",           // repo-relative source dir — the component name
  "entrypoint": "deployment/service", // deploy entry
  "exposure": "internet",             // "internet" (public) | "intranet" (internal only)
  "connections": [
    { "to": "expense-webapp", "type": "http" },
    { "to": "postgres", "type": "datastore" },
    { "to": "email-gateway", "type": "connector", "onPlatform": false }
  ],
  "description": "One paragraph: single responsibility, port/entrypoint expectations, and what it explicitly does NOT do."
}
```

- `connections` mirrors the Interactions section of the top-level design.md:
  every arrow there appears here as `{to, type, onPlatform}` and vice versa —
  a mismatch is a defect. `type` is `http` (a sibling component), `datastore`,
  or `connector` (external system → `"onPlatform": false`). This list drives
  the platform's architecture diagram and dispatch.
- To CHANGE a design.json, re-emit the whole corrected file (removeFile +
  addFile) — never patch JSON with anchored edits. On INVALID_JSON or
  SCHEMA_VIOLATION, fix what the message lists and re-emit.

One component per directory. Every `service` gets an `openapi.yaml`
(load `openapi-conventions` before writing it); every `webapp` gets a
`wireframes.dsl` (load `excalidraw-wireframes` before writing it). Other
kinds (scheduled tasks, workers, ...) carry no extra artifact yet — capture
their behavior fully in `description` and `connections`.
