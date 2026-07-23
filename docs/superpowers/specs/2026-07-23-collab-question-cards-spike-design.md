# Collaborative question cards on the main panel — feasibility spike (UI-only)

**Date:** 2026-07-23
**Status:** Approved design, spike (feasibility exploration)
**Branch:** `spike/collab-question-cards-main-panel` (off `feat/agent-question-cards-ui-270`;
the PR #311 branch stays untouched for review)

## Goal

Prove — UI-side only, no agents-service/backend change — that agent **question
cards** can render on the **main spec panel** via the existing collab (Yjs /
Hocuspocus) room, so **every participant in the project room sees the pending
question live and co-authors the answer**, with the turn-owner submitting it to
the agent.

## Why / context

Today (PR #311) question cards render only in the **agent-chat side panel**, off
the per-browser `chatStore` localStorage log — private to the one user running
the turn. The console already runs a **per-project collab room** (`useCollabSpec`
→ Hocuspocus provider + `Y.Doc`, room `spec-<org>-<project>`) with live presence
avatars, and the agents service already joins that room to stream file edits. A
question is exactly the kind of shared, ephemeral, agent-produced artifact that
belongs in that room. This spike validates the shape before committing to a real
(backend-authored) implementation.

## The seam (why a bridge is needed)

The two halves live in **sibling subtrees that share no reference** and are
co-mounted only on `/projects/$project/spec` (via `AppLayout`'s `<Outlet/>` =
`SpecView`, beside the chat `<Collapse>`):

- `SpecView` (`features/spec/components/SpecView.tsx`) solely owns the room via
  `useCollabSpec` — creates/destroys the `Y.Doc` per mount; no context exposes it.
- The chat fold (`features/agent-chat/runTurn.ts` `case "tool-call"`) receives the
  SSE `ask_question` / `ask_questions` and writes it to `chatStore` only.

## Approach — module-store bridge (chosen)

A tiny module singleton `questionRoom` (mirrors the existing `chatStore` module
pattern) holds the **live `Y.Doc`** for the current project:

- `SpecView` publishes `collab.provider.document` into `questionRoom` on mount and
  clears it on unmount (null when the spec route isn't mounted).
- The chat fold, when it parses a question AND `questionRoom` has a live doc,
  **also** mirrors it into `doc.getMap("questions")`. Hocuspocus fans the write to
  all room peers.

Rejected: a hoisted `CollabDocContext` in `AppLayout` — cleaner React data flow
but requires lifting the doc lifecycle out of `useCollabSpec` (well-working code)
up to the layout, a disproportionate structural change for a spike.

## Data model — `Y.Map("questions")` on the existing project doc

A new top-level shared type alongside `"files"` (no schema migration). Keyed by
`toolCallId` (idempotent re-fold, same rule as `chatStore`'s `upsertByToolCallId`).
Each entry:

```ts
{
  questions: AskQuestionInput[];   // from the wire contract (single = length 1)
  ownerId: string;                 // peer/user id of the turn-owner who mirrored it
  answers: QuestionAnswer[] | null;// the SHARED draft, co-edited; null until touched
}
```

Persisted in the doc → late joiners and reloads see it (unlike ephemeral
awareness). The shared draft is last-write-wins per question (adequate for a
spike); presence avatars already show who is in the room.

## Data flow

1. Agent emits `ask_question`/`ask_questions` over SSE (turn-owner's client only).
2. Chat fold parses it (`parseQuestionsInput`, unchanged) → writes to `chatStore`
   (unchanged) **and** mirrors into `questionRoom`'s `Y.Map` with `ownerId = self`.
3. Hocuspocus syncs the map to **all** room peers.
4. `SpecQuestionBanner` (new) in `SpecView` observes the map and renders the
   existing `QuestionCard` as a full-width banner between the header error `Alert`s
   and the file body — visible to everyone.
5. Any participant edits the **shared draft answer** (writes into the map entry).
6. Only the **owner** sees an active Submit → routes through the existing
   `useAgentChat.answer` → next turn. Non-owners co-author but see Submit disabled
   with a "waiting for &lt;owner&gt; to submit" hint.

## Components

- **New:** `features/agent-chat/questionRoom.ts` (module store: `setDoc`/`getDoc`/
  subscribe, ~30 lines); `features/spec/components/SpecQuestionBanner.tsx` (observes
  the `Y.Map`, renders `QuestionCard`).
- **Touched:** `SpecView.tsx` (publish doc on mount/unmount; render the banner);
  `runTurn.ts` (mirror parsed questions into `questionRoom` when a doc is live).
- **Reused unchanged:** `QuestionCard.tsx` (generic `answerable`/`busy`/`onAnswer`),
  `questionCards.ts`, `@aep/agent-stream` contract + serializers, `useCollabSpec`,
  `packages/collab-doc`.

## Honest limits (what the spike proves — and doesn't)

- **Proves:** all room peers see the question live on the main panel and co-edit a
  shared draft answer, via the real agent → SSE → Yjs → all-clients path, with **no
  backend change**.
- **Does NOT (by design, UI-only):** only the turn-owner can reply to the agent, so
  only the owner's Submit is active. True "anyone submits" needs the reply relayed
  through the owner or a backend change — out of scope, flagged as follow-up.
- **Lifecycle:** if the chat is open but SpecView is unmounted (overview route),
  there is no live doc — the mirror is null-guarded; questions surface on the spec
  route (and in the chat panel everywhere, as today).

## Scope

- **In:** module-store bridge, `Y.Map("questions")`, `SpecQuestionBanner`, SSE→Yjs
  mirror, shared-draft co-editing, owner-gated submit.
- **Out:** agents-service/backend changes, anyone-submits, the chat-panel card
  behavior (unchanged), full test suites (a smoke check only — this is a spike).

## Verification

Two mock browser sessions (same project room, mock mode) or one session + a second
tab: trigger `grill me about this spec` in tab A → confirm the card appears on the
**main spec panel in BOTH tabs**, a selection made in tab B reflects in tab A, and
only tab A (the turn-owner) has an active Submit that advances the turn. Typecheck
+ lint clean; no regression to the existing chat-panel cards or PR #311 behavior.
