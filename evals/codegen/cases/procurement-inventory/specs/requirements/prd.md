# Procurement and Stock

## Problem Statement
Staff who need goods have no single controlled way to request them, get them approved within spending authority, and record their arrival. Stock levels are therefore unreliable and nobody sees what is running low.

## Solution
A procurement web app where requesters raise purchase requests for catalogue items, approvers approve or reject them within their approval limit, and warehouse clerks receive goods against approved orders. Receiving raises stock; every stock change is a ledger entry, and a low-stock view lists items below their reorder level.

## Actors
- Requester: raises purchase requests for catalogue items and follows their status.
- Approver: approves or rejects purchase requests up to their approval limit.
- Warehouse clerk: receives goods against approved orders and sees stock levels, the ledger and the low-stock view.

## Features
- F1 [Catalogue](features/F1-catalogue.md)
- F2 [Purchase requests](features/F2-purchase-requests.md)
- F3 [Approvals](features/F3-approvals.md)
- F4 [Goods receiving](features/F4-goods-receiving.md)
- F5 [Stock and ledger](features/F5-stock-and-ledger.md)
- F6 [Low-stock view](features/F6-low-stock-view.md)

## Product-wide
See [Product-wide](product-wide.md).

## Out of Scope
- Email or any other notifications.
- File uploads and object storage.
- Scheduled or background jobs.
- External integrations.
- AI features.

## Open Questions
1. Who maintains the catalogue (items and reorder levels)? Assumed to be the warehouse clerk; see F1.
