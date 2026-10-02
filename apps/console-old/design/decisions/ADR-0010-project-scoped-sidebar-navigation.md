# ADR-0010: Project-scoped sidebar navigation (full swap)

- **Status:** Accepted
- **Date:** 2026-07-10 (grilling of the tasks-page feature,
  [#173](https://github.com/wso2/labs-agentic-engineer/issues/173))
- **Context:** project sections were reachable only through the overview's
  status cards; the sidebar showed global items (Projects, Settings)
  everywhere. The tasks page needed a persistent way to move between a
  project's sections.

## Decision

Inside a project route (`/projects/:projectName/…`), the sidebar's nav
section **fully swaps** to the project's sections — **Overview, Spec,
Tasks, Deployments, Issues** — with no back-item and no stacked global
section. Returning to the projects list is the header brand or the project
switcher. **Settings stays in the sidebar footer** in both contexts.

Corollaries:

- A new project section means a new sidebar item here, not a new tab bar
  or card-link inside a page. Sections ship a placeholder page until their
  feature lands (Deployments, Issues today).
- Full-screen surfaces inside a project (the spec workspace, #80) keep the
  sidebar but **auto-collapse** it on entry; they don't leave the shell.
- The active item follows the route section, one mapping per section.

Rejected: a "← Projects" back-item at the top of the project nav; showing
global + project sections stacked in one sidebar.

## Consequences

- #173 replaces the `builds` placeholder route with `tasks` and rewires
  the overview status-card links; the PRD IA renames **Build → Tasks** and
  adds **Issues** (future SRE-agent issues surface).
- The sidebar composition in `AppLayout` becomes route-dependent
  (`projectName` param present → project nav).
