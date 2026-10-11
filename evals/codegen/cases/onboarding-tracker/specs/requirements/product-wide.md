# Product-wide

Rules that apply to more than one feature.

## Requirements
- P1 Users sign in through SSO; what a user sees and can change depends on their department. [org default] Applies to: all.
- P2 Reminders appear only inside the app; no email or other notifications are sent. Applies to: F3.
- P3 No files are stored; tasks hold text only. Applies to: all.

## Decisions
- Departments are IT, HR and Facilities. *assumed*
- A person's department is determined by their department role (IT, HR or Facilities team member), not by any other attribute; each department role carries its own permissions. *assumed*
