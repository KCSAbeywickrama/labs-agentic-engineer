# Product-wide

Rules that apply to more than one feature.

## Requirements
- P1 All users sign in via SSO through the platform identity provider. [org default] Applies to: all.
- P2 Each item has a reorder level; low stock means on-hand quantity below it. Applies to: F3, F4. *assumed*

## Decisions
- Stock (items, levels, ledger) is held in its own inventory service that only the procurement API calls; the web app calls only the procurement API.
