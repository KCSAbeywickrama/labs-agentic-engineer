# A round's lifecycle, from opening to the consolidated order

A teammate opens today's round, the team adds items, and the round closes —
either the opener closes it early or its cutoff passes — after which the
opener gets the consolidated order. Slack hears about the open and the close.

```mermaid
sequenceDiagram
    actor Teammate
    participant lunchwebapp as lunch-webapp
    participant lunchapi as lunch-api
    participant slack as Slack

    Teammate->>lunchwebapp: open round (restaurant, cutoff)
    lunchwebapp->>lunchapi: POST /rounds
    alt a round is already open
        lunchapi-->>lunchwebapp: 409 refused
    else
        lunchapi-->>lunchwebapp: 201 round open
        lunchapi->>slack: post "round opened"
    end

    Teammate->>lunchwebapp: add item (description, qty, price)
    lunchwebapp->>lunchapi: POST /rounds/{id}/items

    alt opener closes early
        Teammate->>lunchwebapp: close round
        lunchwebapp->>lunchapi: POST /rounds/{id}/close
    else cutoff passes
        lunchapi->>lunchapi: cutoff check closes the round
    end
    lunchapi->>slack: post "round closed"

    Teammate->>lunchwebapp: view consolidated order
    lunchwebapp->>lunchapi: GET /rounds/{id}
    lunchapi-->>lunchwebapp: items grouped, per-person totals
```
