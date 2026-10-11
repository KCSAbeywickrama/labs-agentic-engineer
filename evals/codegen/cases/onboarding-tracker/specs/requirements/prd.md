# Onboarding Tracker

## Problem Statement

When a company hires someone new, the work to get them ready to start touches
three separate teams — IT (equipment, accounts, access), HR (paperwork,
benefits, orientation) and Facilities (desk, badge, parking) — and today
nobody has one place to see whether all of it is actually done. Tasks slip
between teams, nobody notices an overdue item until the new hire's first day
arrives without a laptop or a badge, and there is no single view of where any
one new hire's onboarding actually stands.

## Solution

A shared onboarding tracker where HR creates an onboarding record for each new
hire, tasks are assigned across IT, HR and Facilities, each team updates the
status of its own tasks, and overdue items are flagged directly in the app so
staff can see at a glance what needs attention — with no email or push
notifications involved.

## Actors

- **HR Coordinator** — creates a new hire's onboarding record, assigns tasks
  across all three departments, monitors overall progress, and marks
  onboarding complete.
- **IT Staff** — views and updates the status of IT tasks assigned across all
  new hires.
- **Facilities Staff** — views and updates the status of Facilities tasks
  assigned across all new hires.
- **Admin** — manages the catalog of standard onboarding task templates used
  when a new onboarding record is created. *assumed*

## Features

- F1 [Onboarding records](features/F1-onboarding-records.md)
- F2 [Department tasks](features/F2-department-tasks.md)
- F3 [Progress and overdue tasks](features/F3-progress.md)
- F4 [Task templates](features/F4-task-templates.md)

## Product-wide

Sign-in, notifications, file storage and roles are on the
[Product-wide](product-wide.md) page.

## Out of Scope

- Email, SMS or push notifications of any kind.
- File or document upload/storage (offer letters, ID scans, signed forms,
  etc.).
- Self-service access for the new hire themselves (this is an internal staff
  tool for IT/HR/Facilities, not a new-hire-facing portal).
- Payroll, benefits enrollment, or background-check system integrations.
- Offboarding / termination checklists.

## Further Notes

This PRD was generated without an interactive interview (headless run); all
judgment calls are marked `*assumed*` across the requirements and are open to being overturned
in a later round.
