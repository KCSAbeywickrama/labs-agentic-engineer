# Availability

## Purpose
Doctors publish their availability as time slots that patients and receptionists can book.

## User Stories
- F1.1 As a doctor, I publish an availability slot with a date, start time and end time.
- F1.2 As a doctor, I publish several slots at once for a day or a week of repeating hours. *assumed*
- F1.3 As a doctor, I see my published slots and whether each is open or booked.
- F1.4 As a doctor, I remove an open slot I no longer offer.
- F1.5 As a patient, I browse open slots by doctor and date.
- F1.6 As a receptionist, I browse open slots by doctor and date.

## Decisions
- A slot is a fixed time window belonging to one doctor; it is either open or booked.
- A doctor's slots cannot overlap each other. *assumed*
- Slots can only be published in the future. *assumed*
- A booked slot cannot be removed by the doctor; the appointment must be cancelled first, under the cancellation rule (P2). *assumed*
- Slots have no fixed length; the doctor chooses start and end. *assumed*

## Out of Scope
- Doctor time off or leave management beyond removing open slots.
- Slot publishing by anyone other than the doctor.
