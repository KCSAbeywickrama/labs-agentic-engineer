# IT Help Desk

## Problem Statement
Employees who need IT help have no single place to raise and track requests, so issues get lost in chat and hallway asks. Support agents cannot see what is waiting or how urgent it is, and team leads cannot tell whether response targets are being missed.

## Solution
An internal help desk web app backed by one API service. Employees raise tickets and follow them through a comment thread; support agents triage, assign and resolve them; a team lead watches the queue, filtered by status, priority, assignee and SLA breach. Priority determines an SLA due time computed by the API.

## Actors
- Employee: raises tickets, sees their own tickets, comments on them, and reopens their own resolved tickets.
- Support Agent: sees the whole queue, triages, assigns, works, comments on and resolves tickets.
- Team Lead: sees the whole queue and SLA breaches, and can assign and reassign tickets.

## Features
- F1 [Raising tickets](features/F1-raising-tickets.md)
- F2 [Comments](features/F2-comments.md)
- F3 [Ticket lifecycle](features/F3-ticket-lifecycle.md)
- F4 [Ticket queue](features/F4-ticket-queue.md)
- F5 [Assignment](features/F5-assignment.md)

## Product-wide
SLA, visibility, sign-in and delivery are on the [Product-wide](product-wide.md) page.

## Out of Scope
- Email or any other notifications.
- File uploads and object storage.
- Scheduled or background jobs.
- External integrations.
- AI features.
