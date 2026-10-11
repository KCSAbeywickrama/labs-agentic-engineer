# Product-wide

Rules that apply to more than one feature.

## Requirements
- P1 A slot can be booked by at most one appointment; double booking is prevented. Applies to: F2, F3.
- P2 An appointment cannot be cancelled (or rescheduled away from) within 2 hours of its start time; this applies to patients and receptionists alike. Applies to: F2, F3.
- P3 Patients see only their own appointments; doctors see only their own schedule. Applies to: F2, F4. *assumed*

## Decisions
- Delivered as one web app and one API service.
