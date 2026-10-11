# Conference Planner

## Problem Statement
Conference organizers juggle events, sessions, rooms, speaker proposals, reviews and attendee sign-ups across spreadsheets and inboxes. Proposals get lost, scoring is inconsistent, and session seats are over- or under-booked, with no fair waitlist when a session is full.

## Solution
A web application where organizers build events with sessions and rooms, speakers submit talk proposals, reviewers score them and organizers accept or reject them, and attendees register for events and sessions. Sessions have capacity limits; when full, attendees join a waitlist and the next person is promoted automatically when a seat frees up.

## Actors
- **Organizer** — creates and manages events, rooms and sessions; decides on proposals; sees all registrations.
- **Speaker** — submits and tracks their own talk proposals.
- **Reviewer** — sees proposals assigned or open for review and scores them.
- **Attendee** — browses events and sessions, registers, cancels, and sees their registration and waitlist status.

## Features
- F1 [Event program](features/F1-event-program.md)
- F2 [Talk proposals](features/F2-talk-proposals.md)
- F3 [Registration](features/F3-registration.md)

## Product-wide
Sign-in, notifications and roles are on the [Product-wide](product-wide.md) page.

## Out of Scope
- Email or any other notifications.
- File uploads and object storage (proposals are text only).
- Scheduled or background jobs.
- External integrations (payments, calendars, etc.).
- AI features.

## Open Questions
1. Are there expected maximum sizes (attendees per event, sessions per event) the product should be designed for?

## Further Notes
Interview was not possible in this run; all `*assumed*` items are open to challenge.
