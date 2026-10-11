# Product-wide

Rules that apply to more than one feature.

## Requirements
- P1 Titles and copies are held in a separate catalogue service that only the circulation API calls. Applies to: F1, F2, F3. [brief]
- P2 The web app calls only the circulation API. Applies to: all. [brief]
- P3 Members see only their own loans, holds and fees; librarian actions require the librarian role. Applies to: all. *assumed*
- P4 Users sign in via SSO. Applies to: all. [org default]
- P5 Fees are in a single currency, stored in minor units. Applies to: F4. *assumed*

## Decisions
- No notifications, uploads, background jobs, external integrations or AI features.
