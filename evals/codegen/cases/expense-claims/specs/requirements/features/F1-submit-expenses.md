# Submit expenses

## Purpose
Employees create and submit expense claims and track their status.

## User Stories
- F1.1 As an employee, I create a claim with one or more expense lines, each with a date, category, amount and description. *assumed*
- F1.2 As an employee, I save a claim as a draft and edit it until I submit it. *assumed*
- F1.3 As an employee, I submit a draft claim for approval. *assumed*
- F1.4 As an employee, I see a list of my claims with their status (draft, submitted, approved, rejected, exported). *assumed*
- F1.5 As an employee, I see the rejection reason on a rejected claim. *assumed*
- F1.6 As an employee, I edit a rejected claim and resubmit it. *assumed*
- F1.7 As an employee, I withdraw a submitted claim that has not yet been decided. *assumed*

## Decisions
- A claim is reviewed by the employee's line manager. *assumed*
- Expense lines are entered as data only; receipts are not attached or stored. *assumed*
- Categories are a fixed list maintained by the product. *assumed*
- An employee sees only their own claims. *assumed*
- No notification is sent on submission or on any status change; employees check the list.

## Out of Scope
- Receipt or file uploads.
- Multi-currency claims.
- Email or other notifications.
