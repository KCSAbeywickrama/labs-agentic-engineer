# Product-wide

Rules that apply to more than one feature.

## Requirements
- P1 An appointment slot is never booked by more than one active appointment. Applies to: F2, F3.
- P2 An appointment cannot be cancelled within 2 hours of its start time. Applies to: F2, F3.
- P3 Visit notes are readable and writable by doctors only. Applies to: F4.
- P4 Users sign in, and what they can see or do depends on their role (patient, doctor, receptionist). Applies to: all. [org default]
- P5 Times are shown in the clinic's single time zone. Applies to: all. *assumed*

## Decisions
- One clinic only; no multi-location support. *assumed*
- Web sign-in is via SSO through the platform IDP. [org default]
- One web app and one API service.
