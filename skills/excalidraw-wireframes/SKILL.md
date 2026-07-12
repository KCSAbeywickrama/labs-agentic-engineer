---
name: excalidraw-wireframes
description: Use when creating or updating UI wireframes for a webapp component — sketching screens, forms, tables, dashboards, or navigation flow.
metadata:
  aep:
    kind: platform
---

# Wireframes (Excalidraw DSL)

Every `web-application` component gets its wireframes as ONE DSL source file at
`specs/design/components/<name>/wireframes.dsl` — all screens in one file.
Write ONLY the `.dsl`; the platform compiles it to the `.excalidraw`
deterministically. NEVER write a `.excalidraw` file by hand.

Wireframes are **low-fidelity but product-flavored**: they validate layout,
hierarchy, and flow, not pixel-perfect visuals. The compiler applies the look
for you — the Oxygen UI palette (light surfaces, neutral borders, WSO2 brand
orange on primary actions and active navigation) plus a sketchy hand-drawn
style. You decide *structure and content*; add a semantic `variant` only where
color should carry status meaning (see "Color" below).

Produce **one canonical set of screens** — the agreed design, not a gallery of
alternatives. One screen per distinct user task, per role (for a store: a
product list, a product detail page, a checkout form). Don't ship two takes on
the same screen.

### Where the screens come from — read the design first

You have up to three sources in context; read them in this order of priority:

1. **`specs/design/design.md`** — the architecture doc for the whole system.
   This is your **primary** source for screens: it names the user roles, each
   component's responsibilities, and the main flows. Derive the screen list from
   here first. (It may not exist on every turn — if it's absent, promote the
   requirements to primary.)
2. **`specs/requirements/`** (requirements / user stories) — the **detailed**
   source. Use it to flesh out each screen and to catch tasks the design doc
   only summarized: specific fields, states, rules, and edge cases (out-of-
   stock, guest vs. signed-in, validation errors).
3. **This component's `specs/design/components/<name>/design.json`** — a thin
   per-component summary; use it mainly to **scope**, not for screen content:
   its `type` (draw wireframes only for `web-application`), its one-line
   `description`, and its `dependencies` (e.g. a Thunder/auth dependency means
   there's a signed-in vs. guest distinction → likely role-specific screens).

**Cover every task.** Walk the design and requirements and make sure each
distinct user-facing task — for each role they name — has a wireframe screen
that serves it; nothing user-facing should be left without a view. Equally,
don't invent screens the design doesn't imply. A quick check: list the
tasks/roles, and for each name the screen that fulfills it — a task with no
screen is a gap, a screen with no task is noise.

## What makes a wireframe good

A good wireframe reads like a real screen someone could use, and it explains
itself. What carries the quality:

- **Real content, not placeholders.** Write "Open risks: 24", "Platform team",
  "Overdue" — never "text here" or "label". The wireframe is a communication
  artifact; concrete content is what makes a layout legible and reviewable.
- **Say what each view is.** Give every screen a description (the quoted phrase
  after its name) so anyone can tell at a glance what the view does and who
  uses it — not just infer it from the widgets.
- **A clear visual hierarchy.** A page has a title, then primary content, then
  secondary detail. Use `heading` for section titles (it renders prominently);
  size and position should make the most important thing obvious. One dominant
  action per screen (the primary button).
- **A consistent grid and rhythm.** Align elements to shared edges; stack with
  even 16–24px gaps; give related things the same width. Sloppy alignment is
  the single biggest thing that makes a wireframe look amateur.
- **The right primitive for each thing.** A status is a `badge`, not text. A
  section switch is `tabs`. A person is an `avatar`. Picking the primitive that
  matches the real UI element is most of what makes screens feel real.

## Roles change the screens — always show them

Most real apps have more than one kind of user, and the *same feature looks
different for each*. This is the single most common thing wireframes get wrong:
they show one generic view and hide the fact that an admin and a regular user
actually see different screens. Don't do that.

**First, identify the roles.** Read `design.md` for distinct user types —
admin/manager/owner vs. member/employee/developer vs. viewer/customer (the
design doc usually spells the roles out; the requirements add the detail, and a
`design.json` auth dependency is a strong hint a signed-in role exists). If the
app has more than one, roles are in scope even when the prompt doesn't say "per
role."

**Then, for each role, show its main view and how it differs.** At minimum,
give every role its own `screen` for the primary task they do, named and
described for that role — because the difference is usually *capability*, not
cosmetics. The same feature splits into genuinely different screens:

- The one who **approves/administers** gets a queue or roster with the action
  and the columns to act on (Approve/Reject, an "assignee" column, bulk
  controls); the one who **submits/contributes** sees only their own items with
  a single Submit/Upload action — no approve, no assign.
- The one who **owns** a record edits it (an Edit form, private stats, a
  Reassign control); the one who **consumes** it sees the same record read-only,
  able at most to comment or take the one action meant for them.

Two roles, two screens — the admin's screen simply *has* buttons and columns the
member's does not. Show both.

Rules of thumb:

- Name the screen for its role and put the role in the description:
  `screen ReviewQueue "Manager reviews and approves pending requests"`.
- **A role screen is the SAME app — keep the identical `navbar` and `sidebar`
  every other screen uses**, with the same items in the same order, and lay its
  content out in the same content area (with a sidebar, `x ≥ 264`). The role
  changes what's *inside* the screen — which buttons, columns, rows — not the
  shell. Do NOT give a scoped/secondary role its own smaller sidebar (e.g.
  `"My Engagements | Reports"`) or start its content at `x≈40` as if there were
  no rail; that renders the content on top of the sidebar. If a role genuinely
  has fewer sections, still show the full sidebar (its extra items just aren't
  where that role acts) — a per-role mini-sidebar reads as a different app.
- Reflect the real difference in **actions and data** — a role that can't
  approve/assign/delete simply doesn't have that button or column. Don't reskin
  one layout and call it two. The role difference should be legible from the
  screen itself (which buttons and columns are present), not spelled out in a
  caption.
- A screen that is genuinely identical for everyone (a shared login, a generic
  detail page) stays single — don't fork it just to have a matching set.

## Proven screen anatomies

Most webapp screens are one of three shapes. Follow these anatomies — they're
what makes a wireframe read like a designed product instead of a pile of boxes.
(Every `navbar` includes a notification bell + account avatar at its top-right:
the compiler draws this account cluster as part of the `navbar` itself — the
same way a real app header always shows the signed-in user — so it's identical
on every screen. This is by design, not a stray extra; don't add an `avatar` or
bell of your own to the navbar, and don't try to remove them.)

**Dashboard / landing** (top → bottom):

1. A small muted eyebrow (`text`, e.g. the team or context: "OPERATIONS") at
   `y≈76`, then a human `heading` ("Good morning — here's where things stand")
   just below it at `y≈104`, with `search` (and a filter `select`) on the
   heading's line, right side. The eyebrow is the TOP row — keep it at `y≥72` so
   it clears the navbar. Don't anchor the heading at `y≈80` and stack the
   eyebrow above it at a smaller `y` (that slides the eyebrow under the bar);
   the eyebrow comes first, the heading sits below it.
2. A row of stat-tile `card`s — `card "Open items | 47 | across 5 active
   projects"` — 3–4 tiles, same size, same `y`. Every number gets its label and
   a caption that explains it.
3. A grid of rich entity cards (one per project/order/record/…): compose them by
   LAYERING elements inside a plain `card`'s bounds — a small muted `text`
   eyebrow ("PROJECT · ACTIVE"), a `text` title, a `progress "47/60"`, a meta
   `text` line ("47 of 60 tasks · Due 14 Sep"), and a status `badge` at the
   card's top-right (`success`/`warning` variant: "On track"/"At risk").

   Every layered element must sit FULLY INSIDE the card — the compiler draws
   each element exactly where you place it, so an element whose coordinates spill
   past the card's edge will straddle the border. For a card at `x,y` sized
   `w×h`, keep inner content at `x+16 … x+w-16`. A top-right `badge` of width
   `bw` therefore goes at `x + w - 16 - bw` (NOT at `x + w`, which pushes it
   over the right border). Give the eyebrow/title room too: don't let a long
   title `text` run under the badge — end the title before `x + w - 16 - bw`, or
   shorten it.
4. A "Needs your attention" `table` whose LAST column is the action — put
   "Review →" / "Follow up →" in each `row`'s final cell.

**List / queue**: `heading`, then a row of filter `badge`s with counts
("All (146)", "Open (23)", "Resolved (98)", …) or `tabs`, then a full-width
`table` with real `row`s — status as a word in a status column, owner, due
date, and a trailing action cell.

**Detail / record** (the screen for ONE item): `breadcrumb`, `heading` with
status `badge`s beside it, a short description `text` — then TWO columns with a
**vertical `divider` between them** (`divider "" 760,180 1x420` — a
taller-than-wide divider renders as a vertical rule):

- **Left (main, ~60%)**: the item's content — e.g. a bordered panel `card` with
  detail `text` lines, an items/records `table` with rows, an "Upload new" /
  primary action.
- **Right rail (~35%)**: the collaboration side — a "Discussion" `card` with a
  few comment `text` lines (author + time + message), a comment `textarea` +
  "Post" `button`, and an "Activity" list of timestamped `text` rows ("2 days
  ago — J. Alvarez uploaded report-final.pdf"). Budget the rail's height so both
  sections fit without overlap: the Discussion `card` takes about the TOP HALF
  (e.g. `card "Discussion" 784,176 416x280`, ending ~`y456`, with its comment
  lines and the `textarea`+`Post` composer inside it), then `heading "Activity"
  784,476` and its rows go BELOW the card. Do NOT stretch the Discussion card to
  the full rail height (~420) — that leaves nowhere for Activity, so it ends up
  on top of the composer. Keep each comment `text` SHORT (a phrase, not a
  sentence) so it fits the ~400px rail width.

Always put the `divider` between the two columns — the rule is what makes it
read as two distinct areas instead of floating content.

**Keep the columns from overlapping** — this is the one mistake to avoid here.
The left column's widest element (usually the `table`) must END before the
divider, and the right rail must START after it. With a sidebar app on a
1280-wide screen, a layout that always fits: left content at `x=280` with
`width ≤ 440` (so it ends by ~720), `divider "" 760,180 1x420`, right rail at
`x=784` with `width ≤ 440`. Do NOT reuse a single-column full-width `table`
(`940` wide) on a two-column screen — a 940-wide table starting at 280 runs to
1220 and buries the divider and the entire right rail underneath it. Narrow the
left table to the left column, or drop to a single column if the content truly
needs the full width (in which case there's no right rail and no divider).

A record's conversation and history belong in this right rail, beside the
record — not on a separate screen. That's where users expect to pick up the
discussion and see what changed.

## The DSL

```
screen <Name> ["what this view is for"] [WxH]   // desktop 1280x800 default; quoted description optional
  navbar "App | Nav1 | Nav2"         // full-width top bar; pipe-separated items; no coordinates
  sidebar "Item1 | Item2 | Item3"    // left rail below the navbar; no coordinates
  <kind> "<label>" <x>,<y> [WxH] [variant] [-> Screen]   // -> Screen: this element navigates there
  button "Add to cart" <x>,<y> [WxH] primary -> Cart     // e.g. a button that opens the Cart screen
  table "Col1 | Col2" <x>,<y> [WxH]
    row "cell | cell"                // optional; realistic table data, one per body row
```

Give every screen a **description** — a short quoted phrase after the name
saying what the view is for and who uses it. It renders as a subtitle under the
title and is the fastest way to make a wireframe self-explanatory:
`screen ReviewQueue "Managers approve or reject pending requests"`.

**Navigation** is attached to the control that triggers it: put `-> ScreenName`
at the end of the button (or link) that leads there, and the compiler draws a
`→ Screen N · ScreenName` marker beside it. This is how you show the flow
between screens — usually on buttons like "View", "Open", "Continue",
"Checkout". Leave a little empty space to the right of a navigating button so
the marker has room. The target must be a `screen` name that exists.

### Element kinds

Chrome & structure

| Kind | Use for | Default size |
|---|---|---|
| `navbar` | app top bar (first line of every screen); `\|`-separated items | full width × 56 |
| `sidebar` | section navigation rail; `\|`-separated items | 240 × full height |
| `tabs` | in-page section switcher; `\|`-separated, first shown active | 480×40 |
| `breadcrumb` | trail like `"Projects / Acme / Settings"` | auto |
| `divider` | a rule between sections — horizontal, or **vertical** when taller than wide (`1x420`, e.g. between two columns) | width×1 |

Content & data

| Kind | Use for | Default size |
|---|---|---|
| `heading` | page / section titles (renders large with an underline rule) | auto |
| `text` | body copy, values, helper text | auto |
| `link` | inline navigation text (renders blue) | auto |
| `card` | stat tile — `"Open items \| 47 \| across 5 projects"` (label, BIG value, caption); a one-part label is a plain panel/container | 300×160 |
| `table` | data grids; label = `\|`-separated headers; add `row` lines for data | 640×240 |
| `list` | stacked rows (feed, comments, nav); `\|`-separated items | 320 × n·40 |
| `image` | logos, photos, media slots (renders a crossed box) | 240×140 |
| `chart` | data viz placeholder (renders axes + bars) | 320×180 |
| `progress` | progress bar; label as `"60%"`/`"3/4"`/`"0.6"` sets the fill | 240×10 |
| `badge` | status pills — `"Open"`, `"Overdue"`, `"Live"` (color via variant) | auto |
| `avatar` | a person — label `"Jane Doe"` renders initials `JD` | 40×40 |
| `icon` | a small glyph slot; label is 1–2 chars | 24×24 |

Inputs & controls

| Kind | Use for | Default size |
|---|---|---|
| `input` | text field; label is the placeholder | 320×36 |
| `textarea` | multi-line field | 320×96 |
| `select` | dropdown (renders a ▾) | 320×36 |
| `search` | search box (renders a ⌕) | 320×36 |
| `button` | actions; the bottom-most button gets the flow marker | 140×40 |
| `checkbox` / `radio` | options; add `active` variant to show it selected | auto |
| `toggle` | on/off switch; add `active` variant for on | 44×24 |

Generic (use only when nothing above fits)

| Kind | Use for | Default size |
|---|---|---|
| `rect` / `ellipse` | a container or shape with no better primitive | 160×32 |

### Color

The compiler already applies the Oxygen theme: white/neutral surfaces, the WSO2
brand orange on the active navbar/sidebar item, and orange section-heading
rules. You don't set any of that — it's automatic.

You add color only through a trailing **variant** on an element, to carry
*status meaning*: `primary`, `secondary`, `danger`, `success`, `warning`,
`info`, `ai`, `active`, `muted`.

- `primary` on the ONE main action per screen (`button "Create" ... primary`)
  — fills brand orange. Every other button stays a plain outline.
- `danger` / `success` / `warning` / `info` on a `badge` or destructive
  `button` to signal status or severity (`badge "Overdue" ... danger`).
- `ai` (purple) reserved for an automated / AI-driven step, if the product has
  one.
- `active` marks a `checkbox` / `radio` / `toggle` as selected / on.

Keep status variants purposeful — a screen dense with red/green/amber badges
stops communicating. Let the theme carry the "product" feel; use variants for
the handful of things that genuinely signal state.

### Layout rules

The platform **validates layout at write time**: an element outside the frame,
under the navbar/sidebar, or partially overlapping another is rejected with a
`LAYOUT_VIOLATION` error listing the exact coordinates — fix them and retry.
(Fully nesting one element inside another — a badge inside a card — is
layering and always allowed.)

- **Everything stays inside the screen.** The frame is 1280×800. Every element's
  right edge (`x + width`) must be ≤ **1240** (a 40px right margin) and its
  bottom (`y + height`) ≤ **760**; nothing extends past the frame. For anything
  right-aligned — a header filter `select`, a top-right button, a footer action
  — compute its `x` from the edge (`x = 1240 − width`), never by eyeballing a
  large number. Elements without an explicit `WxH` get a DEFAULT size (a
  `chart` is 320 wide, a `select` 320) — placing one near the right edge
  without a size makes it overflow, so always give near-edge elements an
  explicit `WxH`. Check `x + width ≤ 1240` for every element on the right or
  bottom edge before finishing.
- **Header search + filter: use these exact slots** (this pair is the most
  common collision — don't re-derive it):
  - With a sidebar: `search "…" 820,104 240x36` then `select "…" 1076,104 164x36`
    (search ends 1060, filter ends 1240 — 16px gap).
  - Without a sidebar: `search "…" 780,104 280x36` then `select "…" 1076,104 164x36`.
- **Filter chips / badge rows: give every `badge` an explicit width and place
  the next chip from it.** A `badge` with no `WxH` auto-sizes to its label, so
  its real width is a guess — and guessed chips collide. Width a chip at
  roughly `10 × characters + 30` and start the next chip at the previous
  chip's `x + width + 12`: `badge "All (18)" 280,150 110x24`,
  `badge "Overdue (2)" 402,150 140x24`, `badge "Changes requested (3)" 554,150 250x24`.
- **Nothing sits under the navbar.** The `navbar` fills the top band of every
  screen (frame-relative `y` 0–56). So the FIRST content element — including any
  muted eyebrow/label above the heading — starts at `y ≥ 72`. The most common
  overlap is an eyebrow crammed above an `y≈80` heading at `y≈52`, which slips
  under the bar: put the eyebrow at `y≈76` and the heading at `y≈104` instead.
- **The left margin depends on whether the screen has a sidebar.** Then:
  - **With a `sidebar`** (a 240px left rail): content starts at `x ≥ 264` and
    full-width elements (tables/charts) are ~940 wide.
  - **Without a sidebar**: content starts at `x ≈ 40` — a plain page margin —
    and uses the FULL width (full-width elements ~1200 wide). Do **not** indent
    to `x=280` when there is no sidebar; that leaves a dead empty strip on the
    left where the missing rail would be. Either add a sidebar to fill it or
    start at `x≈40`.
- **One primary navigation, not two.** Pick where the section links live and
  put them in exactly one place:
  - **Sidebar app** (content-heavy tools, admin consoles, dashboards): the
    `sidebar` holds the section links, and the `navbar` carries ONLY the app /
    brand name — e.g. `navbar "Acme"`. The compiler adds the
    notification bell + account avatar to the right of the navbar automatically,
    so a brand-only bar is complete. **Do not repeat the sidebar's links in the
    navbar** — that's the duplicated top+left nav that reads as a bug.
  - **Top-nav app** (simple public flows — storefront, checkout, marketing):
    the `navbar` holds the links (`navbar "Shop | Cart | Account"`) and there is
    **no `sidebar`**.
  Choose one model per app and keep it consistent across every screen —
  **including role-specific and scoped screens**. The `sidebar` is identical
  (same items, same order) on all of them; a screen never gets its own shorter
  sidebar. With a sidebar, EVERY screen's content starts at `x ≥ 264` — content
  at `x≈40` on a screen that has a sidebar lands on top of the rail.
- Stack vertically with 16–24px gaps; align related elements to the same `x`;
  give a row of cards/inputs the same `y` and width. Keep everything inside the
  screen and never overlapping.
- **Right-align a screen's action buttons.** A form or dialog's footer buttons
  (Cancel / Save, Back / Continue) sit at the **bottom-right** of that form —
  the primary action rightmost — not at the left. Compute their `x` from the
  right edge of the content, not the left. A single page-level CTA ("New", "Add
  …") goes top-right. When two buttons sit side by side, put the `-> Screen`
  nav marker only on the **primary/forward** one (a marker on the left button
  would collide with the button to its right); a Cancel/Back button rarely
  needs a marker.
- Repeat the SAME `navbar` (and `sidebar`) verbatim on every screen of one app
  — consistent chrome is what makes screens read as one product.
- Comments start with `//`. `-> Screen` targets must match a `screen` name
  exactly; every screen should be reachable from some control.

Read `references/wireframes-dsl-example.md` for a complete worked example
before writing your first wireframe.

## Updating existing wireframes

The DSL is line-oriented, so `editFile` works naturally: anchor on the
`screen <Name>` line plus the element line you're changing. Add a screen by
appending a new `screen` block and its `flow` edges. Add table data by
inserting `row` lines directly under the `table`.
