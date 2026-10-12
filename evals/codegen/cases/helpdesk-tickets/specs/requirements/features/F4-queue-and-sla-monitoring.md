# Queue and SLA monitoring

## Purpose
Support agents and team leads view the queue, filtered by status, priority, assignee and SLA breach.

Needs: F1.

## User Stories
- F4.1 As a support agent, I see the queue of all tickets in one list, with status, priority, assignee and SLA due time. *assumed*
- F4.2 As a team lead, I see the same queue of all tickets. *assumed*
- F4.3 As a support agent, I filter the queue by status. *assumed*
- F4.4 As a support agent, I filter the queue by priority. *assumed*
- F4.5 As a support agent, I filter the queue by assignee, including unassigned tickets. *assumed*
- F4.6 As a team lead, I filter the queue to show only tickets that breached their SLA. *assumed*
- F4.7 As a team lead, I combine filters, for example breached tickets of one assignee. *assumed*
- F4.8 As a support agent, I see which tickets in the queue have breached their SLA. *assumed*

## Decisions
- A ticket has breached its SLA when its due time has passed and it is not resolved; the API evaluates this when the queue is read (see product-wide decisions). *assumed*
- A ticket assigned to a username not yet seen is listed with that username as its assignee, is not under the unassigned filter, and appears under that person's assignee filter once the username has bound to their id (F2.3). *assumed*
- The queue is ordered by SLA due time, soonest first. *assumed*
- The queue is paginated. *assumed*
- Employees do not use this queue; they see only their own tickets (F1).
- The Team lead has the same queue view as a support agent, which satisfies watching the whole queue. *assumed*

## Out of Scope
- Reports, charts and exported SLA statistics.
- Alerts or notifications when an SLA is about to breach.
- Saved filters.
