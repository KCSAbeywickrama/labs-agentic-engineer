# Appointment booking

## Purpose
Patients book, reschedule and cancel their own appointments in open slots.

Needs: F1.

## User Stories
- F2.1 As a patient, I book an appointment by choosing an open slot.
- F2.2 As a patient, I see my upcoming and past appointments.
- F2.3 As a patient, I reschedule an appointment to another open slot of the same doctor. *assumed*
- F2.4 As a patient, I cancel an appointment more than 2 hours before its start (P2).
- F2.5 As a patient, I am told clearly when a slot was just taken or a cancellation is too late.

## Decisions
- Booking a slot makes it booked at once; two patients cannot hold the same slot (P1).
- Rescheduling moves the appointment atomically: the old slot reopens only when the new one is secured. *assumed*
- Rescheduling is also not allowed within 2 hours of the current start (P2). *assumed*
- A cancelled appointment reopens its slot for others. *assumed*
- A patient may hold several appointments, but not two that overlap in time. *assumed*
- A patient sees only their own appointments.
- A patient cannot book a slot that has already started. *assumed*

## Out of Scope
- Waiting lists for taken slots.
- Booking recurring appointments.
- Paying for appointments.
