# Product-wide

Rules that apply to more than one feature.

## Requirements
- P1 SLA due time is computed by the API from priority at creation and recomputed when priority changes. Applies to: F1, F3, F4. *assumed*
- P2 Priorities are low, medium, high and critical; example SLA targets are 3 days, 1 day, 8 hours and 2 hours (calendar time). Applies to: F1, F3, F4. *assumed*
- P3 All users sign in via SSO through the platform IDP; roles distinguish Employee, Support Agent and Team Lead. Applies to: all.
- P4 Employees see only their own tickets; agents and team leads see all. Applies to: F1, F2, F4. *assumed*

## Decisions
- Delivery: one web app and one API service.

## Open Questions
1. What real SLA targets per priority does the organization require?
