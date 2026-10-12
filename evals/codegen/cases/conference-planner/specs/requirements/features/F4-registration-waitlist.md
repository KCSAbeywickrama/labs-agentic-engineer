# Registration and waitlist

## Purpose
Attendees register for events and sessions within capacity limits; a waitlist promotes the next person when a seat frees up.

Needs: F1.

## User Stories
- F4.1 As an attendee, I register for an event and receive a confirmed seat when one is available. *assumed*
- F4.2 As an attendee, I register for individual sessions of an event I am registered for. *assumed*
- F4.3 As an attendee, I am placed on the waitlist, at the end of the queue, when the event or session is full. *assumed*
- F4.4 As an attendee, I see my registrations with their status (confirmed or waitlisted) and my waitlist position. *assumed*
- F4.5 As an attendee, I cancel a registration or leave a waitlist. *assumed*
- F4.6 As an attendee, I am promoted automatically from the waitlist to confirmed when a seat frees up and I am next in line. *assumed*
- F4.7 As an organizer, I see an event's or session's registrations and waitlist, with seats taken against capacity. *assumed*
- F4.8 As an organizer, I remove an attendee's registration, which frees the seat. *assumed*
- F4.9 As an organizer, I raise a capacity, which promotes waitlisted attendees into the new seats. *assumed*

## Decisions
- Registrations are kept and counted by a dedicated registration service; only the events API calls it, and the web app calls only the events API. [P3]
- Waitlists are first come, first served, one per event and one per session. *assumed*
- Promotion happens immediately in the same request that frees the seat (cancel, removal or capacity increase), with no background job. [P4]
- Attendees are not told of their promotion; they see it the next time they look, since there are no notifications. *assumed*
- Cancelling an event registration also cancels that attendee's session registrations and waitlist entries for the event. *assumed*
- An attendee holds at most one registration or waitlist entry per event or session. *assumed*
- Two sessions whose times overlap can be both registered by one attendee. *assumed*
- Lowering a capacity below the confirmed count is not allowed. *assumed*
- Attendees can cancel at any time before the event or session begins. *assumed*

## Out of Scope
- Payments and paid tickets.
- Ticket types and discount codes.
- Check-in at the venue.
- Waitlist confirmation windows or time-limited offers.
