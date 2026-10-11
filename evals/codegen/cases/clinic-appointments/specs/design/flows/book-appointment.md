# Book and cancel an appointment

A patient finds an open slot, books it, and later cancels, subject to no double booking and the 2-hour cut-off.

```mermaid
sequenceDiagram
    actor Patient
    participant clinic-webapp
    participant clinic-api
    participant user-auth

    Patient->>clinic-webapp: open app
    clinic-webapp->>user-auth: sign in
    user-auth-->>clinic-webapp: token
    Patient->>clinic-webapp: browse open slots
    clinic-webapp->>clinic-api: list open slots
    clinic-api-->>clinic-webapp: slots
    Patient->>clinic-webapp: book a slot
    clinic-webapp->>clinic-api: book appointment
    alt slot already taken
        clinic-api-->>clinic-webapp: conflict
    else
        clinic-api-->>clinic-webapp: appointment booked
    end
    Patient->>clinic-webapp: cancel appointment
    clinic-webapp->>clinic-api: cancel appointment
    alt less than 2 hours to start
        clinic-api-->>clinic-webapp: refused
    else
        clinic-api-->>clinic-webapp: cancelled, slot reopened
    end
```
