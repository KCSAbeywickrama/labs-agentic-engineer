# Library Circulation

## Problem Statement
Library members cannot easily find titles, borrow copies, reserve items that are out, or see what they owe. Librarians manage titles, copies, checkouts, returns and holds by hand, and late fees are calculated inconsistently.

## Solution
A library circulation system. Members search the catalogue, borrow copies, place holds and see their loans and fees. Librarians manage titles and copies, check items out and in, and work the holds queue. Every loan has a due date, and a late return computes a fee. The catalogue (titles, copies) lives in its own catalogue service that only the circulation API calls; the web app calls only the circulation API.

## Actors
- Member: searches the catalogue, borrows copies, places and cancels own holds, and sees own loans and fees.
- Librarian: manages titles and copies, checks items out and in, and works the holds queue.

## Features
- F1 [Catalogue search](features/F1-catalogue-search.md)
- F2 [Loans](features/F2-loans.md)
- F3 [Holds](features/F3-holds.md)
- F4 [Fees](features/F4-fees.md)
- F5 [Catalogue management](features/F5-catalogue-management.md)

## Product-wide
Sign-in, the borrowing block on unpaid fees and the architecture are on the [Product-wide](product-wide.md) page.

## Out of Scope
- Email or any other notifications.
- File uploads, cover images, object storage.
- Scheduled or background jobs (e.g. automatic overdue processing).
- External integrations and online payment.
- AI features.
- Loan renewals.
