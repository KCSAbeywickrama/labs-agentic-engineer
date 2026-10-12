# Domain model

An onboarding tracks one new hire's checklist of tasks, each owned by a department (IT, HR or Facilities). Overdue and due-soon flags are computed from the due date, not stored.

```mermaid
erDiagram
    ONBOARDING ||--o{ TASK : contains
    TASK ||--o{ TASK_NOTE : has

    ONBOARDING {
        string id PK
        string newHireName
        string role
        date startDate
        string status "active | closed | cancelled"
    }
    TASK {
        string id PK
        string onboardingId FK
        string title
        string description
        string department "IT | HR | Facilities"
        date dueDate
        string status "open | done"
        date completedOn
    }
    TASK_NOTE {
        string id PK
        string taskId FK
        string text
        string authorUsername
        datetime createdAt
    }
```

- Progress, per-department done/open counts, overdue and due-soon are derived from tasks and today's date.
- A new onboarding is seeded with the default task set, with due dates as offsets from the start date.
- A caller's department is not stored: the API derives it from which department scopes (`tasks:*-it`, `-hr`, `-facilities`) the gateway assertion carries; the assertion holds sub, username and scope only, never groups.
