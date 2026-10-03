# Prototype review

A clickable prototype of each designed web application, tried and annotated in
the browser. The agent makes it (`/prototype`), the person reviews it, and
Annotate feedback goes back to the chat as a typed batch. Why it is shaped this
way: [ADR-0001](decisions/ADR-0001-prototype-review-is-a-full-screen-overlay.md).
Code: `features/prototype/`.

## Where it shows

- **Prototype tab** (`PrototypeWorkspace`, route `projects/$p/prototype`): one
  row per web application (a contract artifact whose `design.json` type is
  `web-application`) with status None, Ready, Invalid (with the reason) or
  Revising, Review, and Make or Update. The tab shows a dot while a prototype
  is unreviewed.
- **Design actions:** Make prototype (`MakePrototypeButton`), hidden until the
  design has a web application. One app sends `/prototype <c>`, several send a
  bare `/prototype`. Disabled unless the chat can send.
- **Chat:** an "Open prototype" note when a `/prototype` turn completes (one
  component opens its review, a bare turn opens the tab).

## Files

A prototype is `specs/design/components/<c>/prototype.{json,tsx}` in the room,
read with `useRoomFiles`. Status comes from the kit's `parseManifestJson`
(`model/prototypes.ts`). The agent's writes are gated by the kit's rules and the
render check; Go re-checks on save (see ADR-0042).

## Review

`PrototypeReview`: toolbar (Screen, Flow, Role, State, Reset data,
Preview/Annotate), the kit `PrototypeFrame`, and in Annotate the
`FeedbackPanel`. A live revision replaces the manifest in place
(`MANIFEST_REPLACED`). Escape clears the selection, then closes.

- **Preview** acts: navigation, forms, mock data. **Annotate** only selects;
  selected elements are pinned and a request is typed against them (max 4000
  characters, 50 requests per batch, the kit CLI's limits).
- **Queue** (`model/feedback.ts`): per component, kept across close and reopen.
  It carries the hash of the revision of its first request
  (`prototypeHash`, byte-identical to the CLI's).
- **Send all:** refused with the reason while the chat is not idle (queue
  kept). Otherwise `chatStore.send("/prototype <c>", {kind: "prototype",
  feedback})`; on success the queue clears and the overlay closes. The chat
  row shows `feedbackSummary` (`model/summary.ts`), not the wire text.
- **Reviewed dot:** `model/reviewed.ts` stores `{component: hash}` in
  localStorage (`aep:prototype-reviewed:<project>`); every access is guarded.

## Wire

`turnBody` puts `prototypeFeedback` (`PrototypeFeedbackInput`, from the
generated API types) on the JSON body with `collab: true`; the instruction is
the bare `/prototype` or `/prototype <c>` with the same component. The mock
(`mocks/fixtures/prototype.ts`) writes the manifest then the source, answers
feedback by number, and refuses a bad batch as Go does.

## Theme

`@wso2/prototype-theme-oxygen`. Its frame has no storage (opaque origin), so a
script that touches `localStorage` in every frame (for example a Playwright
init script) raises there; limit it to the top frame.
