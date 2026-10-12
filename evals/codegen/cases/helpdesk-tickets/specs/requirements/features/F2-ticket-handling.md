# Ticket handling

## Purpose
Support agents triage, assign, work and resolve tickets; employees can reopen resolved ones.

Needs: F1.

## User Stories
- F2.1 As a support agent, I triage an open ticket, confirming or changing its priority, which moves it to triaged. *assumed*
- F2.2 As a support agent, I assign a ticket to myself. *assumed*
- F2.3 As a team lead, I assign or reassign a ticket to a support agent, either by picking from the agents the help desk has seen or by typing their username.
- F2.4 As a support agent, I start work on a triaged ticket assigned to me, which moves it to in progress. *assumed*
- F2.5 As a support agent, I resolve an in-progress ticket, which moves it to resolved. *assumed*
- F2.6 As an employee, I reopen my resolved ticket, which moves it to reopened. *assumed*
- F2.7 As a support agent, I pick up a reopened ticket and move it back to in progress. *assumed*

## Decisions
- Statuses are those of P1; allowed moves are open to triaged, triaged to in progress, in progress to resolved, resolved to reopened, reopened to in progress. *assumed*
- Changing the priority during triage recomputes the SLA due time (P2). *assumed*
- Reopening does not reset the SLA due time. *assumed*
- Only the employee who raised a ticket can reopen it. *assumed*
- Only support agents and team leads can change a ticket's status or assignee.
- A username the help desk has not seen yet is accepted as typed; the ticket shows that username as its assignee until the person's first call, when it binds to their id and name.

## Out of Scope
- Automatic assignment or round-robin routing.
- Closing a ticket after a period of inactivity.

## Open Questions
1. Does reopening a ticket start a new SLA clock or keep the original due time?
   - Keep the original due time
   - Recompute from the reopen time
