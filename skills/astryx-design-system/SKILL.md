---
name: astryx-design-system
description: The UI toolkit every web app on this platform is built with — Astryx (`@astryxdesign/core`), its Theme + StyleX wiring, and the CLI you confirm every component's props against before writing JSX. Apply when a component's `type` is `web-application`, for all UI work in it — pages, layouts, forms, tables, dialogs, nav, theming — even when the task never names Astryx.
metadata:
  aep:
    kind: org
    audience: [coding]
---

# Astryx Design System

Astryx (`@astryxdesign/core`) is the **only** UI toolkit for this platform's web
apps — components, layout, and styling (via StyleX) all come from it. Never raw
HTML styling, never another component library, never an invented component prop.

`react-webapp` owns the app: layout, config, verify command, Dockerfile, nginx.
This skill owns what goes **inside** `src/` — the UI. Where the two appear to
disagree, `react-webapp` wins; the conflicts worth naming are listed under
Platform constraints below.

## Correctness through the CLI, not memory

Astryx ships `@astryxdesign/cli` because component APIs move faster than any
model's training data. The CLI reads the *installed* version, so it is always
right; a guessed prop is never right by comparison. The discipline: **before
writing JSX for a component you have not confirmed this session, run the CLI,
then write the JSX** — never the reverse.

**Violating the letter of this rule is violating the spirit of it.** "It's just a
placeholder page," "the app doesn't have Astryx wired up yet," and "this screen
is throwaway" are reasons to wire Astryx up *faster*, not reasons to skip it — a
page built in raw `<div>`s is what deploys, because there is no human code-review
gate between your PR and the dev environment.

## Setup

`react-webapp` scaffolds the app. Add Astryx to it:

```bash
npm install @astryxdesign/core @stylexjs/stylex @astryxdesign/theme-neutral @astryxdesign/build
npm install -D @astryxdesign/cli
```

`@astryxdesign/core` declares React **19+** as a hard peer dependency — set
`react` / `react-dom` to `^19` in `package.json`, not an older major.

Wire the build (order matters — `astryxStylex()` before `react()`, and **no
`base`**, per `react-webapp`):

```ts
// vite.config.ts
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {astryxStylex} from '@astryxdesign/build/vite';

export default defineConfig({plugins: [...astryxStylex(), react()]});
```

```tsx
// main.tsx — reset + theme CSS load before anything renders
import '@astryxdesign/core/reset.css';
import '@astryxdesign/theme-neutral/theme.css';
import {Theme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral/built';
// wrap <App/> in <Theme theme={neutralTheme}> — swap the theme package to change
// the look, never hand-roll colors instead
```

Run `npx astryx doctor` as part of the verify step and treat a non-zero exit like
a failing build — config, theme wiring, and peer-dependency problems are cheap to
fix before the Docker build and expensive to debug after it.

## Platform constraints that override this system's defaults

Four places where Astryx's own guidance assumes a project this platform does not
build. Each of these is a runtime or build failure, not a style preference:

1. **Never run `npx astryx init`** (in any form, including
   `--features agents`). It scaffolds a fresh app and writes
   `AGENTS.md`/`CLAUDE.md` into the repo. The app is already scaffolded, and
   guidance reaches you as skills — a committed agent file is a second, stale
   authority in the project.
2. **Never set `base` in `vite.config.ts`**, whatever an Astryx snippet shows.
   Each web app is served at its own gateway host root; a `base` 404s every asset
   and the page renders blank (`react-webapp`, Served at host root).
3. **The CSS imports go in `main.tsx`, never in `index.html`.** `index.html`'s
   only `<script>` rules are `react-webapp`'s: the synchronous `env-config.js`
   tag first, the module bundle second. Adding a stylesheet or script tag around
   them risks `window._env_` being unset when the first module evaluates.
4. **Theme tokens are not runtime config.** Colors and spacing come from the
   theme package at build time. `window._env_` carries URLs and OIDC config only
   — do not plumb a theme value through it.

Astryx replaces hand-written UI, not the platform's data layer: `openapi-fetch`
and the committed `src/generated/` client stay exactly as `react-webapp`
specifies. "Install no other library" below is about UI and styling.

## Critical rules

1. **Import everything from `@astryxdesign/core/<Category>`** (per-category
   subpath entry points, e.g. `@astryxdesign/core/Button`,
   `@astryxdesign/core/Layout`) — never from Tailwind, MUI, Chakra, Ant Design,
   Bootstrap, or a hand-rolled component.
2. **Run `npx astryx component <Name> --dense` before using ANY component**, even
   one already used earlier in this session — confirm the prop exists before
   writing it, don't guess.
3. **Search before building.** Run `npx astryx search "<thing>"` when unsure what
   exists; Astryx ships more components than you would assume (tag inputs,
   command palettes, tree lists, chat UI) — check before reaching for a wrapper
   `<div>` or a new dependency.
4. **Layout is `VStack`/`HStack`/`Grid`/`Stack` from `@astryxdesign/core/Layout`**
   — never a raw `<div>`/`<span>` for spacing or arrangement.
5. **Style overrides are `stylex.create()` + the component's `xstyle` prop** —
   never `style={{...}}`, and never `className`/`style` alongside
   `{...stylex.props()}` (use `mergeProps()` if you must combine).
6. **Colors and spacing are tokens, never literals.** Run
   `npx astryx docs tokens --dense`; use the CSS-var color tokens and `spaceN`
   gap values it documents, not hex/rgb or raw px.
7. **Page-level structure follows a template, not intuition.** Run
   `npx astryx template --list` and `npx astryx template <name> --skeleton` to
   find and study a layout skeleton before hand-building a page (dashboard,
   settings, list, wizard, auth) from scratch.
8. **Navigation uses `useLinkComponent()`**, never a hardcoded `<a>`.
9. **Dense data is rows, not cards.** Use `Table` or `List`+`Item` for lists of
   records; `Card` is for widgets, galleries, or grouped settings — not one card
   per row.

## Reach for these components (not raw HTML)

| If you're about to build… | Use instead |
|---|---|
| Page shell with top bar + side nav | `AppShell`, `TopNav`, `SideNav`, `MobileNav` |
| A data table / list view | `Table`, `List` + `Item`, `MetadataList` |
| A form with grouped fields | `FormLayout`, `Field`, `FieldStatus` |
| A select / combobox / tag input | `Selector`, `MultiSelector`, `ComplexSelector`, `Typeahead`, `Tokenizer` |
| A modal / confirmation dialog | `Dialog`, `AlertDialog` |
| A dropdown / context / command menu | `DropdownMenu`, `ContextMenu`, `MoreMenu`, `CommandPalette` |
| Status / count / label chip | `Badge`, `StatusDot`, `Token`, `Indicator` |
| Tooltip / hover detail / anchored popup | `Tooltip`, `HoverCard`, `Popover` |
| Date/time entry | `DateInput`, `DateRangeInput`, `DateTimeInput`, `TimeInput`, `Calendar` |
| Loading / empty state | `Skeleton`, `Spinner`, `ProgressBar`, `EmptyState` |
| Breadcrumbs / global search | `Breadcrumbs`, `PowerSearch` |
| Toggle / choice input | `Switch`, `CheckboxInput`, `CheckboxList`, `RadioList`, `SegmentedControl`, `ToggleButton` |

This table is a quick guide, not the catalog — run `npx astryx component --list`
for every component grouped by category, or `npx astryx search` when nothing here
fits.

## Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| Astryx components render unstyled/unthemed | `reset.css`/theme CSS not imported, or imported after other global CSS without layer ordering | Import reset + theme first in `main.tsx`; if the app has other global CSS, assign every stylesheet an explicit `@layer` (`npx astryx docs migration`) |
| `npm install` fails / peer-dependency warnings on React | `package.json` is on React <19 | Set `react`/`react-dom` to `^19` before installing `@astryxdesign/core` |
| Build succeeds but StyleX classes/styles don't apply | `astryxStylex()` missing from `vite.config.ts`, or ordered after `react()` | Add `...astryxStylex()` to `plugins`, listed before `react()` |
| Page renders blank in dev, every asset 404s | `base` was set in `vite.config.ts` from an Astryx snippet | Remove it — served at host root (`react-webapp`) |
| A prop doesn't exist, or is the old spelling | Answered from memory instead of the CLI | Run `npx astryx component <Name> --dense` — the CLI reflects the installed version, training data doesn't |
| Every row in a list is wrapped in its own `Card` | Defaulted to a generic "card grid" instead of checking data density | `npx astryx docs principles --dense` — dense data is `Table`/`List`+`Item`; `Card` is for widgets/galleries/settings groups |

## Red flags — stop and use Astryx

- About to write `<div style={{...}}>` or a raw `className` for layout, color, or
  spacing
- About to `npm install` any other component or styling library
- About to write JSX for a form, list, card, dialog, nav, or button from scratch
- Thinking "it's just a placeholder" or "Astryx isn't set up in this app yet"
- Using a prop without having confirmed it exists via
  `astryx component <Name> --dense`

All of these mean: stop, run `astryx search` / `astryx component <Name> --dense`,
and use what it returns.
