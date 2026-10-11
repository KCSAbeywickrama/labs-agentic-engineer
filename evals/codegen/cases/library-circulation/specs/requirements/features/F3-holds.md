# Holds

## Purpose
Members place holds on titles; librarians work the holds queue.

Needs: F1.

## User Stories
- F3.1 As a member, I place a hold on a title whose copies are all unavailable. *assumed*
- F3.2 As a member, I see my holds with my position in the queue. *assumed*
- F3.3 As a member, I cancel my hold. *assumed*
- F3.4 As a librarian, I see the holds queue for a title, oldest first. *assumed*
- F3.5 As a librarian, when a copy of a held title is checked in, I assign it to the first hold in the queue, which marks the hold ready for pickup. *assumed*
- F3.6 As a librarian, I cancel a hold on a member's behalf. *assumed*
- F3.7 As a librarian, I check out a copy held for a member to that member, which fulfils the hold. *assumed*

## Decisions
- Holds are per title, not per copy, and are served first come, first served. *assumed*
- A member has at most one active hold per title and cannot hold a title they already have on loan. *assumed*
- A member may have at most 5 active holds. *assumed*
- A ready hold is kept for 7 days; a librarian cancels it when it lapses, since there are no background jobs. *assumed*
- A copy assigned to a hold has the status on hold shelf and cannot be checked out to anyone else. *assumed*
- Members are not notified when a hold is ready; they see it in their holds list. [brief]

## Out of Scope
- Automatic expiry of holds.
- Hold-ready notifications.
