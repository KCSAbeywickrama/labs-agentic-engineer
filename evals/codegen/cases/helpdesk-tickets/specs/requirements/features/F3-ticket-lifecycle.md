# Ticket lifecycle

## Purpose
A ticket moves from open through triage and work to resolved, and its requester can reopen it.

Needs: F1.

## User Stories
- F3.1 As an Employee, I want to reopen a resolved ticket, so that an unsolved problem is worked again.
- F3.2 As a Support Agent, I want to triage a ticket and set its priority, so that it gets the right SLA.
- F3.3 As a Support Agent, I want to move a ticket to in progress and then resolved, so that its status reflects the work.

## Decisions
- Ticket lifecycle: open, triaged, in progress, resolved, reopened. Resolved tickets can be reopened; otherwise transitions move forward. *assumed*
