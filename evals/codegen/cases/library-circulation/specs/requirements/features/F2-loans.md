# Loans

## Purpose
Members borrow copies and see their loans; librarians check copies out and in.

Needs: F5.

## User Stories
- F2.1 As a member, I want to borrow an available copy, so that I can take it home.
- F2.2 As a member, I want to see my current loans with their due dates, so that I know when to return them.
- F2.3 As a librarian, I want to check a copy out to a member, so that the loan is recorded with a due date.
- F2.4 As a librarian, I want to check a copy in, so that the loan closes and the copy becomes available or goes to the next hold.

## Decisions
- Loan period: 14 days from checkout. *assumed*
- Loan limits: a member may hold at most 5 active loans. *assumed*
