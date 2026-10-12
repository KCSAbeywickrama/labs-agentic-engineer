# Clinic Appointments

## Problem Statement
Clinics juggle doctors' availability, patient requests and front-desk bookings by phone and paper. Slots get double booked, late cancellations waste doctor time, and visit notes are not reliably kept private.

## Solution
A web app and an API service where doctors publish availability as time slots, patients book, reschedule or cancel appointments, receptionists book on behalf of patients and check them in, and doctors see their day and write visit notes only doctors can read.

## Actors
- Patient: browses open slots and manages their own appointments.
- Doctor: publishes availability, sees their own day, writes and reads visit notes.
- Receptionist: books, reschedules and cancels appointments for any patient and checks patients in; cannot read visit notes.

## Features
- F1 [Availability](features/F1-availability.md)
- F2 [Appointment booking](features/F2-appointment-booking.md)
- F3 [Reception and check-in](features/F3-reception-and-check-in.md)
- F4 [Doctor's day and visit notes](features/F4-doctors-day-and-visit-notes.md)

## Product-wide
See [Product-wide](product-wide.md).

## Out of Scope
- Email or any other notifications.
- File uploads or object storage.
- Scheduled or background jobs.
- External integrations.
- AI features.

## Open Questions
1. Is there a single clinic, or several locations? *assumed* single clinic (see product-wide).
