# Reception and check-in

## Purpose
Receptionists book, reschedule and cancel appointments for patients and check patients in on arrival.

Needs: F1, F2.

## User Stories
- F3.1 As a receptionist, I find a patient by name or phone number. *assumed*
- F3.2 As a receptionist, I book an appointment for a patient in an open slot.
- F3.3 As a receptionist, I reschedule a patient's appointment to another open slot of the same doctor. *assumed*
- F3.4 As a receptionist, I cancel a patient's appointment more than 2 hours before its start (P2).
- F3.5 As a receptionist, I see the day's appointments for a doctor or for the whole clinic. *assumed*
- F3.6 As a receptionist, I check a patient in when they arrive.
- F3.7 As a receptionist, I register a new patient when booking for someone without an account. *assumed*

## Decisions
- Receptionists follow the same booking rules as patients: no double booking (P1) and no cancellation within 2 hours (P2), with no override. *assumed*
- Check-in is possible only on the day of the appointment, for a booked appointment. *assumed*
- A checked-in appointment shows as arrived to the doctor in their day view (F4). *assumed*
- Check-in can be undone by a receptionist if made by mistake. *assumed*
- Receptionists see appointment details but never visit notes (P3).

## Out of Scope
- Payments or billing at the front desk.
- Marking an appointment as a no-show automatically.
