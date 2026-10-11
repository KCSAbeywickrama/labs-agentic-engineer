# Procurement and Stock

## Problem Statement
Staff who need goods have no single place to request them, get spending approved within each approver's authority, and record what arrives. Stock levels are tracked ad hoc, so nobody can trust what is on hand or see what is running low. Today's workaround (messages and spreadsheets) causes unapproved spend, lost receipts and stock-outs.

## Solution
A procurement and stock system. Requesters raise purchase requests for catalogue items; approvers approve or reject them within the approval limit; warehouse clerks maintain the item catalogue and receive goods against approved orders, which raises stock. Every stock change is recorded as a ledger entry, and a low-stock view lists items below their reorder level.

## Actors
- Requester: browses the catalogue, raises purchase requests and follows their status.
- Approver: reviews pending requests and approves or rejects those within the approval limit.
- Warehouse Clerk: adds and edits catalogue items, receives goods against approved orders, and views stock levels, the ledger and the low-stock view.

## Features
- F1 [Purchase requests](features/F1-purchase-requests.md)
- F2 [Approvals](features/F2-approvals.md)
- F3 [Receiving and stock](features/F3-receiving-and-stock.md)
- F4 [Catalogue](features/F4-catalogue.md)

## Product-wide
Sign-in, reorder levels and the architecture are on the [Product-wide](product-wide.md) page.

## Out of Scope
- Email or any notifications.
- File uploads or object storage.
- Scheduled or background jobs.
- External integrations.
- AI features or agents.
- Stock issues or adjustments other than receiving; deleting catalogue items.
