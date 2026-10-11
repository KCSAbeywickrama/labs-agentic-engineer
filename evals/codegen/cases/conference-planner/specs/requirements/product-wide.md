# Product-wide

Rules that apply to more than one feature.

## Requirements
- P1 Users sign in through SSO via the platform identity provider; what each actor may do depends on their role. [org default] Applies to: all.
- P2 One person may hold several roles (for example speaker and attendee). Applies to: all. *assumed*
- P3 Registration capacity and waitlist state are owned by a dedicated registration service that only the events API calls; the web app calls only the events API. Applies to: F1, F4.
- P4 A seat is never given to more people than the capacity allows, even under simultaneous requests. Applies to: F4. *assumed*

## Decisions
- Waitlist promotion happens synchronously when a seat frees up, not through background jobs.
