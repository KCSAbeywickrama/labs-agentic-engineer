---
name: organization
description: The organization's standing defaults. Consult before asking the user any policy question (sign-in, email, payments, data, stack, external services, security) — a filled section answers the question silently; at design time a filled entry is the signal that pins a provider.
metadata:
  aep:
    kind: org
---

# Organization defaults

Standing decisions this organization has already made. **How to apply them:**

- **In interviews** (start, amend): a policy question a filled section answers
  is never asked. Record the default as a plain Product Decision in the PRD —
  no special tag; the user can override it in chat like any decision, and the
  override wins.
- **At design time**: a filled entry is the real signal that pins a provider or
  technology outright — no candidates list for a capability the org has
  standardized.
- A section reading "No org default — ask the user." carries no decision:
  interview normally.

Org admins maintain this file in the org's `_skills` repository; edits here
are the org's own and survive platform syncs.

## 1. Authentication & identity

No org default — ask the user.

<!-- Example: All user-facing apps sign in via Thunder SSO (the thunder-app
dependency). Exception: intentionally public, unauthenticated tools. -->

## 2. Email & notifications

No org default — ask the user.

<!-- Example: Transactional email via the org SendGrid account (registered
resource `sendgrid`). In-app notifications preferred over email digests. -->

## 3. Payments

No org default — ask the user.

## 4. Data & storage

No org default — ask the user.

<!-- Example: Relational data on Postgres (platform resource); object storage
on the org bucket; nothing retained beyond 90 days without a stated reason. -->

## 5. Tech stack

No org default — ask the user.

<!-- Example: Services in Go; web apps in React + TypeScript. Applies at
design altitude — the PRD never names languages. -->

## 6. External services policy

No org default — ask the user.

<!-- Example: Prefer registered resources over new vendors; a new SaaS vendor
needs procurement sign-off — surface it as an Open Question, don't pick one. -->

## 7. Security & compliance

No org default — ask the user.

<!-- Example: Internet exposure only for end-user web apps; services stay
intranet. No customer PII in logs. -->

## Organization practices

<!-- Free-form: naming conventions, domain vocabulary, review culture,
preferred patterns — anything the sections above don't slot. -->
