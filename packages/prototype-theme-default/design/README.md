# `@wso2/prototype-theme-default` — design notes

Plain React and CSS custom properties (`--pt-*` tokens on `.pt-root`), no
component library, so the runtimes stay small. Each component file exports its
CSS; `provider.tsx` injects all of it inline, because the frame loads nothing.
Overlays draw in place (fixed position), not in a portal. Buttons are always
`type="button"`: submitting is the kit's.

`scripts/build-runtimes.ts` calls the kit's `buildThemeRuntimes` after `tsc`;
the package ships `dist/frame-runtime.js` and `dist/check-runtime.js`. A new
theme copies this shape: a default-exported `PrototypeTheme` plus the same two
runtime exports, selected with `prototype --theme <package>`.

Known limitation: a closed Dialog or Drawer draws nothing, so `prototype check`
does not render its contents unless a display state opens them.
