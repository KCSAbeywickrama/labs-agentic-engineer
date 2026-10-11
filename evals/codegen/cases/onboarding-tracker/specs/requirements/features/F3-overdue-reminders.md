# Overdue reminders

## Purpose
Overdue onboarding tasks are flagged in the app to their owners and coordinators, in-app only.

Needs: F2.

## User Stories
- F3.1 As a team member, I see my department's overdue tasks highlighted and counted on my landing page. *assumed*
- F3.2 As a team member, I see how many days each of my department's tasks is overdue. *assumed*
- F3.3 As an HR coordinator, I see all overdue tasks across departments in one list, most overdue first. *assumed*
- F3.4 As an HR coordinator, I see which new hires have overdue tasks flagged in the onboardings list. *assumed*
- F3.5 As a team member, I see tasks due within the next 2 days marked as due soon. *assumed*
- F3.6 As a team member, I dismiss a flag by marking the task done; the reminder disappears at once. *assumed*

## Decisions
- A task is overdue when it is open and its due date is before today. *assumed*
- Reminders are shown only inside the app when a user opens it; nothing is sent. [P2]
- Due-soon window is 2 days. *assumed*
- Reminders are not repeated or snoozed; they show as long as the task is overdue. *assumed*

## Out of Scope
- Email, chat or push notifications.
- Escalation to managers.
- Configurable reminder schedules.
