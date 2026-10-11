# New Hire Onboarding Tracker

## Problem Statement
When someone joins, their onboarding tasks are spread across IT (laptop, accounts), HR (paperwork, orientation) and facilities (desk, badge). Nobody sees the whole picture, so items slip and are noticed late.

## Solution
A web app where each new hire's onboarding is tracked as a checklist of tasks owned by IT, HR and facilities, with overdue items flagged prominently in the app so owners and coordinators can chase them.

## Actors
- HR coordinator: starts onboarding for a new hire, sees all tasks across departments and what is overdue.
- IT team member: sees and completes the IT tasks assigned to their team.
- HR team member: sees and completes the HR tasks assigned to their team.
- Facilities team member: sees and completes the facilities tasks assigned to their team.

## Features
- F1 [Onboarding plans](features/F1-onboarding-plans.md)
- F2 [Task tracking](features/F2-task-tracking.md)
- F3 [Overdue reminders](features/F3-overdue-reminders.md)

## Product-wide
See [Product-wide](product-wide.md).

## Out of Scope
- Email or any other notification channel.
- Object storage or file/document uploads.

## Open Questions
1. Should the new hire themselves be an actor who sees their own checklist? *assumed* no for now: they are not an actor.
