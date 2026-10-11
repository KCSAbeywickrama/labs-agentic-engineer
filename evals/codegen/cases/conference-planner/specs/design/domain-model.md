# Domain model

Events, sessions and rooms, talk proposals with their reviews, and registrations with a waitlist. The events API owns everything except `Registration` and `Capacity`, which belong to the registration service (P3).

```mermaid
erDiagram
    PERSON ||--o{ PROPOSAL : submits
    EVENT ||--o{ ROOM : has
    EVENT ||--o{ SESSION : schedules
    ROOM ||--o{ SESSION : hosts
    EVENT ||--o{ PROPOSAL : receives
    PROPOSAL ||--o{ REVIEW : scored_by
    PERSON ||--o{ REVIEW : writes
    EVENT ||--o{ REVIEWER_ASSIGNMENT : assigns
    PERSON |o--o{ REVIEWER_ASSIGNMENT : binds_to
    PROPOSAL ||--o| SESSION : presented_in
    EVENT ||--|| CAPACITY : limited_by
    SESSION ||--|| CAPACITY : limited_by
    CAPACITY ||--o{ REGISTRATION : holds
    PERSON ||--o{ REGISTRATION : makes

    PERSON {
        string id PK "gateway subject"
        string username
        string displayName
    }
    EVENT {
        string id PK
        string name
        date startDate
        date endDate
        string venue
        string timeZone
        int capacity
        boolean callForProposalsOpen
    }
    ROOM {
        string id PK
        string eventId FK
        string name
        int capacity
    }
    SESSION {
        string id PK
        string eventId FK
        string roomId FK
        string title
        datetime startsAt
        datetime endsAt
        int capacity
        string proposalId FK
    }
    PROPOSAL {
        string id PK
        string eventId FK
        string speakerId FK
        string title
        string abstract
        string format
        int durationMinutes
        string status "submitted|under-review|accepted|rejected|withdrawn"
        string decisionComment
    }
    REVIEW {
        string proposalId FK
        string reviewerId FK
        int score "1 to 5"
        string comment
    }
    REVIEWER_ASSIGNMENT {
        string eventId FK
        string reviewerUsername "assigned by username, may precede first sign-in"
        string reviewerId FK "null until the person's first call, then bound"
    }
    CAPACITY {
        string targetType "event|session"
        string targetId PK
        int seats
    }
    REGISTRATION {
        string id PK
        string targetType "event|session"
        string targetId FK
        string personId FK
        string status "confirmed|waitlisted"
        datetime queuedAt
    }
```

`Person` is filled from the gateway's signed assertion the first time someone calls the events API. A reviewer assignment is stored against a username; on that person's first call it binds to their `Person` id, and queue and score checks match on username or id. A waitlist position is derived from `queuedAt` order among waitlisted registrations of one target.
