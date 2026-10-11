# Talk proposals

## Purpose
Speakers submit talk proposals to an event and follow their status.

Needs: F1.

## User Stories
- F2.1 As a speaker, I submit a talk proposal to an event with a title, an abstract, a format and a duration. *assumed*
- F2.2 As a speaker, I see a list of my proposals with the status of each: submitted, under review, accepted or rejected. *assumed*
- F2.3 As a speaker, I edit or withdraw my proposal while it is still submitted and unreviewed. *assumed*
- F2.4 As a speaker, I see the decision on my proposal and the organizer's comment, if any. Needs: F3. *assumed*
- F2.5 As an organizer, I open and close an event's call for proposals. *assumed*
- F2.6 As an organizer, I see all proposals of an event, filterable by status. *assumed*

## Decisions
- A proposal belongs to one event and one speaker (its submitter). *assumed*
- Proposals are text only; no slides or other attachments. [prd Out of Scope: file uploads]
- Proposals can be submitted only while the event's call for proposals is open. *assumed*
- A speaker can submit several proposals to the same event. *assumed*
- A speaker sees only their own proposals; organizers and reviewers see all proposals of the event. *assumed*
- Submission does not close automatically at a date; organizers close it by hand, since there are no scheduled jobs. *assumed*

## Out of Scope
- Co-speakers on one proposal.
- Speaker biographies and photos.
