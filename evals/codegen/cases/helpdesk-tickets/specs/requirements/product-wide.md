# Product-wide

Rules that apply to more than one feature.

## Requirements
- P1 Ticket status is one of open, triaged, in progress, resolved, reopened. Applies to: F1, F2, F4. *assumed*
- P2 A ticket's SLA due time is computed by the API from its priority. Applies to: F1, F2, F4. *assumed*
- P3 Users sign in through SSO and see only what their role allows. [org default] Applies to: all.

## Decisions
- Priority levels are low, medium, high and critical. *assumed*
- SLA breach is evaluated when read, not by a background job.
- People are identified by their sign-in id. A ticket may name its assignee by username before that person has used the help desk; the name binds to their id on their first call.
