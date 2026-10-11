# Fees

## Purpose
A late return computes a fee, and members see what they owe.

Needs: F2.

## User Stories
- F4.1 As a member, I want to see my fees, so that I know what I owe.
- F4.2 As a librarian, I want a fee computed automatically on a late return, so that fees are consistent.

## Decisions
- Late fee: a flat rate per day overdue, 0.25 per day, capped at the replacement value is not applied; no cap. *assumed*
- Fee payment: fees are displayed only; settling them happens at the desk and a librarian marks them paid. *assumed*
- Fees are computed when the item is returned, not by background jobs.

## Open Questions
1. What currency and exact fee rate does the library use? (0.25 per day is assumed.)
