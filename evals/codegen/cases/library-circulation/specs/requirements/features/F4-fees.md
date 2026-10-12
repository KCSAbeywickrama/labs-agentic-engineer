# Fees

## Purpose
Members see fees owed from late returns; the fee is computed when an overdue item is returned.

Needs: F2.

## User Stories
- F4.1 As a librarian, when I check in a copy after its due date, the system computes a late fee from the days overdue. *assumed*
- F4.2 As a member, I see my fees, each with its loan, days late, amount and whether it is unpaid or settled. *assumed*
- F4.3 As a member, I see my total unpaid balance. *assumed*
- F4.4 As a librarian, I see a member's fees and unpaid balance. *assumed*
- F4.5 As a librarian, I record a payment that settles a fee. *assumed*
- F4.6 As a librarian, I waive a fee. *assumed*

## Decisions
- The late fee is a flat daily rate per day overdue, 0.25 per day. *assumed*
- A fee is capped at 10.00 per loan. *assumed*
- Fees are computed only when the copy is returned, never accrued while it is out. [brief]
- A fee is a record of the late loan, shown in the single currency in minor units. [P5]
- Payment is recorded manually by a librarian; there is no online payment. *assumed*
- A member with unpaid fees above 10.00 cannot be checked out further items. *assumed*

## Out of Scope
- Online payments or payment provider integration.
- Fines for lost or damaged items.
- Fee reminders or notifications.
