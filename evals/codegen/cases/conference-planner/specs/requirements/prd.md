# Conference Planner

## Problem Statement
Conference organizers juggle events, rooms, sessions, talk submissions, reviews and attendee sign-ups across spreadsheets and inboxes. Capacity limits get overrun and freed seats are not handed to the next person waiting.

## Solution
A web app where organizers create events with sessions and rooms, speakers submit talk proposals, reviewers score them and organizers accept or reject them, and attendees register for events and sessions with capacity limits and a waitlist that automatically promotes the next person when a seat frees up.

## Actors
- Organizer: creates and manages events, sessions and rooms; decides on proposals.
- Speaker: submits and follows their own talk proposals.
- Reviewer: scores submitted proposals.
- Attendee: browses events and sessions, registers, joins waitlists and cancels.

## Features
- F1 [Events, sessions and rooms](features/F1-events-sessions-rooms.md)
- F2 [Talk proposals](features/F2-talk-proposals.md)
- F3 [Proposal review](features/F3-proposal-review.md)
- F4 [Registration and waitlist](features/F4-registration-waitlist.md)

## Product-wide
See [Product-wide](product-wide.md).

## Out of Scope
- Email or any other notifications.
- File uploads and object storage.
- Scheduled or background jobs.
- External integrations.
- AI features.

## Open Questions
1. Can one person hold several roles (e.g. speaker and attendee)? Assumed yes, see product-wide. *assumed*
