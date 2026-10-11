# Registration

## Purpose
Attendees register for events and for sessions with limited seats, with a fair waitlist when a session is full; organizers watch the numbers.

Needs: F1.

## User Stories
- F3.1 As an attendee, I want to register for an event, so that I am counted as attending.
- F3.2 As an attendee, I want to register for a session with limited capacity, so that I secure a seat.
- F3.3 As an attendee, I want to join a waitlist when a session is full, so that I may get a seat later.
- F3.4 As an attendee, I want to be promoted automatically from the waitlist when a seat frees up, so that I do not have to keep checking.
- F3.5 As an attendee, I want to cancel my registration, so that my seat goes to someone else.
- F3.6 As an organizer, I want to see registrations, remaining capacity and waitlist per session, so that I can plan rooms.

## Decisions
- Registration (capacity, waitlist, promotion) lives in its own registration service, called only by the events API; the web app calls only the events API.
- Waitlist promotion is first-come-first-served and happens immediately when a seat is freed, including on cancellation. *assumed*
- Event registration is open-ended (no capacity); only sessions have capacity. *assumed*
- Attendees must be registered for an event before registering for its sessions. *assumed*
