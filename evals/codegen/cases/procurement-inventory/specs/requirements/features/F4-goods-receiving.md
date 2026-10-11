# Goods receiving

## Purpose
Warehouse clerks receive goods against approved orders, which raises stock.

Needs: F3, F5.

## User Stories
- F4.1 As a warehouse clerk, I see a list of approved requests that still have goods to receive, oldest first. *assumed*
- F4.2 As a warehouse clerk, I open an approved request and see each line's ordered, already received and outstanding quantity. *assumed*
- F4.3 As a warehouse clerk, I record a receipt of goods against an approved request, entering the quantity received for one or more lines. *assumed*
- F4.4 As a warehouse clerk, I see each receipt raise the stock of the received items, with a ledger entry per line. *assumed*
- F4.5 As a warehouse clerk, I receive an order in several partial receipts until every line is complete. *assumed*
- F4.6 As a warehouse clerk, I see the history of receipts made against a request. *assumed*

## Decisions
- Goods can be received only against an approved request. *assumed*
- A receipt cannot take a line's total received above its ordered quantity; over-delivery is not accepted. *assumed*
- Each receipt line creates one ledger entry that increases the item's stock (P3). *assumed*
- A request becomes received once every line is fully received, as set in F2. *assumed*
- A receipt records the clerk and the time, and cannot be edited or deleted once saved. *assumed*
- A mistaken receipt is not reversed in this version. *assumed*

## Out of Scope
- Rejecting or returning damaged goods to a supplier.
- Receiving goods with no approved request.
- Reversing or correcting a receipt, and stock adjustments or write-offs.
- Delivery notes, photos or any file attachments.

## Open Questions
1. How should a clerk correct a receipt entered by mistake? Assumed to be out of scope for now.
