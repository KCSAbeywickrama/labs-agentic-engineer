# Low-stock view

## Purpose
Lists items whose stock is below their reorder level, so requesters and clerks see what to order.

Needs: F5.

## User Stories
- F6.1 As a warehouse clerk, I see a list of active items whose stock is below their reorder level. *assumed*
- F6.2 As a warehouse clerk, I see for each listed item its current stock, reorder level and the shortfall. *assumed*
- F6.3 As a warehouse clerk, I sort the low-stock list by shortfall or by name. *assumed*
- F6.4 As a requester, I see the same low-stock list, to know what to request. *assumed*
- F6.5 As a requester, I start a purchase request for a low-stock item directly from the list. *assumed*

## Decisions
- An item is low when its current stock is strictly below its reorder level. *assumed*
- Inactive items are never listed. *assumed*
- The list is computed from current stock when viewed; there is no alert, email or notification, per the product-wide decision.
- Stock levels and reorder levels come from the inventory service through the procurement API (P1).
- The list does not account for quantities already requested or approved but not yet received. *assumed*
- Approvers see no low-stock view. *assumed*

## Out of Scope
- Alerts, emails or notifications about low stock.
- Automatic creation of purchase requests.
- Suggested reorder quantities.
- Exporting the list.
