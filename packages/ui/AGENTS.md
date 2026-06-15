# AGENTS.md — packages/ui

Shared React components — **one package per component**, never a single bundle.
`packages/ui/<component>` → `@aep/ui-<component>`.

**Status:** empty bucket. Ported from `ui-components/*` (`@asdlc/*` → `@aep/ui-*`,
`plan.md` §10): explorer, md-editor, excalidraw-editor, cell-diagram-view,
openapi-view, project-status, excalidraw-dsl.

## Conventions

- One component (or one tightly-related set) per package, independently versioned.
- One public entry point: `src/index.ts`.
- Build with the Oxygen UI design system; see the `oxygen-ui` skill.
