# Approvals

## Purpose
An approver approves or rejects pending requests, within the approval limit.

Needs: F1.

## User Stories
- F2.1 As an Approver, I want to see pending purchase requests, so that I can review them.
- F2.2 As an Approver, I want to approve or reject a request within the approval limit, so that spending stays under control.
- F2.3 As an Approver, I want requests above the approval limit to be refused for approval, so that the limit is enforced.

## Decisions
- Approval limit: one configured value of 5000 (maximum total request value) for all approvers; there are no per-approver limits.
- A requester cannot approve their own request. *assumed*
