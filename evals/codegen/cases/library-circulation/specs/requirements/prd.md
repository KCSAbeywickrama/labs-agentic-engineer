# Library Circulation

## Problem Statement
Library staff and members need one place to find titles, borrow copies, queue for popular items and see what is owed. Without it, loans, holds and late fees are tracked by hand and members cannot see their own standing.

## Solution
A web app where members search the catalogue, borrow copies, place holds and see their loans and fees, and where librarians manage titles and copies, check items out and in, and work the holds queue. A loan has a due date, and a late return computes a fee.

## Actors
- Member: searches the catalogue, places holds, sees their own loans, holds and fees.
- Librarian: manages titles and copies, checks items out and in, works the holds queue.

## Features
- F1 [Catalogue](features/F1-catalogue.md)
- F2 [Loans](features/F2-loans.md)
- F3 [Holds](features/F3-holds.md)
- F4 [Fees](features/F4-fees.md)

## Product-wide
See [Product-wide](product-wide.md).

## Out of Scope
- Email or any other notifications.
- File uploads or object storage.
- Scheduled or background jobs.
- External integrations.
- AI features.

## Open Questions
1. Can members borrow on their own (self-checkout), or only via a librarian? *assumed* librarian checks out.
