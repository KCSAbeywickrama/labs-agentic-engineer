# Design: Team Lunch Ordering

## Overview

Team Lunch Ordering is a small web app that lets any teammate on a single
~40-person team open a daily lunch round for a restaurant, collect items and
prices from teammates before a cutoff, and produce a consolidated,
per-person order once the round closes. Users sign in via the company's
Google Workspace SSO (federated through the platform's Thunder identity
service), and the app posts round-open and cutoff notifications to the
team's Slack channel. The system is a single web-application backed by one
API service and its database — no separate group/tenant model, no menu
catalog, no in-app payment.

## Components

- **lunch-webapp** (`web-application`) — the single-page app teammates use to
  sign in, open rounds, browse/add items, close rounds, and view the
  consolidated order and history.
- **lunch-api** (`service`) — the backend REST API: owns rounds and items,
  enforces cutoff/authorization rules, computes the consolidated order, and
  posts Slack notifications on round open/cutoff.

## Capabilities

### lunch-webapp

- **Sign in** — Google Workspace SSO via the platform's Thunder-backed OIDC
  flow; no local accounts.
- **Open a round** — form to set restaurant name, cutoff date/time, and
  optional notes.
- **Browse open round** — shows restaurant, cutoff countdown, and the live
  list of items added so far with who added each.
- **Add / edit / remove items** — add one or more items (description,
  quantity, price); edit or remove only the items the signed-in user added,
  while the round is open.
- **Manual close** — the opener can close their round early.
- **Consolidated order view** — once closed: items grouped by description
  with total quantities, a per-person breakdown of items/cost, and a grand
  total.
- **History** — list of past closed rounds, each opening into its
  consolidated order.

### lunch-api

- **Round lifecycle** — create a round (enforcing only one open round at a
  time), auto-transition to closed once cutoff passes, and manual close by
  the opener.
- **Item management** — add items to an open round before cutoff; edit/remove
  an item only by the teammate who added it, only while open; reject writes
  after cutoff with a clear error.
- **Consolidation** — once a round is closed, compute items grouped by
  description with summed quantities, a per-person list of items + their
  cost total, and the round's grand total.
- **History** — list and fetch past closed rounds and their consolidated
  order.
- **Slack notifications** — post a message to the team Slack channel when a
  round opens and again when it closes (cutoff or manual).
- **AuthN/authZ** — validate the signed-in identity on every call; any
  signed-in teammate may open rounds/add items; only an item's own author may
  edit/remove it; only a round's opener may manually close it.

## Data model

- **Round**
  - `id`, `restaurant` (text), `cutoffAt` (datetime), `notes` (text,
    optional), `openedBy` (user id), `openedAt`, `status`
    (`open` | `closed`), `closedAt`, `closedReason` (`cutoff` | `manual`).
  - Exactly one `open` round may exist at a time.
- **Item**
  - `id`, `roundId` (→ Round), `addedBy` (user id), `description` (text),
    `quantity` (integer), `price` (decimal, per-unit), `createdAt`,
    `updatedAt`.
- **ConsolidatedOrder** (derived, not stored) — computed from a closed
  Round's Items: grouped-by-description totals, per-person breakdown
  (items + subtotal owed), and grand total.

## Roles & access

- **Teammate** (every signed-in user; single flat team, no other roles):
  - may open a round (becomes that round's **opener**) when none is open.
  - may browse the open round and any closed round's history.
  - may add items to the open round before its cutoff.
  - may edit/remove only the items they personally added, before cutoff.
  - may view the consolidated order once a round is closed.
- **Opener** (a teammate, for the round they opened):
  - may manually close their own round before cutoff.
  - has no other privilege over other teammates' items.

## Interactions

- `lunch-webapp -> lunch-api` — all round/item/consolidation/history reads
  and writes, over the authenticated REST API.
- `lunch-webapp -> team-auth` — Google Workspace SSO sign-in via the
  platform's Thunder identity service.
- `lunch-api -> team-auth` — validates the caller's identity/session on
  protected endpoints.
- `lunch-api -> lunch-db` — persists rounds and items.
- `lunch-api -> slack` — posts the round-open and round-cutoff notification
  messages to the team's Slack channel.

## Data flow

1. **Open a round**: a signed-in teammate submits restaurant + cutoff (+
   optional notes) from lunch-webapp → `lunch-api` creates the round (only if
   none is currently open), persists it in `lunch-db`, and posts a Slack
   "round opened" message.
2. **Add/edit/remove items**: teammates browsing the open round submit items
   with description/quantity/price; `lunch-api` checks the round is still
   open (before `cutoffAt`) before writing, and checks item ownership before
   allowing edit/remove.
3. **Close (automatic or manual)**: once `cutoffAt` passes (checked on
   access) — or the opener manually closes early — `lunch-api` marks the
   round `closed`, rejects further item writes, and posts a Slack "round
   closed / place your order" message.
4. **Consolidated view**: any teammate opens the closed round from
   lunch-webapp; `lunch-api` computes the grouped-by-item totals, the
   per-person breakdown and owed amounts, and the grand total, and returns
   them for display.
5. **History**: lunch-webapp lists past closed rounds via `lunch-api`; each
   entry opens into its stored items and the same consolidated-order
   computation.
