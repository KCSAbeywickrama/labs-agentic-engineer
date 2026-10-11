# Task tracking

## Purpose
Department team members see their assigned onboarding tasks and mark them done; coordinators see progress per new hire.

Needs: F1.

## User Stories
- F2.1 As an IT team member, I see the open IT tasks across all new hires, soonest due first. *assumed*
- F2.2 As an HR team member, I see the open HR tasks across all new hires, soonest due first. *assumed*
- F2.3 As a facilities team member, I see the open facilities tasks across all new hires, soonest due first. *assumed*
- F2.4 As a team member, I mark a task of my department done, and the completion date is recorded. *assumed*
- F2.5 As a team member, I reopen a task I marked done by mistake. *assumed*
- F2.6 As a team member, I add a text note to a task of my department. *assumed*
- F2.7 As an HR coordinator, I see one new hire's tasks grouped by department with done and open counts. *assumed*
- F2.8 As an HR coordinator, I filter all tasks by department, status and new hire. *assumed*

## Decisions
- A team member can change only tasks of their own department; an HR coordinator can view all and mark any task done. *assumed*
- A team member's department is the one their role belongs to (IT, HR or Facilities team member). *assumed*
- A task is either open or done; there are no intermediate states. *assumed*
- An onboarding is complete when all its tasks are done. *assumed*
- Notes are text only. [org default]

## Out of Scope
- Task dependencies or ordering between tasks.
- Assigning a task to a named individual.
- Attachments.
