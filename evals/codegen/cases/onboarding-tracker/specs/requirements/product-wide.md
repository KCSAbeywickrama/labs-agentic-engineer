# Product-wide

Rules that apply to more than one feature.

## Requirements

- P1 All users sign in via SSO through Thunder, the platform IDP. Applies to: all.
- P2 No email or push notifications of any kind. Overdue tasks are surfaced only through in-app visual indicators (e.g., on the dashboard and task lists) — a hard requirement from the brief, not a fallback. Applies to: all.
- P3 The product does not support uploading or storing files or documents against a task or onboarding record. Tasks are tracked as structured data only (name, department, status, due date, notes as text). Applies to: all.

## Decisions

- Access is split by department — HR Coordinator, IT Staff, Facilities Staff, and Admin — each seeing and acting only on the tasks relevant to their role, with HR Coordinator having the broadest view across all departments. *assumed*
