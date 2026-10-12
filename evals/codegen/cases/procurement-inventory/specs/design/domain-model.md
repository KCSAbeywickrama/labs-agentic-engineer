# Domain model

Requests, approvals and receipts belong to the procurement API; items, stock levels and the ledger belong to the inventory service. Requests reference items by id only.

```mermaid
erDiagram
    ITEM ||--|| STOCK_LEVEL : has
    ITEM ||--o{ LEDGER_ENTRY : records
    ITEM ||--o{ REQUEST_LINE : "requested in"
    PURCHASE_REQUEST ||--|{ REQUEST_LINE : contains
    PURCHASE_REQUEST ||--o{ RECEIPT : "received by"
    RECEIPT ||--|{ RECEIPT_LINE : contains
    REQUEST_LINE ||--o{ RECEIPT_LINE : fulfils
    RECEIPT_LINE ||--|| LEDGER_ENTRY : raises

    ITEM {
        string id
        string sku
        string name
        string unitOfMeasure
        int reorderLevel
        int unitPriceCents
        boolean active
    }
    STOCK_LEVEL {
        string itemId
        int quantity
    }
    LEDGER_ENTRY {
        string id
        string itemId
        int quantityChange
        int resultingQuantity
        string actorId
        string sourceType
        string sourceId
        datetime createdAt
    }
    PURCHASE_REQUEST {
        string id
        string requesterId
        string requesterName
        string status
        string justification
        int totalCents
        string decidedBy
        string decisionReason
        datetime submittedAt
        datetime decidedAt
    }
    REQUEST_LINE {
        string id
        string requestId
        string itemId
        string itemName
        int quantity
        int unitPriceCents
        int receivedQuantity
    }
    RECEIPT {
        string id
        string requestId
        string clerkId
        datetime receivedAt
    }
    RECEIPT_LINE {
        string id
        string receiptId
        string requestLineId
        int quantity
    }
```

Approval limits are configuration, not an entity: every Approver has APPROVAL_LIMIT_DEFAULT (500000 minor units, i.e. 5000.00, when unset), with optional per-username overrides in APPROVAL_LIMITS (username=amount pairs). There is no screen to manage them. Money is in cents in the company currency. Status values: draft, pending, approved, rejected, withdrawn, received.
