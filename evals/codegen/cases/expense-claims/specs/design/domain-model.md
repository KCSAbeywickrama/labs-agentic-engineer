# Domain model

Employees file claims made of expense lines; their manager decides; finance groups approved claims into export batches. Amounts are integer cents in one company currency (P3).

```mermaid
erDiagram
    EMPLOYEE ||--o{ CLAIM : files
    EMPLOYEE ||--o{ EMPLOYEE : manages
    CLAIM ||--|{ EXPENSE_LINE : contains
    EXPORT_BATCH ||--|{ CLAIM : includes
    CLAIM ||--o{ AUDIT_ENTRY : records

    EMPLOYEE {
        string id PK "assertion sub"
        string name "assertion username"
        string managerId FK
    }
    CLAIM {
        string id PK
        string employeeId FK
        string status "draft submitted approved rejected exported"
        int totalCents
        string rejectionReason
        string decidedBy
        datetime submittedAt
        datetime decidedAt
        string batchId FK
    }
    EXPENSE_LINE {
        string id PK
        string claimId FK
        date expenseDate
        string category
        int amountCents
        string description
    }
    EXPORT_BATCH {
        string id PK
        string createdBy
        datetime createdAt
    }
    AUDIT_ENTRY {
        string id PK
        string claimId FK
        string actorId
        string action
        datetime at
    }
```

Categories are a fixed list served by the API. An employee record is created by the API itself: on every authenticated request it upserts an employee with `id` = the gateway assertion's `sub` and `name` = its username, and the web app calls `GET /me` at startup so each person is recorded on first open. The manager relation (`managerId`) is set by finance through the API, choosing from every recorded employee; it is not taken from the sign-in directory.
