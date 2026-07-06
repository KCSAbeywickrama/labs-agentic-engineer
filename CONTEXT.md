# AEP — Ubiquitous Language

Glossary of domain terms for the Agentic Engineer Platform. Implementation-free:
this file defines what terms *mean*, not how anything works.

## Agents service (`services/agents`)

**Skill**:
A unit of procedural guidance — a `SKILL.md` (frontmatter `name` + `description`,
markdown body) — that the main agent may follow while editing a spec bundle. The
caller passes the candidate Skills (`name`, `description`, `content`) in the turn
request payload. A Skill is *guidance*, not code: never executed, never uploaded
to a model provider, never read from disk by the service (the caller — the eval —
resolves Skills from the repo).
_Avoid_: plugin, capability, tool (a tool is the agent's executable action, e.g. `editFile`).

**Skill catalog**:
The list of available Skills — `name` + one-line `description` only, no bodies —
appended to the end of the agent's system prompt. It is the agent's index for
deciding which Skills to pull. Progressive disclosure: metadata is always visible,
the body is fetched on demand.

**`loadSkill`**:
The tool the agent calls to fetch a Skill's full `content` by name. The body enters
context only when loaded, and then persists as a tool result in message history.
This is the only way a Skill body reaches the model.

**Spec bundle**:
The in-memory set of files (a snapshot, keyed by path) the main agent reads and
mutates during a turn. Lives only in the service process; never sent to a sandbox.
_Avoid_: workspace, repo, project.

**Turn**:
One request→response cycle of the main agent: a user instruction plus the current
spec bundle in, a stream of file mutations out. One turn = one POST.

## Dependency management

**Dependency**:
A component's declared need on something outside itself, authored in its design.
Exactly four kinds exist: `component`, `org-service`, `external`, `platform-resource`.
_Avoid_: connection, integration, dependsOn.

**External resource**:
A third-party service outside the platform (e.g. a weather API) consumed through
configured values such as a base URL and API key. Its definition is registered
once per organization; each consuming project supplies its own values.
_Avoid_: external connection, third-party integration.

**Org-service**:
A component another project has published organization-wide for cross-project
consumption. Addressed by its project-prefixed catalog name, never by URL.
_Avoid_: internal API, shared service.

**Platform resource**:
Infrastructure the platform provisions on request from a typed catalog
(e.g. a `postgres-cnpg` database). The consumer declares the type and
parameters; the platform owns the lifecycle.
_Avoid_: managed resource, infra dependency.

**Resolution**:
The read-time judgment of whether a dependency can currently be satisfied
(resolved, unresolved, blocked — with a reason). Computed on every read;
never written to a spec file.
_Avoid_: status (as a stored field).

**Gate**:
A prerequisite that holds work until satisfied: values provided for an
external resource, a platform resource provisioned, a provider deployed.
Gates hold tasks; resolving the gate releases them automatically.

**Discovery**:
The design agent consulting the organization's catalogs (external resources,
org endpoints, platform resource types) before inventing a dependency, with
web research as the fallback for externals not found locally.

**Task-planner**:
The agent that turns a published design into an ordered, dependency-aware task
breakdown (plan) and expands each task into an issue brief (detail). Guided by
the `task-breakdown` Skill; typed rows are minted by the platform, never by the agent.
_Avoid_: tech lead.

**Playground token**:
A short-lived MCP token minted for a human driving the playground locally,
via an endpoint that exists only when explicitly enabled in a local deployment.
Scoped to one org; minted fresh per turn. Never part of the production
authentication story (which remains an open decision).
