# Product-wide

Rules that apply to more than one feature.

## Requirements
- P1 All users sign in via SSO through the platform identity provider; roles are member and librarian. Applies to: all.
- P2 Members cannot borrow while they have unpaid fees. Applies to: F2, F4. *assumed*

## Decisions
- Architecture: the catalogue service is called only by the circulation API; the web app calls only the circulation API.
