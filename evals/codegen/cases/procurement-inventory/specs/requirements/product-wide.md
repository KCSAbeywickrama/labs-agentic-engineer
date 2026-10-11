# Product-wide

Rules that apply to more than one feature.

## Requirements
- P1 Stock (items, levels, ledger) is held in its own inventory service that only the procurement API calls. Applies to: F1, F4, F5, F6.
- P2 The web app calls only the procurement API. Applies to: all.
- P3 Every stock change is recorded as a ledger entry; stock levels are never changed without one. Applies to: F4, F5, F6.
- P4 Users sign in through SSO and see only what their role allows. [org default] Applies to: all.
- P5 Pages load in under 2 seconds under normal use. Applies to: all. *assumed*

## Decisions
- No email or notifications, file uploads, scheduled or background jobs, external integrations or AI features.
