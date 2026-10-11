# Clinic Appointments

## Problem Statement
Clinics juggle doctor availability, patient bookings and front-desk check-in by phone and paper. Double bookings, last-minute cancellations and scattered visit notes cost doctors' time and frustrate patients.

## Solution
A web app backed by one API service where doctors publish availability as time slots, patients book, reschedule and cancel appointments, receptionists book on behalf of patients and check them in, and doctors see their day and write visit notes that only doctors can read.

## Actors
- Patient: browses available slots and books, reschedules and cancels their own appointments.
- Doctor: publishes availability slots, sees their own daily schedule, and writes and reads visit notes.
- Receptionist: books, reschedules and cancels appointments for any patient and checks patients in on arrival; cannot read visit notes.

## Features
- F1 [Availability](features/F1-availability.md)
- F2 [Appointments](features/F2-appointments.md)
- F3 [Front desk](features/F3-front-desk.md)
- F4 [Visit notes](features/F4-visit-notes.md)
- F5 [Sign-in](features/F5-sign-in.md)

## Product-wide
Booking rules, visibility and delivery are on the [Product-wide](product-wide.md) page.

## Out of Scope
- Email or any other notifications.
- File uploads or object storage.
- Scheduled or background jobs.
- External integrations.
- AI features.

## Open Questions
1. How are patient and doctor accounts created and assigned roles (self-sign-up vs. administrator-provided)?
