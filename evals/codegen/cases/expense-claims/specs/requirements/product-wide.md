# Product-wide

Rules that apply to more than one feature.

## Requirements

- P1 Every user signs in via SSO through Thunder, the platform identity provider. [org default] Applies to: all.
- P2 The product sends no email or other notifications; actors check the application to see status changes. Applies to: all.
- P3 Claims carry no file attachments (receipt images or PDFs); object storage is out of scope. Applies to: F1, F2, F3.
- P4 All claims are submitted and exported in a single, organization-wide currency. Applies to: F1, F3. *assumed*

## Decisions

- A user is either an Employee, a Manager, or Finance. *assumed*
