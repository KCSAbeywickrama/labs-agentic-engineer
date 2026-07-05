---
name: high-level-architecture
description: Use when turning requirements into a design — creating or restructuring specs/design/design.md, deciding which components the system decomposes into, or writing a component's design.json.
---

# High-level architecture

Derive the design tree from `requirements.md`. The design lives under
`specs/design/` — never at the bundle root.

```
specs/design/design.md                         # top-level summary (3–5 lines, this skill)
specs/design/components/<name>/design.json     # one per component (structured facts — the source of truth)
specs/design/components/<name>/wireframes.dsl  # webapps only (excalidraw-wireframes skill)
specs/design/components/<name>/openapi.yaml    # services only (openapi-conventions skill)
```

## Output order — emit files in EXACTLY this order

The platform renders the architecture diagram live from `design.json` files
as they stream, so they come first:

1. `specs/design/design.md` — concise (3–5 lines).
2. **Every** component's `design.json`, back to back — before any other artifact.
3. `wireframes.dsl` per webapp.
4. `openapi.yaml` per service, LAST.

## The top-level design.md

YAML frontmatter, then **3–5 lines maximum**: one sentence on what the system
is, then one line per component — `name` (`type`) — one-line responsibility.
Nothing else: no capability lists, no data model, no roles, no boilerplate.
The structured facts live in each component's `design.json`; API details live
in `openapi.yaml`. Depth rule unchanged: every requirement must trace to a
component's artifacts — cover them there, not here.

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
  "description": "1–2 sentences: the single responsibility and what it explicitly does NOT do. No endpoint, resource, or schema detail — openapi.yaml carries that."
}
```

- `connections` captures every interaction the requirements imply: who calls
  whom, datastores, and external integrations, each as `{to, type, onPlatform}`.
  `type` is `http` (a sibling component), `datastore`, or `connector`
  (external system → `"onPlatform": false`). This list drives the platform's
  architecture diagram and dispatch — an interaction missing here is invisible
  to both.
- To CHANGE a design.json, re-emit the whole corrected file (removeFile +
  addFile) — never patch JSON with anchored edits. On INVALID_JSON or
  SCHEMA_VIOLATION, fix what the message lists and re-emit.

One component per directory. Every `service` gets an `openapi.yaml`
(load `openapi-conventions` before writing it); every `webapp` gets a
`wireframes.dsl` (load `excalidraw-wireframes` before writing it). Other
kinds (scheduled tasks, workers, ...) carry no extra artifact yet — capture
their behavior fully in `description` and `connections`.
