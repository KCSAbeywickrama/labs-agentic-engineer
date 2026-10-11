# Receiving and stock

## Purpose
A warehouse clerk receives goods against approved orders, which raises stock, and reads every item's ledger and what is running low.

Needs: F2.

## User Stories
- F3.1 As a Warehouse Clerk, I want to receive goods against an approved order, so that stock is raised to match what arrived.
- F3.2 As a Warehouse Clerk, I want every stock change recorded as a ledger entry, so that stock movements are traceable.
- F3.3 As a Warehouse Clerk, I want to view the ledger for an item, so that I can see how its level came about.
- F3.4 As a Warehouse Clerk, I want a low-stock view listing items below their reorder level, so that I know what needs replenishing.

## Decisions
- Stock changes only through receiving goods; each change writes a ledger entry. *assumed*
- Receiving may be partial, and an order remains open until fully received. *assumed*
