# Requirements: Team Lunch Ordering

## 1. Summary

A web app for coordinating team lunch orders. Any team member can open a daily
lunch order for a restaurant of their choice. Teammates add items from a
structured menu (with prices) that the opener sets up. At a cutoff time the
order locks, and the opener gets one consolidated order — with a per-person
cost breakdown — to place with the restaurant.

## 2. Actors

- **Team member** — any authenticated user of the team. Can open a daily
  order, add items to any open order, and view consolidated orders.
- **Opener** — the team member who opened a given day's order. Additionally
  sets up the restaurant's menu (items + prices) for that order and is
  responsible for placing the real-world order once it locks.

There are no separate admin/organizer roles: any team member can act as an
opener for a given day's order.

## 3. Authentication

- Team members sign in with the team's existing Google Workspace accounts
  (Google sign-in / SSO). There is no separate registration or local
  password — identity is established via the existing Google Workspace
  identity provider.
- All actions (opening an order, adding items) are attributed to the signed-in
  user.

## 4. Functional Requirements

### 4.1 Opening a daily order

- Any signed-in team member may open a new daily lunch order.
- When opening an order, the opener:
  - Names/identifies the restaurant as free text (no preset restaurant list
    in v1).
  - Sets a cutoff time for the order (same day).
  - Defines the structured menu for that restaurant: a list of menu items,
    each with a name and a price. The opener can add to this menu list while
    the order is open (e.g. if someone requests something not yet listed).
- Only one or more orders may exist per day; the requirements do not need to
  restrict a team to a single simultaneous open order (e.g. two sub-teams
  ordering from different restaurants on the same day is allowed).

### 4.2 Adding items

- While an order is open (before its cutoff), any signed-in team member
  (including the opener) may add one or more items to it by selecting from
  the order's structured menu.
- Each added item is attributed to the team member who added it, and
  captures: which menu item, quantity, and any free-text note (e.g. "no
  onions").
- A team member may add multiple items, and may edit or remove their own
  items, up until the cutoff.

### 4.3 Cutoff and locking

- Each order has a cutoff time set by its opener at creation.
- Once the cutoff time passes, the order automatically locks: no further
  items may be added, edited, or removed by anyone (including the opener's
  own menu edits).
- After locking, the order is read-only.

### 4.4 Consolidated order and cost breakdown

- Once locked (or at any time, as a live preview, before locking), the system
  presents the opener with:
  - A consolidated list of all items across all team members, grouped by
    menu item, with total quantities — suitable for placing the real order
    with the restaurant.
  - A per-person breakdown: each team member's items and their individual
    cost total, computed from menu item prices × quantity.
  - The overall order total.
- The app does not process payment or money movement. Cost tracking is
  informational only — it tells the opener who owes what so settlement can
  happen outside the app (cash, peer payment app, etc.).

### 4.5 Visibility

- All team members can view any day's order(s): the restaurant, menu, cutoff
  time, current items (who added what), and running totals — both before and
  after cutoff.

## 5. Non-Functional Requirements

- Web application, accessible from desktop and mobile browsers.
- Authentication via the team's existing Google Workspace identity (no new
  credential store for user login).
- Cutoff enforcement must be reliable — once time passes, the system must
  reject further add/edit/remove attempts even if a client had the page open
  earlier.

## 6. Explicit Non-Goals (v1)

- No preset/managed restaurant list — restaurant is freeform text per order.
- No online payment processing or money transfer; the app only computes who
  owes what.
- No integration with restaurant ordering systems — the opener places the
  real order manually (e.g. by phone or the restaurant's own site) using the
  consolidated list the app produces.
- No multi-team/organization management beyond a single team's shared view;
  all signed-in users see all orders (no per-team partitioning in v1).

## 7. Assumptions

- All users belong to the same Google Workspace domain/team; no
  cross-organization access control is required in v1.
- "Same day" cutoff is sufficient — orders do not span multiple days.
- Menu items are scoped to a single order (opener re-enters the menu each
  time), since there is no persistent restaurant catalog in v1.
