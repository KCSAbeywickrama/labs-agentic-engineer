# Stock and ledger

## Purpose
Current stock level per item and the ledger of every stock change, for warehouse clerks.

Needs: F1.

## User Stories
- F5.1 As a warehouse clerk, I see the current stock level of every catalogue item in one list, searchable by name or SKU. *assumed*
- F5.2 As a warehouse clerk, I open an item and see its stock level, reorder level and its ledger entries, newest first. *assumed*
- F5.3 As a warehouse clerk, I see the full ledger across all items, newest first, filtered by item or date range. *assumed*
- F5.4 As a warehouse clerk, I see for each ledger entry its item, quantity change, resulting stock level, time, who made it and the receipt or request it came from. *assumed*
- F5.5 As a requester, I see the current stock level of a catalogue item. *assumed*

## Decisions
- Items, stock levels and the ledger are held in the inventory service, which only the procurement API calls (P1).
- The stock level of an item equals the sum of its ledger entries; a level is never edited directly (P3). *assumed*
- Ledger entries are append-only and cannot be edited or deleted. *assumed*
- A new item starts at zero stock. *assumed*
- Each ledger entry carries a signed quantity, so the ledger can record decreases, though this version only creates increases through goods receiving (F4). *assumed*
- Stock levels and the ledger are read-only in this feature; entries are created by other features. *assumed*
- Only warehouse clerks see the ledger; requesters see stock levels only. *assumed*

## Out of Scope
- Manual stock adjustments, write-offs and stock counts.
- Stock issues or consumption, and stock transfers between locations.
- Multiple warehouses or locations.
- Exporting the ledger.
