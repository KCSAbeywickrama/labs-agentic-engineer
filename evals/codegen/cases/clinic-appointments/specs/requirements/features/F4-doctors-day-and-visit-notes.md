# Doctor's day and visit notes

## Purpose
Doctors see their day's appointments and write visit notes that only doctors can read.

Needs: F2.

## User Stories
- F4.1 As a doctor, I see my day's appointments in time order, with the patient's name and whether they have checked in.
- F4.2 As a doctor, I move to another day to see its appointments. *assumed*
- F4.3 As a doctor, I write a visit note on an appointment of mine.
- F4.4 As a doctor, I read the visit notes I wrote on an appointment.
- F4.5 As a doctor, I edit a visit note I wrote. *assumed*
- F4.6 As a doctor, I see a patient's earlier visit notes when viewing their appointment. *assumed*

## Decisions
- Visit notes can be read and written by doctors only; patients and receptionists never see them, not even that a note exists (P3).
- A doctor sees only their own appointments. *assumed*
- A visit note belongs to one appointment and records its author and time of writing. *assumed*
- Notes can be written for an appointment that has been checked in or whose start time has passed. *assumed*
- Earlier notes are visible to any doctor of the clinic, not only the author. *assumed*
- Visit notes are plain text. *assumed*
- Visit notes cannot be deleted. *assumed*

## Out of Scope
- Attachments to visit notes (no file uploads).
- Prescriptions, diagnoses codes or billing.
- Patients reading their own notes.
