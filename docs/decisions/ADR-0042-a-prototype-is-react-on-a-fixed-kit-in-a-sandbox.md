# ADR-0042 — A prototype is React on a fixed kit, run in a sandbox

**Status:** Accepted · 2026-10-02
**Supersedes:** the json-render prototype decision, "ADR-0035 — The prototype
is a json-render spec over a closed catalog", which exists only on the unmerged
v2 branch `feat/813-prototype-json-render` (on main, ADR-0035 is the agent
evaluation ADR; this ADR does not touch it).
**Related:** [console ADR-0001](../../apps/console/design/decisions/ADR-0001-prototype-review-is-a-full-screen-overlay.md)
(the console's review overlay; Preview acts, Annotate only selects). Feature:
#813, sub-project 1 (#856); AEP stage: #860.

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

- AEP's Prototype stage reuses the kit, manifest, checks, frame and reducer. It
  is wired in the console (`/prototype`, review and Annotate: [console
  design note](../../apps/console/design/prototype-review.md)). Nothing in a
  prototype names AEP.
- `@wso2/prototype-theme-oxygen` draws the kit on Oxygen UI. Its runtimes
  cannot be tree-shaken: the frame is about 2.1 MB (722 KB gzip) and the check
  runtime 1.5 MB, against 0.9 MB and 0.24 MB for the default theme. The console
  loads the frame runtime lazily, on first review.
- The stage is gated at three places, one rule set: the agent's write
  (`agent-stream`, with the isolated render check run by the agents service),
  the Go save gate (manifest schema, references and the static source floor,
  vendored and kept in step by shared test tables), and the build gate, which is
  unchanged. Typed `prototypeFeedback` on a `/prototype` turn is validated by
  Go before a turn opens.
- Network isolation of the render check rests on the permission model plus
  `vm`; a host-realm escape could still reach the network. Running it inside
  AEP needs an egress policy.
- The agents service runs the render check synchronously (`spawnSync`, 15 s
  cap), so each `prototype.tsx` write blocks that service's event loop for the
  render (about 1 to 3 s observed); other conversations on the same process
  wait. An asynchronous check needs a kit change.
- The Go save gate has no render stage: a prototype that parses and references
  correctly but throws when drawn is stopped only by the agent's gate, so a
  write that bypasses the agent (an edit in the room) is not rendered.
- Editing `prototype.json` after `prototype.tsx` is not re-judged against the
  existing source; the agent's ordering (manifest first) is what keeps them
  consistent.
- `'unsafe-eval'` in the frame is accepted: the frame has an opaque origin and
  no network. The CSP does not block the frame navigating itself (`location`).
- `check` does not render closed Dialog/Drawer contents unless a display state
  opens them, so those contents are unchecked until a state shows them.
- Each theme ships its own runtimes with React bundled; their size is watched.
- The prototype stays optional beside wireframes; making it what Build reads is
  sub-project 5.
