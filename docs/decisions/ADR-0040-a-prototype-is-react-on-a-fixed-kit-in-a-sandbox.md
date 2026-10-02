# ADR-0040 — A prototype is React on a fixed kit, run in a sandbox

**Status:** Accepted · 2026-10-02
**Supersedes:** the json-render prototype decision, "ADR-0035 — The prototype
is a json-render spec over a closed catalog", which exists only on the unmerged
v2 branch `feat/813-prototype-json-render` (on main, ADR-0035 is the agent
evaluation ADR; this ADR does not touch it).
**Related:** [console ADR-0033](../../apps/console/design/decisions/ADR-0033-preview-and-annotate-are-one-prototype-view.md)
(Preview acts, Annotate only selects). Feature: #813, sub-project 1 (#856).

## Context

A clickable prototype was either a full React app an agent writes from scratch
(expensive, different every time, unchecked) or a closed json-render catalog
(validated, but only view state changes: forms cannot submit and data never
carries across screens). The template-react rewrite was expressive but bound to
AEP: Oxygen, AEP paths, no CLI, unpublished.

## Decision

1. **Format.** A prototype is a folder: `prototype.json` (manifest v3: roles,
   display states, screens, flows, entry screen; no host-specific fields) and
   `prototype.tsx`, React that imports only `react` and `@wso2/prototype-kit`.
2. **A fixed kit owns the runtime.** `defineApp`, navigation/role/state hooks,
   a mock data store (collections with deterministic ids, single values, a
   fixed today) and 25 neutral components. A component is a stub: the kit owns
   element ids, selection and press semantics; a theme registry draws it. The
   registry is a mapped type, so a theme missing a component does not compile.
3. **Checked before anyone sees it.** `prototype check` runs, in order: the
   manifest's shape and references, static source rules (a name bound anywhere
   in the module is not a global), literal navigation targets, then every
   screen x role x state rendered in an isolated child (empty environment, Node
   permission model with no grants, heap and time caps, a `vm` context created
   from `Object.create(null)` without string code generation or wasm, frozen
   shared prototypes). Findings are a stable, documented code enum.
4. **Played in a sandbox.** The frame is `<iframe sandbox="allow-scripts">`
   from `srcdoc` with a no-network CSP (`'unsafe-eval'` only for the module
   loader); host and frame speak a validated message bridge. The host ignores
   frame navigation outside Preview, only moves to screens reachable for the
   current role, and shape-validates `proto:data` snapshots (bounded walk:
   cycles rejected, node cap) before persisting them. Mock-data persistence is
   the host's (`--persist`), because the frame has no origin.
5. **Three public packages.** `@wso2/prototype-kit`,
   `@wso2/prototype-theme-default` (plain React + CSS; no MUI) and
   `@wso2/prototype-cli` (`init`, `check`, `preview`, `export`).

## Consequences

- AEP's Prototype stage (sub-project 3) reuses the kit, manifest, checks,
  frame and reducer, and brings an Oxygen theme; nothing in a prototype names
  AEP.
- Network isolation of the render check rests on the permission model plus
  `vm`; a host-realm escape could still reach the network. Running it inside
  AEP needs an egress policy (sub-project 3).
- `'unsafe-eval'` in the frame is accepted: the frame has an opaque origin and
  no network. The CSP does not block the frame navigating itself (`location`);
  the host ignores such navigation outside Preview.
- `check` does not render closed Dialog/Drawer contents unless a display state
  opens them, so those contents are unchecked until a state shows them.
- Each theme ships its own runtimes with React bundled; their size is watched.
- The prototype stays optional beside wireframes; making it what Build reads is
  sub-project 5.
