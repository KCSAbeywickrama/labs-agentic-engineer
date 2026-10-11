# Raise and track tickets

## Purpose
Employees raise support tickets and follow their progress.

## User Stories
- F1.1 As an employee, I raise a ticket with a title, a description and a priority. *assumed*
- F1.2 As an employee, I see the SLA due time the API computed for my new ticket.
- F1.3 As an employee, I see a list of my own tickets with their status and SLA due time.
- F1.4 As an employee, I open one of my tickets to see its details, status and current assignee.
- F1.5 As an employee, I edit the title, description and priority of my ticket until it is triaged. *assumed*

## Decisions
- A new ticket starts with status open and no assignee.
- The SLA due time is computed by the API from the priority at creation and recomputed when the priority changes. *assumed*
- An employee sees only their own tickets; agents and team leads see all of them.
- Each ticket has a category chosen from a fixed list. *assumed*

## Out of Scope
- File attachments on tickets.
- Notifying the employee when the ticket changes.
- Closing or cancelling a ticket from the employee side.
