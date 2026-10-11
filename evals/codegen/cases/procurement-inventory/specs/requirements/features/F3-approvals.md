# Approvals

## Purpose
Approvers approve or reject purchase requests within their approval limit.

Needs: F2.

## User Stories
- F3.1 As an approver, I see a list of pending requests that are within my approval limit, oldest first. *assumed*
- F3.2 As an approver, I open a request and see its lines, quantities, prices, total, requester and justification. *assumed*
- F3.3 As an approver, I approve a pending request whose total is within my approval limit. *assumed*
- F3.4 As an approver, I reject a pending request with a reason. *assumed*
- F3.5 As an approver, I see the requests I have decided, with my decision and reason. *assumed*

## Decisions
- Each approver has a single approval limit, a maximum request total in the company currency. The limit is APPROVAL_LIMIT_DEFAULT, which is 5000.00 (500000 in minor units) when unset, for every approver; APPROVAL_LIMITS can override it per username as username=amount pairs.
- A request whose total exceeds an approver's limit cannot be approved or rejected by that approver, and is not shown in their pending list. *assumed*
- Approval is a single step by one approver; no chains or multiple sign-offs. *assumed*
- An approver cannot approve or reject their own request. *assumed*
- A rejection requires a reason, which the requester sees. *assumed*
- Approval limits come from configuration (APPROVAL_LIMIT_DEFAULT and the optional per-username APPROVAL_LIMITS); there is no screen to manage them.
- A decided request cannot be decided again. *assumed*

## Out of Scope
- Approval chains, delegation and escalation of requests above every limit.
- Approvers changing a request's lines or quantities.
- A screen for managing approval limits.

## Open Questions
1. What happens to a request above every approver's limit? Assumed to stay pending, with no escalation.
