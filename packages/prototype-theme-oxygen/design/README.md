# `@wso2/prototype-theme-oxygen` — design notes

Every kit component on `@wso2/oxygen-ui` (MUI underneath), so a prototype looks
like a WSO2 product and like the console. Same shape as
`@wso2/prototype-theme-default`: a default-exported `PrototypeTheme`, plus
`dist/frame-runtime.js` and `dist/check-runtime.js` from the kit's
`buildThemeRuntimes` (`scripts/build-runtimes.ts`, after `tsc`). Select it with
`prototype --theme @wso2/prototype-theme-oxygen`; a host imports the runtimes
by those two subpaths.

## Choices

- **Provider.** Oxygen's base theme with sentence-case buttons (as the console
  sets them), pinned to light with `storageManager={null}`: the frame has no
  storage, and the frame and the render check must draw the same. The kit's
  Annotate colour (`--proto-select`) is Oxygen's primary.
- **Nothing loaded.** Emotion injects styles inline; Oxygen ships Inter as
  `data:` fonts (the frame CSP allows `font-src data:`).
- **No portals.** Dialog and Drawer are drawn in place on Oxygen `Paper`, not
  MUI's `Modal`: a portal leaves the kit's scene (Annotate would not reach
  inside) and draws nothing in the render check. Selects are native for the
  same reason.
- **Selectable roots.** Rows, nav items, tabs, steps and crumbs spread the
  kit's `SelectableRootProps`; `components/root.ts` drops undefined entries so
  they type-check against `ButtonBase`.
- **Required fields** show Oxygen's asterisk; it is `aria-hidden`, so a
  field's accessible name is its label.

## Render check

Oxygen UI's single-module bundle evaluates Prism's language files, which read
a bare `Prism` global that Prism publishes on Node's `global`. The frame has
`window`, the render check's bare context has neither, so this theme's
`scripts/build-runtimes.ts` passes `define: { global: "globalThis" }` to the
kit's `buildThemeRuntimes`.

## Size

Oxygen's bundle cannot be tree-shaken (it pulls in `@mui/x-data-grid`, Prism
and the inlined fonts with any import). Measured 2026-10-03, minified:

| runtime | Oxygen | gzip | default theme | gzip |
|---|---|---|---|---|
| `frame-runtime.js` | 2.13 MB | 722 KB | 0.89 MB | 213 KB |
| `check-runtime.js` | 1.49 MB | 584 KB | 0.24 MB | 73 KB |

`@wso2/oxygen-ui-icons-react` imports a small CSS file (Lucide stroke width),
so esbuild also writes `frame-runtime.css` and `check-runtime.css`. Nothing
loads them; icons draw at Lucide's default stroke.

## Tests

`test/check.test.ts` runs the CLI's `prototype check --theme` over the CLI's
fixtures: every valid one passes, and each render-stage failure reports what
the default theme reports. `pnpm test:browser` plays three fixtures under
`prototype preview --theme` in Chromium (navigation, forms, tabs, dialog,
drawer, stepper, Annotate, no requests beyond the preview server).
It also fails on any uncaught error in the page or its sandboxed frame. The
frame has no `allow-same-origin`, so `localStorage` throws there; Oxygen and
MUI X only touch it inside try/catch (a probe, `storageManager={null}` for the
colour scheme), so a prototype raises nothing. A harness that runs its own
script in every frame (a Playwright init script writing `localStorage`) does
raise it, in its own code: guard such a script or run it in the top frame only.
