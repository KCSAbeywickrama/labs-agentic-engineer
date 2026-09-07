---
name: oxygen-ui-design-system
description: Oxygen UI (`@wso2/oxygen-ui`) — this organization's web-app design system, covering its provider + router wiring, the organization's settled brand colors, the composite components a page is built from, and the verify step a web-app build owes it. Apply to all UI work in a `web-application` that pins it — pages, layouts, forms, tables, dialogs, nav, theming — even when the task never names Oxygen.
metadata:
  aep:
    kind: org
    audience: [coding]
---

# Oxygen UI Design System

Oxygen UI (`@wso2/oxygen-ui`, https://github.com/wso2/oxygen-ui) is **this
organization's** UI toolkit — WSO2's React component library on Material UI
v7, with the Oxygen theme already applied to every export. Components, layout,
icons, and styling all come from it. Never raw HTML styling, never another
component library, never an invented component prop.

You are here because the component you are building pinned this skill, so the
whole of it is yours — theming included. The organization's colors are settled
in Brand colors below; nobody is interviewed about them, at design time or any
other time.

`react-webapp` owns the app: layout, config, verify sequence, Dockerfile, nginx.
This skill owns what goes **inside** `src/` — the UI. Where the two appear to
disagree, `react-webapp` wins; the conflicts worth naming are listed under
Platform constraints below.

## Correctness through the installed types, not memory

Everything `@wso2/oxygen-ui` exports is typed, and the types describe the
*installed* version — a guessed prop is never right by comparison. The
discipline: **before writing JSX for a component you have not confirmed this
session, read its API, then write the JSX** — never the reverse. Two places to
read, in this order:

1. **The installed package's own docs**, which ship inside it and are matched
   to the version this app installed:
   `node_modules/@wso2/oxygen-ui/.claude/components.md` (every composite
   component's props and sub-components), `patterns.md` (whole screens), and
   `theming.md`. This skill does not carry a second copy of them on purpose —
   a copy here would ride the org's library while the real API rides the
   package, and the two would drift with nothing to catch it.
2. **The `.d.ts`**, for anything the prose does not settle or contradicts:
   `node_modules/@wso2/oxygen-ui/dist/components/<Name>/<Name>.d.ts`. The types
   are generated from the code, so they are the last word — see Known errors
   in the package's docs below.

### Known errors in the package's docs

Three snippets in the package's `.claude/*.md` do not compile against the code
they ship with — verified with `tsc` against 0.13.1. The `.d.ts` is right and
the prose is wrong. `references/app-structure.md` beside this skill carries a
corrected scaffold.

| The docs show | It actually is |
|---|---|
| `<Footer companyName="WSO2 LLC" />` | `Footer` takes children: `<Footer><Footer.Copyright>© WSO2 LLC</Footer.Copyright></Footer>` |
| `DashboardIcon` | not an export — the lucide name is `LayoutDashboard` |
| `GoogleIcon` | not an export — the brand icons carry no `Icon` suffix, so it is `Google` |

A snippet that fails `tsc` is a doc bug, not a version you are missing — read
the `.d.ts` and follow it.

Plain MUI components (`Button`, `TextField`, `Dialog`, `Chip`, `Grid`, …) keep
MUI v7's API; they are re-exported from `@wso2/oxygen-ui` unchanged except for
the theme.

**Violating the letter of this rule is violating the spirit of it.** "It's just a
placeholder page," "the app doesn't have Oxygen wired up yet," and "this screen
is throwaway" are reasons to wire Oxygen up *faster*, not reasons to skip it — a
page built in raw `<div>`s is what deploys, because there is no human code-review
gate between your PR and the dev environment.

## Setup

`react-webapp` scaffolds the app. Add Oxygen to it, from the App Path:

```bash
# 1. React exactly at the version Oxygen's peer dependency names — a newer
#    19.x fails `npm install` with ERESOLVE, and forcing past that ships two Reacts
REACT_VER=$(npm view @wso2/oxygen-ui@latest peerDependencies.react)
npm install react@"$REACT_VER" react-dom@"$REACT_VER"
# 2. Oxygen itself, its icon set, and the router its app shell is built around
npm install @wso2/oxygen-ui@latest @wso2/oxygen-ui-icons-react@latest react-router
# optional, only if a screen draws a chart
npm install @wso2/oxygen-ui-charts-react@latest
```

**Never install `@mui/*`, `@emotion/*`, or `lucide-react` yourself.**
`@wso2/oxygen-ui` bundles MUI, MUI X and Emotion as its own dependencies, and
`@wso2/oxygen-ui-icons-react` brings lucide; a second copy
in `package.json` gives the app two Emotion caches and two MUI runtimes, and
the theme silently stops reaching half the tree. The package README's install
line that names `@mui/material` predates this and is wrong for the version you
install. Verify below fails on any of them.

Wire the provider once, outermost, in `main.tsx` — then the router, then the
app. Oxygen bundles its font (Inter Variable) and applies its theme
globally from the provider; there is no stylesheet to import or link:

```tsx
// src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { OxygenUIThemeProvider, OxygenTheme } from '@wso2/oxygen-ui';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OxygenUIThemeProvider theme={OxygenTheme}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </OxygenUIThemeProvider>
  </StrictMode>,
);
```

`OxygenTheme` is the stock theme, and the fallback. It is what a project gets
when this organization has not set brand colors — see the next section. Then
lay the app out per `references/app-structure.md`: `src/config/appRoutes.tsx`
(routes grouped under layouts), `src/layouts/AppLayout.tsx` (the `AppShell`),
`src/pages/*.tsx` (each `PageContent` > `PageTitle` > content).

## Brand colors

A web app is themed at its FIRST build, and retrofitting a theme means revisiting
every screen — so the colors cannot be a per-build decision. They are an
**organization** decision, settled once in the section below, exactly like the
language a service is written in.

**Never ask anyone for them.** Not at design time, not at coding time, not once
per project. The answer is either set below or it is the stock theme, and both
are complete answers — a question about theming is a defect, not diligence.

### The organization's colors

- Accent (buttons, links, focus): _not set — use the stock theme_
- Neutral (backgrounds, surfaces): _not set — use the stock theme_

To brand every web app this organization builds, an org edits those two lines to
hex values (Settings → Skills), e.g.:

```markdown
- Accent (buttons, links, focus): #f5c518
- Neutral (backgrounds, surfaces): #0a0a0a
```

HEX only, never color words: "black and yellow" does not say WHICH yellow, and
this file is the whole of what a build sees. The edit reaches every subsequent
build in the org with no conversation involved.

A per-project override still wins, **per value, not per section**: a hex under
the `## Brand colors` heading in the project's `specs/requirements/prd.md`
overrides the same line here, and a line that heading omits still comes from
this section. That heading is there for a project whose colors someone stated
outright — it is not something to solicit, and a half-filled one is not a
reason to drop the organization's other color.

### At build time — derive the theme

Resolve each of the two colors before you wire the theme, independently: the
project's `## Brand colors` line in `specs/requirements/prd.md` if it has one,
otherwise the line in The organization's colors above. **A color neither one
sets is not chosen** — leave that part of the theme stock and never invent
one, whether that leaves you with two brand colors, one, or none. One brand
color plus one stock color is a valid outcome; a guessed hex is not.

With colors, a brand theme is a **theme of your own derived from the stock
one** — not hand-written colors sprinkled over components. Painting components
brand colors through `sx` violates "colors are tokens" and leaves every
unstyled surface off-brand. `createOxygenTheme` deep-merges overrides onto the
Oxygen base and returns a ready theme; there is no compile step and nothing
generated to commit:

```ts
// src/theme.ts
import { createOxygenTheme } from '@wso2/oxygen-ui';

export const brandTheme = createOxygenTheme({
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#f5c518' },                        // accent
      },
    },
    dark: {
      palette: {
        primary: { main: '#f5c518' },                        // accent
        background: { default: '#0a0a0a', paper: '#161616' }, // neutral, as a ramp
      },
    },
  },
});
```

```tsx
// src/main.tsx — the only change from Setup
import { brandTheme } from './theme';
// <OxygenUIThemeProvider theme={brandTheme}>
```

What each color becomes:

| Color | Set it on |
|---|---|
| Accent | `palette.primary.main` in **both** color schemes. MUI derives `light`, `dark`, and the text that sits on the accent (`contrastText`) from it, so set only `main`; check the result reads in both modes and darken the light-scheme `main` if a pale hue fails contrast on white. |
| Neutral | `palette.background.default` and `palette.background.paper` in the color scheme the hex belongs to — a dark hex goes on `dark`, a light one on `light` — as a ramp: `default` the brand value, `paper` a step lighter (dark) or the brand value with `default` a step darker (light). Leave the other scheme's background stock; never put a dark neutral on the light scheme. |

Keep the hue, move the lightness: contrast is not negotiable to match a brand.
Omit a key rather than guess it — an override you do not write is the stock
value, which is the correct answer for a color nobody set.

## Verify

This skill's step in `react-webapp`'s verify sequence — after `npm install`,
before `npx tsc --noEmit`, from the App Path:

```bash
node "$AEP_SKILLS_DIR/oxygen-ui-design-system/scripts/verify.mjs"
```

If `$AEP_SKILLS_DIR` is unset, the script is `scripts/verify.mjs` next to this
skill's `SKILL.md` (the BFF mirrors that directory to
`.claude/skills/oxygen-ui-design-system/` at the repo root). A non-zero exit
fails verification like any other step in that sequence, and every failure
line names its fix. It is there because Oxygen's wiring faults — a second MUI
or Emotion installed beside the bundled one, an import that bypasses
`@wso2/oxygen-ui`, a root not wrapped in `OxygenUIThemeProvider`, a React that
is not the exact version Oxygen's peer dependency names — type-check and build
perfectly clean, then render an unthemed or broken page in the cluster: cheap
to fix here, expensive to debug after the Docker build.

## Platform constraints that override this system's defaults

Five places where Oxygen's own defaults and docs do not fit this platform. Each
is a runtime, build, or guidance failure, not a style preference:

1. **Never run `npx @wso2/oxygen-ui init` (or `update`).** That CLI writes
   `CLAUDE.md`, `AGENTS.md`, `.claude/oxygen-ui/` and `.claude/skills/` into the
   repo root. Guidance reaches you as skills, so a committed agent file is a
   second authority that nothing updates — it is stale the moment this skill
   changes, and it lands in a directory the platform owns. The same docs are
   already in the installed package (see Correctness above); read them there.
2. **Never install the peer set Oxygen's README lists** (`@mui/material`,
   `@emotion/*`, `@mui/x-*`). They are bundled — Setup above.
3. **Never set `base` in `vite.config.ts`**, and never give `BrowserRouter` a
   `basename`, whatever a sample shows. Each web app is served at its own
   gateway host root; a `base` 404s every asset and the page renders blank
   (`react-webapp`, Served at host root).
4. **`index.html` gets no extra tags.** Its only `<script>` rules are
   `react-webapp`'s: the synchronous `env-config.js` tag first, the module
   bundle second. Oxygen bundles its font, so no `<link>` for Inter or a
   stylesheet, and no script tag around those two — it risks
   `window._env_` being unset when the first module evaluates.
5. **Theme values are not runtime config.** Colors come from `src/theme.ts` at
   build time. `window._env_` carries only what the **browser** needs — OIDC
   config and flags — so do not plumb a theme value through it.

Oxygen replaces hand-written UI, not the platform's data layer: `openapi-fetch`
and the committed `src/generated/` client stay exactly as `react-webapp`
specifies. "Install no other library" above is about UI and styling.

## Critical rules

1. **Import everything from `@wso2/oxygen-ui`** — never from `@mui/material`,
   `@mui/x-*`, Tailwind, Chakra, Ant Design, Bootstrap, or a hand-rolled
   component. The package re-exports the entire MUI API with the theme applied.
2. **Icons come from `@wso2/oxygen-ui-icons-react`**, never `lucide-react`. It
   re-exports all of lucide plus the brand icons `WSO2`, `GitHub`, `GitLab`,
   `Bitbucket`, `Google`, `Facebook`, `MCP`, `Lambda`. Two rules the compiler
   enforces and memory does not:
   - **A lucide icon works bare or `Icon`-suffixed** (`Pencil` and `PencilIcon`
     both resolve). Prefer the bare name for consistency, but neither is an
     error — what fails is a name lucide does not have, like `DashboardIcon`
     for `LayoutDashboard`. Check it at https://lucide.dev/icons/.
   - **A brand icon has no `Icon` alias and is cased exactly as listed** —
     `Google` not `GoogleIcon`, `GitHub` not `Github`.

   Size with the `size` prop: `<Search size={18} />`.
3. **MUI X is namespaced**: `DataGrid.DataGrid`, `DatePickers.DatePicker`,
   `TreeView.SimpleTreeView` — import the namespace from `@wso2/oxygen-ui`.
4. **Confirm a composite component's API before using it** — the package's
   `.claude/components.md`, then the installed `.d.ts`; don't guess a
   sub-component or prop.
5. **Colors and spacing are theme tokens through `sx`, never literals.**
   `p: 2`, `gap: 2`, `bgcolor: 'background.paper'`, `color: 'text.secondary'`,
   `borderColor: 'divider'` — no hex, no rgb, no raw px. Brand colors live in
   `src/theme.ts` (above), never in a component.
6. **Layout is `Stack`/`Box`/`Grid` from `@wso2/oxygen-ui`** — never a raw
   `<div>`/`<span>` for spacing or arrangement, and never `style={{…}}`.
7. **Page-level structure follows a precedent, not intuition.** Every page is
   `PageContent` > `PageTitle` (`PageTitle.Header`, `.SubHeader`, `.Actions`,
   `.BackButton`) > content, inside the `AppShell` of `AppLayout`. Before
   composing a listing, detail, dashboard, settings, or login screen, find it in
   the package's `.claude/patterns.md` and match its composition.
8. **Navigation goes through `react-router`**: `Sidebar.Item link={<Link to="…" />}`,
   `useNavigate()` for actions, never a hardcoded `<a href>`.
9. **Dense data is rows, not cards.** Use `ListingTable` for lists of records
   (`variant="card"` when each row wants breathing room); `Card` is for widgets,
   galleries, or grouped settings — not one card per record.

## Reach for these components (not raw MUI, never raw HTML)

| If you're about to build… | Use instead |
|---|---|
| Page shell with top bar + side nav | `AppShell` > `AppShell.Navbar` (`Header`), `AppShell.Sidebar` (`Sidebar`), `AppShell.Main`, `AppShell.Footer` (`Footer`) |
| A page heading / page body wrapper | `PageTitle` (`.Header`, `.SubHeader`, `.Actions`, `.BackButton`, `.Avatar`) / `PageContent` |
| A data table / list of records | `ListingTable` (`.Container`, `.Toolbar`, `.Head`, `.Body`, `.Row`, `.Cell`, `.RowActions`, `.EmptyState`, `.Footer`) |
| A form with grouped fields | `Form.Section` + `Form.Stack` (fields are plain `TextField`, `Select`, `Checkbox`, `Switch`) |
| A multi-step flow / wizard | `Form.Wizard` |
| A user avatar + account menu | `UserMenu` (`.Trigger`, `.Header`, `.Item`, `.Divider`, `.Logout`) |
| A KPI / metric tile | `StatCard` (`value`, `label`, `icon`) |
| Breadcrumbs / search / rich select | `AppBreadcrumbs` / `SearchBar` / `ComplexSelect` |
| Notifications | `NotificationPanel` (in `AppShell.NotificationPanel`) / `NotificationBanner` |
| A modal / confirmation dialog | `Dialog` + `DialogTitle` + `DialogContent` + `DialogActions` |
| Status / count / label chip | `Chip` (`color="success"` etc.), `Badge` |
| Light/dark toggle, theme picker | `ColorSchemeToggle`, `ThemeSwitcher` |
| Login / unauthenticated page | `Layout.Content` + `ParticleBackground` (`references/app-structure.md`, GateLayout) |
| Date/time entry | `DatePickers.DatePicker`, `DatePickers.DateTimePicker` |
| A chart | `@wso2/oxygen-ui-charts-react` |

## Implementing a wireframe with Oxygen

`wireframes/references/implementing.md` says what each DSL line must become;
this is what it becomes here:

| DSL | Oxygen |
|---|---|
| `navbar "…"` / `sidebar "…"` | the `AppLayout` shell — `Header` in `AppShell.Navbar`, `Sidebar.Item`s in `AppShell.Sidebar`, identical on every screen of a role |
| `heading` | `PageTitle.Header` (screen title) or `Typography variant="h5"/"h6"` (section) |
| `text`, `link`, `breadcrumb` | `Typography`, `Link` (react-router `Link` as `component`), `AppBreadcrumbs` |
| `card "Label \| Value \| Caption"` | `StatCard` |
| `table "A \| B \| C"` + `row` | `ListingTable` with exactly those columns; `ListingTable.EmptyState` for no rows |
| `list`, `tabs`, `badge`, `progress`, `avatar`, `chart`, `image` | `List`, `Tabs`, `Chip`, `LinearProgress`, `Avatar`, a charts-react chart, `ColorSchemeImage` |
| `input`, `textarea`, `select`, `search`, `checkbox`, `radio`, `toggle` | `TextField`, `TextField multiline`, `Select`/`ComplexSelect`, `SearchBar`, `Checkbox`, `RadioGroup`, `Switch` — inside `Form.Section`/`Form.Stack` |
| `button "X" primary` / `danger` | `Button variant="contained"` / `Button color="error"`; every other button `variant="outlined"` or `"text"` |
| `row`, `split N/M` | `Stack direction="row"` / `Grid` with `size={{ md: N }}` and `size={{ md: M }}` |
| a `variant` (`danger`, `success`, …) | the palette's matching status color: `color="error"`, `"success"`, `"warning"`, `"info"` |

## Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| `npm install` fails with `ERESOLVE` on `react` | Oxygen's peer dependency is an exact React version and the scaffold installed a newer one | Install `react`/`react-dom` at exactly `npm view @wso2/oxygen-ui@latest peerDependencies.react`; never `--force` or `--legacy-peer-deps` past it |
| Components render in stock Material blue, not the Oxygen theme | `OxygenUIThemeProvider` missing, or not outermost in `main.tsx` | Wrap the root exactly as Setup shows; Verify fails on this |
| Theme applies to some components and not others; console warns about multiple Emotion/MUI instances | `@mui/material` or `@emotion/*` installed beside Oxygen's bundled copy, or imported directly | Remove them from `package.json` and every import; import from `@wso2/oxygen-ui` only |
| `Cannot find module 'lucide-react'` or an icon import fails | Icons imported from the wrong package, or a made-up name | Import the bare lucide name from `@wso2/oxygen-ui-icons-react`; check the name at lucide.dev |
| `DataGrid is not a component` / `DatePicker is not exported` | Namespace used as a component | `DataGrid.DataGrid`, `DatePickers.DatePicker` |
| Page renders blank in the cluster, every asset 404s | `base` in `vite.config.ts` or `basename` on the router, copied from a sample | Remove both — served at host root (`react-webapp`) |
| A sub-component or prop "does not exist" | Answered from memory | Read the package's `.claude/components.md`, then the installed `.d.ts` — the installed types reflect the installed version, training data doesn't |
| Every record in a list is its own `Card` | Defaulted to a card grid instead of checking data density | `ListingTable` for records; `Card` for widgets and galleries |
| Brand colors are set, deployed app is stock-themed | Colors read but never put in `src/theme.ts`, or the provider still gets `OxygenTheme` | Derive `brandTheme` with `createOxygenTheme` and pass it to the provider |
| The user gave brand colors in chat, the build ignored them | A coding run never sees a conversation — colors reach it only from this skill or the project's `specs/requirements/prd.md` | Set them in The organization's colors (Settings → Skills) for the whole org, or under `## Brand colors` in the project's `specs/requirements/prd.md` for one project; an answer that is not in a file did not happen |
| Brand accent is unreadable in one mode | One `primary.main` for a pale hue used in both color schemes | Darken the light scheme's `main`; keep the hue, move the lightness |

## Red flags — stop and use Oxygen

- About to write `<div style={{...}}>`, a `className` with a stylesheet, or a
  raw `<button>`/`<table>`/`<input>` for layout, color, spacing, or a control
- About to `npm install` `@mui/*`, `@emotion/*`, `lucide-react`, or any other
  component or styling library
- About to run `npx @wso2/oxygen-ui init`
- About to write JSX for a form, list, card, dialog, nav, or page header from
  scratch instead of from the Reach-for table and the package's `.claude/patterns.md`
- Thinking "it's just a placeholder" or "Oxygen isn't set up in this app yet"
- Using a sub-component or prop without having confirmed it in
  the package's `.claude/components.md` or the installed `.d.ts`
- About to satisfy a brand-color requirement by styling components instead of
  deriving a theme — or about to ignore one because no stock theme matches
- About to ask which theme or colors to use — that is settled in Brand colors,
  and "not set" means the stock theme, not an open question

All of these mean: stop, open the reference, and use what it documents.
