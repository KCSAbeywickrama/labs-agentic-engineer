# Loans

## Purpose
Librarians check copies out and in; members see their loans. A loan has a due date and a late return computes a fee.

Needs: F1.

## User Stories
- F2.1 As a librarian, I check out an available copy to a member, which creates a loan with a due date. *assumed*
- F2.2 As a librarian, I check in a returned copy, which closes the loan and makes the copy available. *assumed*
- F2.3 As a librarian, I see a member's open loans and all overdue loans. *assumed*
- F2.4 As a member, I see my current loans with due dates and which are overdue. *assumed*
- F2.5 As a member, I see my past loans. *assumed*
- F2.6 As a librarian, I renew a loan once, extending its due date. *assumed*

## Decisions
- The loan period is 21 days from checkout. *assumed*
- A member may hold at most 10 open loans. *assumed*
- A copy can be checked out only when its status is available. *assumed*
- A late return records the days overdue and passes them to Fees, which computes the fee. [brief]
- A loan is overdue when it is open and past its due date; this is derived when read, with no background job. *assumed*
- A renewal is refused when the title has holds waiting. *assumed*

## Out of Scope
- Member self-checkout.
- Overdue reminders or notifications.
