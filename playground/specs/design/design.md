# Design — Todo App

## Overview

The Todo App is a small personal task-management system. A user signs in,
then creates, organizes, edits, completes, and deletes their own todos and
lists. The system decomposes into a single-page React web application and
one Go API service that owns all todo/list data. Sign-in is delegated to the
platform's Thunder identity provider — there is no custom auth component.

## Components

- **todo-webapp** (`web-application`) — the React SPA a user signs into and
  uses to view, create, edit, organize, complete, and delete todos and lists.
- **todo-api** (`service`) — the Go REST API owning todos and lists, scoped
  per authenticated user, backed by an embedded SQLite database.

## Capabilities

### todo-webapp

- **Sign-in** — redirects an unauthenticated visitor into the OIDC flow
  before showing any todo content; persists the session across visits.
- **Todo list view** — displays the signed-in user's todos grouped by list,
  with a status filter (all / active / completed) and an empty-state message.
- **Todo creation** — a form to create a todo with title (required),
  description (optional), due date (optional), and target list.
- **Todo editing** — edit an existing todo's title, description, due date,
  or list; cancel discards unsaved changes.
- **Todo completion toggle** — mark a todo complete or reopen it; visually
  distinguishes completed and overdue todos.
- **List management** — create new lists; move a todo between lists; delete
  a list (with a confirmation and choice for how to handle its todos).
- **Deletion confirmation** — confirms before deleting a todo.

### todo-api

- **Todo CRUD** — create, list (with status filter), get, update, and delete
  todos, all scoped to the authenticated caller.
- **List CRUD** — create, list, update (rename), and delete lists scoped to
  the authenticated caller; deleting a list reassigns or requires explicit
  handling of its todos rather than silently deleting them.
- **Completion toggling** — a dedicated action to mark a todo
  complete/incomplete.
- **Per-user data isolation** — every read/write is scoped to the caller's
  own rows; a caller can never see or modify another user's data.

## Data model

- **Todo** — `id`, `userId`, `listId` (nullable — default list when unset),
  `title` (required), `description` (optional), `dueDate` (optional date),
  `done` (boolean, default false), `createdAt`, `updatedAt`.
- **List** — `id`, `userId`, `name` (required), `createdAt`. A user's
  default list is implicit (todos with `listId = null` are "unlisted").

Relationships: a `User` (identified only by the IdP subject, no local user
record) owns many `List`s and many `Todo`s; a `Todo` optionally belongs to
one `List`.

## Roles & access

- **Signed-in user** — the only role. Every user may create, view, edit,
  complete/reopen, and delete only their own todos and lists. There is no
  admin or shared-visibility role in this system.

## Interactions

- `todo-webapp -> todo-api` — the SPA calls the API for all todo/list
  operations, attaching the caller's bearer token.
- `todo-webapp -> user-auth` (Thunder) — the SPA performs the OIDC
  Authorization Code + PKCE sign-in flow.
- `todo-api -> user-auth` (Thunder) — the API's gateway validates the
  caller's JWT and injects identity headers; the API trusts these headers
  rather than validating tokens itself.

## Data flow

1. **Sign-in**: an unauthenticated visitor opens todo-webapp → redirected to
   Thunder for OIDC sign-in → returns with a token → webapp calls todo-api
   with `Authorization: Bearer <token>`.
2. **Create todo**: user submits the creation form → webapp POSTs to
   `todo-api` → gateway injects `X-User-Id` → API validates the title,
   inserts a row scoped to that user, returns the created todo → webapp adds
   it to the displayed list.
3. **View & filter**: webapp requests the user's todos (optionally filtered
   by status) → API returns only rows matching `X-User-Id` → webapp renders
   them grouped by list, or an empty-state message if none exist.
4. **Edit / complete / delete**: user acts on a todo → webapp calls the
   corresponding API endpoint (`PATCH`/`DELETE`) with the todo id → API
   verifies the row belongs to the caller before applying the change →
   webapp reflects the updated state (or removes the row on delete).
5. **List management**: user creates or deletes a list → webapp calls the
   list endpoints → on delete of a non-empty list, the API requires the
   caller to specify how to handle its todos (move to default list) rather
   than deleting them.
