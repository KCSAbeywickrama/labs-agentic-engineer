---
name: excalidraw-wireframes
description: Use when creating or updating UI wireframes for a webapp component — sketching screens, forms, lists, or navigation flow.
---

# Wireframes (Excalidraw DSL)

Every `webapp` component gets its wireframes as ONE DSL source file at
`specs/design/components/<name>/wireframes.dsl` — all screens in one file.
Write ONLY the `.dsl`; the platform compiles it to the sibling
`.excalidraw` deterministically. NEVER write a `.excalidraw` file by hand.

## Derive the screens from the requirements

One screen per distinct user task, per role (for an expense app: employee
claim list, claim form, manager review queue, review detail). Don't invent
screens the requirements don't imply.

## The DSL

```
screen <Name>                       // one block per screen; Name is a word (kebab-case ok)
  <kind> "<label>" <x>,<y> <W>x<H>  // one element per line, indented
flow                                // one flow section at the end
  <ScreenA> -> <ScreenB>            // navigation edges between screen names
```

- Element kinds — exactly four: `rect` (inputs, cards, images, containers),
  `button`, `text` (headings, captions), `ellipse` (avatars, status dots).
- The canvas per screen is **360×540** (mobile-frame proportions); `x,y` are
  screen-local from the top-left. Size (`WxH`) is optional — texts auto-size,
  other kinds default to 160×32.
- Layout rhythm: 16px margins; headings at the top (`text "Title" 16,16`);
  full-width inputs are `328x36` stacked with 12px gaps; primary button at
  the bottom of the form. Elements must stay inside 360×540 and not overlap.
- Comments start with `//`. Screen names in `flow` must match declared
  screens exactly.

The compiler lays screens out in a grid, numbers them, and renders each
`flow` edge as a `→(N)` marker on the source screen — you never place
screens relative to each other, only elements within a screen.

Read `references/wireframes-dsl-example.md` for a complete multi-screen
worked example before writing your first wireframe.

## Updating existing wireframes

The DSL is line-oriented, so `editFile` works naturally: anchor on the
`screen <Name>` line plus the element line you're changing. Add a screen by
appending a new `screen` block and its `flow` edges.
