# IT Help Desk

## Problem Statement
Employees need IT support, and support agents and team leads have no single place to see who asked for what, who owns it, and whether it is late. Requests get lost and nobody sees SLA breaches coming.

## Solution
An internal help desk: employees raise tickets and follow them, support agents triage, assign and resolve them, and a team lead watches the queue filtered by status, priority, assignee and SLA breach. One web app and one API service.

## Actors
- Employee: raises tickets, follows their own tickets, comments on them, and reopens a resolved ticket.
- Support agent: sees the queue, triages, assigns, works and resolves tickets, and comments.
- Team lead: watches the whole queue and SLA breaches; can assign tickets.

## Features
- F1 [Raise and track tickets](features/F1-raise-and-track-tickets.md)
- F2 [Ticket handling](features/F2-ticket-handling.md)
- F3 [Ticket comments](features/F3-ticket-comments.md)
- F4 [Queue and SLA monitoring](features/F4-queue-and-sla-monitoring.md)

## Product-wide
See [Product-wide](product-wide.md).

## Out of Scope
- Email or any other notifications.
- File uploads and object storage.
- Scheduled or background jobs.
- External integrations.
- AI features.
