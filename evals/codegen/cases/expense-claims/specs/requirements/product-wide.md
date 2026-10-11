# Product-wide

Rules that apply to more than one feature.

## Requirements
- P1 Users sign in through SSO via Thunder, and what each actor can do depends on their role. [org default] Applies to: all.
- P2 Every submission, approval, rejection and export is recorded in an audit log. Applies to: all. *assumed*
- P3 Amounts are in a single company currency, stored in cents. Applies to: F1, F3. *assumed*

## Decisions
- The product records each signed-in person as an employee on first use; employees and reporting lines are not synchronised from the sign-in directory.
- No notifications of any kind are sent.
- No object storage is used.
