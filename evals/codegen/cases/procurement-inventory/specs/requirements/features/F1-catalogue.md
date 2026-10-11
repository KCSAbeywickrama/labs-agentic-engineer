# Catalogue

## Purpose
The list of items that can be requested and stocked, each with a reorder level, for requesters and warehouse clerks.

## User Stories
- F1.1 As a warehouse clerk, I add an item to the catalogue with a SKU, name, unit of measure and reorder level. *assumed*
- F1.2 As a warehouse clerk, I edit an item's name, unit of measure and reorder level. *assumed*
- F1.3 As a warehouse clerk, I deactivate an item so it can no longer be requested. *assumed*
- F1.4 As a requester, I browse and search active catalogue items by name or SKU. *assumed*
- F1.5 As a requester, I see an item's unit of measure and unit price when choosing it. *assumed*
- F1.6 As a warehouse clerk, I set an item's unit price. *assumed*

## Decisions
- The catalogue is maintained by warehouse clerks. *assumed*
- Each item has a unique SKU that never changes once created. *assumed*
- Items are deactivated, never deleted, so past requests and ledger entries stay readable. *assumed*
- Items are stored in the inventory service, reached only through the procurement API (P1).
- Unit price is a single catalogue price per item, in the company currency; no supplier or price history. *assumed*

## Out of Scope
- Supplier management and per-supplier pricing.
- Item categories and bulk import.
- Setting an item's opening stock; stock changes only through receiving (F4).
