# `@wso2/prototype-kit` — design notes

## What it is

The one import a generated prototype has besides React, and the machinery every
host needs. Subpaths: `.` (generated-code API + theme contract), `/manifest`,
`/source`, `/check`, `/host`, `/build`. `/check` and `/manifest` are React-free
so the CLI runs without React installed.

## Stubs and themes

A kit component resolves its `id` (throws without one), wraps the theme's output
in a `SelectableBox` (or hands the theme `SelectableRootProps` for rows, tabs,
steps, navigation entries and crumbs), applies press semantics (`onPress`, then
`to`, Preview only) and renders `registry[Name]` with resolved props. Annotate
therefore behaves the same under every theme. `KitComponentProps` lists every
component's theme props; `ThemeRegistry` maps over it.

## Store

Seeded from `defineApp({ data })`. An array whose records all have a string `id`
is a collection; anything else is a value. New ids are `${name}-${n}`, `n` past
the highest number any seeded or current id ends in. Every change emits a JSON
snapshot (the frame posts it as `proto:data`); a store can start from a
snapshot, per key, falling back to the seed for a key of the wrong kind.

## Forms

The frame has no `allow-forms`, so browsers never fire a submit event there. A
`<Button submit>` calls its `<Form>`'s submit through `FormSubmitContext`;
themes call `onSubmit` for Enter in a single-line field. Validation (`required`,
`pattern`) runs at submit and again as a failed form is edited.

## Checks

`checkPrototypeFiles` stops at the first failing stage: files, manifest
(JSON, version, shape, references), static source rules, literal `to=`/`go()`
targets, isolated render.

- Static global check: a name bound anywhere in the module (a local `history`)
  is not a global, so it is not flagged.
- Render child: gets only strings; its `vm` context is created from
  `Object.create(null)`, so the context's global has no host-realm prototype
  chain; it hardens `Object.prototype`, `Array.prototype` and
  `Function.prototype` before the module runs, so prototype pollution throws.
  `RENDER_TIMEOUT_MS` is 15 s.
- Limits of the render check: see ADR-0040, Consequences.

## Host reducer and bridge (`/host`)

The reducer owns view state. `NAVIGATE` only moves to a screen reachable for the
current role. `proto:data` snapshots are shape-validated with a bounded walk
(cycles rejected, node cap) before a host persists them (`isDataSnapshot`).
`PrototypeFrame` re-sends `load` on every frame `ready`, so a reloaded frame
recovers. The host ignores frame navigation outside Preview.

## Build helper

`buildThemeRuntimes({ theme, resolveDir, outDir })` bundles a theme with the
kit and React into `frame-runtime.js` (entry `bundle/frame-entry`) and
`check-runtime.js` (entries `bundle/check-prelude`, `bundle/check-entry`). The
source dir is `src/bundle`; the public subpaths stay `/build`, `/build/*`.
Generated: `schema/prototype-manifest.schema.json` and `reference.md`
(`pnpm --filter @wso2/prototype-kit gen`; `test/generated.test.ts` fails when
stale).
