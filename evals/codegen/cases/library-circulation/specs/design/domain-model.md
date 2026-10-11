# Domain model

Titles and copies belong to the catalogue service; loans, holds and fees belong to the circulation API. Members are the signed-in people and are identified by their sign-in subject, so there is no member table.

```mermaid
erDiagram
    TITLE ||--o{ COPY : has
    TITLE ||--o{ HOLD : "queued on"
    COPY ||--o{ LOAN : "lent in"
    LOAN ||--o| FEE : "may incur"
    HOLD }o--o| COPY : "ready with"

    TITLE {
        string id PK
        string name
        string author
        string subject
    }
    COPY {
        string id PK
        string titleId FK
        string barcode
        string status "available, on-loan, on-hold-shelf, withdrawn"
    }
    LOAN {
        string id PK
        string copyId FK
        string memberId
        date checkedOutOn
        date dueOn
        date returnedOn
        int renewals
    }
    HOLD {
        string id PK
        string titleId FK
        string memberId
        datetime placedAt
        string status "active, ready, fulfilled, cancelled"
        string copyId FK
        date readyUntil
    }
    FEE {
        string id PK
        string loanId FK
        string memberId
        int daysLate
        int amountCents
        string status "unpaid, settled, waived"
    }
```

- A loan is overdue when it is open and `dueOn` is past; this is derived on read.
- Fee amount is 25 minor units per day late, capped at 1000 per loan.
- A hold's queue position is derived from `placedAt` among active holds on the title.
