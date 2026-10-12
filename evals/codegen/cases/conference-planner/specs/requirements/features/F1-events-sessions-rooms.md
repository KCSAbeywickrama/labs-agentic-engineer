# Events, sessions and rooms

## Purpose
Organizers create events and fill them with sessions held in rooms; everyone can browse them.

## User Stories
- F1.1 As an organizer, I create an event with a name, dates and a venue. *assumed*
- F1.2 As an organizer, I edit or delete an event I created. *assumed*
- F1.3 As an organizer, I define the rooms of an event, each with a name and a seating capacity. *assumed*
- F1.4 As an organizer, I add a session to an event with a title, a room, a start and end time, and a capacity. *assumed*
- F1.5 As an organizer, I edit, move or remove a session. *assumed*
- F1.6 As an organizer, I am prevented from scheduling two sessions in the same room at overlapping times. *assumed*
- F1.7 As an organizer, I assign an accepted talk's speaker to a session. Needs: F3. *assumed*
- F1.8 As an attendee, I browse events and see each event's sessions by day, with room and time. *assumed*
- F1.9 As a speaker, I browse events open for proposals. *assumed*

## Decisions
- A session's capacity defaults to its room's capacity and cannot exceed it. *assumed*
- An event has its own overall capacity, set by the organizer, used by event registration in F4. *assumed*
- Events, sessions and rooms are readable by every signed-in user; only organizers change them. *assumed*
- Deleting an event or session that has registrations is not allowed until they are cancelled. *assumed*
- All times are shown in the event's own time zone. *assumed*

## Out of Scope
- Multi-track or multi-venue floor plans.
- Room equipment or booking by third parties.
