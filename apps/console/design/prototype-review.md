# Prototype review

A clickable prototype of each designed web application, tried and commented on
in the browser. Design makes it in its own run, the person reviews it from its
item on the Design card ([design-card.md](design-card.md)), and each comment
is a Pending draft on the prototype in `specs/design/review.json`, sent with
the rest by Address comments on the Overview (L3). Why it is shaped this
way: [ADR-0001](decisions/ADR-0001-prototype-review-is-a-full-screen-overlay.md)
(the overlay), [ADR-0002](decisions/ADR-0002-the-revision-lands-in-the-open-review.md)
(the revision lands in the open review),
[ADR-0003](decisions/ADR-0003-the-comment-bubble-is-drawn-by-the-host.md)
(the bubble is the host's, over the frame).
Code: `features/prototype/`. The spec is wso2/labs-agentic-engineer#885
(tickets #886–#890, #892, #893); there is no PRD entry for it in this repo.

## Where it shows

- **Design card:** the prototype is an item of the rail, under its web
  application (`expense-web › Prototype`), keyed by `prototype.json`, with
  its title line (Checked, 💬) over `PrototypeEntry`: the app's name, its
  status (Ready, Invalid with the reason in a tooltip, Revising while a
  design run works on it) and Review, which opens the review over the card
  (`?review=<component>`). There is no Prototype tab, no Prototype route
  and no Make prototype.
- **Chat:** an "Open prototype" note after a `/prototype` exchange that wrote
  a prototype which is valid now (one component opens its item on the Design
  card, `?art=prototype-<component>`; several, the card). It is derived (`model/note.ts`) from the log, which the
  history carries, and the room, so a reload and teammates see it too.

## Files

A prototype is `specs/design/components/<c>/prototype.{json,tsx}` in the room,
read with `useRoomFiles`. Status comes from the kit's `parseManifestJson`
(`model/prototypes.ts`). The agent's writes are gated by the kit's rules and the
render check; Go re-checks on save (see ADR-0042).

## Review

`PrototypeReview`: a header of only the title and Close (X, Esc), the kit
`PrototypeWindow` (browser chrome, read-only `prototype://<screen>` address
bar; styled by the console with `--proto-window-*` Oxygen variables) around
the `PrototypeFrame` at full width, and below it one floating dock
(`ReviewDock`) holding every control, in three groups split by dividers:

- **View** (`ViewControls`): Role and State, two compact native selects (the
  name inline before the value), and Reset data (an icon button, its name in
  the tooltip).
- **Mode** (`ModeTools`): the Preview · Comment tool pair (labelled, with
  icons, `V` and `C` in tooltips; the active tool tinted primary in Comment,
  neutral in Preview) and, in Comment mode, "Click anything to comment".
- **Comments** (`CommentQueue`): `N comments` (its list holds Comment on
  this screen) and where they go: "N pending · sent with Address comments on
  the Overview", or "The agent is revising the prototype…" while a run does.

There is no screen or flow picker: the reviewer moves through the prototype
by using it (Preview), and an entry in the comment list goes to its comment's
screen, role and state. The view starts on the manifest's entry screen; the
kit reducer's `NAVIGATE` and `SET_FLOW` stay for the frame and the kit CLI.

The dock sits below the window in the layout (a column: window, then dock),
so its space is reserved and it never covers the prototype's last rows; what
it opens grows upward over the prototype. Below 1100px it drops the Comment
mode hint (the window's tag still says it); below 1000px the selects drop
their inline names and keep the value. Bubbles stay inside the stage (the
window's area, `BubbleBounds`: Popper's flip and overflow boundary), so a
bubble at the window's foot never covers the dock; a whole-screen comment's
bubble opens at its spot, or (from the list) above the dock.

The view and the open comment bubble are one pure state, the kit's
(`reduceReview` in `@wso2/prototype-kit/host`: the view reducer plus
`CommentBubble` = on the selection, on the whole screen (at a spot, or from
the list), or a queued comment opened from the dock's list or a pin). Comment is the user's word for the view's
`annotate` mode. `V` returns to Preview, `C` toggles Comment (neither while
typing); Escape closes the bubble,
then clears the selection, then closes (the kit's `useReviewKeys`, captured so
a used Escape never reaches the dialog). With focus in the prototype, only
the frame's `proto:escape` counts (sent when the prototype left the key
unused); the review ignores an Escape whose target is the frame.

Comment mode shows itself three ways, only while it is on: a primary ring
round the prototype window (its `--proto-window-border`/`-shadow`), a
"Comment mode · Esc" tag in the window bar (`PrototypeWindow`'s `tag`), and
the dock's hint "Click anything to comment". Inside the frame the kit
draws the comment cursor (an arrow with a bubble: solid with a "+" over an
element that takes a comment, hollow over empty space), so it follows the
pointer natively with no bridge message. A click where it is hollow is a
whole-screen comment there (`proto:screen-click`).

- **Bubble** (`CommentBubble`, `QueuedCommentBubble` in `AnchoredBubble`): an
  click in Comment mode opens it at the element (Shift-click adds elements), drawn by
  the console over the frame from the boxes the frame reports
  (`useFrameAnchors`), never inside it (ADR-0003). Add or Cmd/Ctrl+Enter
  queues the comment. A click away closes it; focus stays where the click
  put it, and when it put it nowhere (the dialog's blank parts), it goes
  back to the element (the kit's `focusLeftBehind`). A click on empty space
  in the prototype opens a whole-screen comment at that spot (the kit's
  `SCREEN_CLICK`; `useFrameAnchors().point` places the bubble there and
  keeps it there as the prototype scrolls), with a hollow pin at the spot
  while it is written; with a bubble open, it only closes it.
- **Comments** (`CommentQueue`, the dock's group): `N comments`, the
  pending note, and a list, opening upward over the prototype, of every queued
  comment across screens, roles and states, ending in `Comment on this
  screen` (the keyboard's whole-screen comment, its bubble at the dock; the
  pointer's is a click on empty space), its elements named
  by their labels (the kit's `targetLabel`, from each visited screen's
  labels as the frame reported them; ids for a screen not seen since a
  reload). An entry goes to its screen, role and state, opens the
  comment and closes the list. It marks comments written on an earlier
  version and flags those whose element is gone. Callouts above the dock say
  why a revision can't be shown, that the queue is full, and how many
  comments were written on an earlier version or lost their element. Its empty
  list says how to start: "Press C or choose Comment, then click anything on
  the screen: an element, or empty space for the whole screen".

- **Preview** acts: navigation, forms, mock data. **Comment** only selects;
  selected elements are pinned and a comment is typed against them (max 4000
  characters, 50 queued per prototype, the kit CLI's limits; the contract
  calls a comment a request).
- **Pins:** a queued comment's pin (the frame's, in both modes, keyboard
  reachable) opens its bubble (`OPEN_PIN`) with Edit (in place) and Remove
  (the rest renumber). A whole-screen comment made at a spot has its pin
  there, drawn by the frame at the spot of its document so it scrolls with
  the page (`FrameView.screenPins`); one made from the list has none. Closing
  a bubble with Escape, Add or Remove puts focus back on its element or pin
  (`PrototypeFrame.focusElement`, `focusScreenPin`). Each screen's pins are
  drawn whenever it shows, so comments on several screens, roles and states
  all wait together for Address comments.
- **Drafts** (the kit's `useCommentDraft`, the same in the kit CLI's
  preview): the text of a bubble on elements is never lost. Escape, a click
  away, a plain click on other elements or closing the review keeps it as a
  draft, shown as a hollow pin; selecting the same elements or clicking the
  draft pin reopens it. A draft pin clicked in Preview switches to Comment
  (`SELECT_ELEMENTS`) and reopens it there. Drafts are not counted, and
  never leave the browser. A whole-screen comment's text is kept the same
  way, as the screen's draft, its hollow pin at its spot (none without one);
  the pin, the next click on empty space or Comment on this screen reopens
  it.
- **Queue** (the kit's `FeedbackQueue`, made of `review.json`;
  `model/reviewDrafts.ts`): the reviewer's own Pending drafts on the
  prototype, in the file's order, each with its anchor (screen, flow, role,
  state, elements). Queueing a comment adds a draft, editing it edits the
  draft, Keep as screen comment empties its elements, Remove deletes it: each
  one write of the file through `useDesignReview` (`PrototypeReviewHost`). A
  teammate's drafts show in the prototype's 💬 panel, not in the queue. What
  the file does not hold this browser remembers for the comments it wrote:
  the revision each was written on, and a whole-screen comment's spot, so its
  pin stays there (a draft from elsewhere is on the revision showing, with no
  spot). Comments, limits, pins and the hash are the kit's
  (`@wso2/prototype-kit/feedback`); the hash is plain JavaScript, so it works
  over plain HTTP. No comment rides a turn: the retired `prototypeFeedback`
  is gone from the wire.
- **Revision** (ADR-0002; `model/revision.ts`, kept per project and
  component in the review store, `model/reviewStore.ts`, which
  `usePrototypeReviews` reads): the store lives for the page, like the chat
  store, so the review outlives the overlay and the Design card. While a
  design run (Design, or Address comments) may rewrite the prototype, the
  review shows the last ready revision, not the files the agent is still
  writing. When the run ends with a changed prototype, the new revision swaps
  in through `MANIFEST_REPLACED` (same screen, role and state, else the
  role's entry screen), the frame reloads from the seed data, and an
  `Updated` toast offers What changed (closes the review, opens the chat at
  its latest turn); a run that left it as it was, or made the first one, says
  nothing. Comments queued before it are marked "Written on an earlier
  version", and checked against the elements the frame says it draws for the
  revision and view now showing (the kit's `orphansOnScreen`, same screen,
  role and state only; a report from before the swap is not used, as the
  frame echoes the version it drew and `PrototypeFrame` drops a report of an
  earlier one; nor is one of another screen), so a comment is flagged
  "Element no longer on this screen" when its screen is visited, with Keep as
  screen comment (`keepOnScreen`) or Remove. A revision that is invalid keeps
  the last ready one showing, with the reason. Reopened mid-run, the review
  shows the same state.

## Mock

The mock's design run writes the kit's sample prototype
(`mocks/fixtures/prototype.ts`) with the rest of Acme's design. Its Address
comments turn revises it for a comment the sample knows: "on the right" and
"bigger total" apply, "remove" takes the Reject button away (orphaning
comments on it). A `/prototype` typed in the chat still makes it when it is
missing.

## Theme

`@wso2/prototype-theme-oxygen`, drawn with the console's own theme
(`@aep/ui-theme`, the `aepTheme` `main.tsx` applies), so the prototype and the
console cannot drift. Until the frame's app first draws, the review passes
`PrototypeFrame` a loading state ("Starting the prototype…") that covers the
frame, so a click while the runtime starts is not lost; a frame that never
draws shows the kit's "didn't start" error instead. The review passes the
console's resolved scheme (`useColorScheme`: the mode, or the system's under
System), so the prototype is light or dark with the console. Its frame has no
storage (opaque origin), so a script that touches `localStorage` in every
frame (for example a Playwright init script) raises there; limit it to the top
frame.
