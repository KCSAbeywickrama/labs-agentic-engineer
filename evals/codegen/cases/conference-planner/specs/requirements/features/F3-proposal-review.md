# Proposal review

## Purpose
Reviewers score proposals and organizers accept or reject them.

Needs: F2.

## User Stories
- F3.1 As a reviewer, I see the submitted proposals of an event that I have not yet scored. *assumed*
- F3.2 As a reviewer, I score a proposal from 1 to 5 and may add a comment. *assumed*
- F3.3 As a reviewer, I change my score or comment until the organizer decides. *assumed*
- F3.4 As an organizer, I assign a reviewer to an event by username, even before that reviewer has ever signed in.
- F3.5 As an organizer, I see each proposal with its scores, average score and number of reviews, sorted by average. *assumed*
- F3.6 As an organizer, I accept or reject a proposal, with an optional comment. *assumed*
- F3.7 As an organizer, I reverse a decision, which puts the proposal back to under review. *assumed*

## Decisions
- Each reviewer gives at most one score per proposal. *assumed*
- A reviewer cannot score their own proposal (when they are also its speaker). *assumed*
- Reviewers see only the proposals of events they are assigned to. *assumed*
- An assignment is stored against the username and binds to the reviewer's person id on their first call; the reviewer's queue and score checks match on username as well as id.
- Reviewers see proposals with the speaker's name; no blind review. *assumed*
- Only organizers decide; scores advise and decide nothing automatically. *assumed*
- A proposal moves to under review once it has its first score. *assumed*
- Individual scores are visible to organizers only; reviewers see just their own. *assumed*

## Out of Scope
- Weighted or multi-criteria scoring.
- Automatic acceptance by score threshold.
- Reviewer discussion threads.
