# Technical decisions

- [architecture] Slack notifications are posted by lunch-api itself, via an incoming webhook; there is no separate notification component. *assumed* (F4)
- [architecture] The cutoff check that closes a round and triggers the Slack cutoff message runs as a background task inside lunch-api rather than a separate scheduled-task component. *assumed* (F1, F4)
- [data-model] A round's open/closed state is derived from its cutoff time and an optional closedAt timestamp, rather than a stored status field with its own transitions. *assumed* (F1)
- [data-model] Prices are stored in cents. *assumed* (F2, F3)
- [security] Closing a round early and editing or removing an item are each gated by one handle (`rounds:close`, `items:manage`); lunch-api checks ownership against the round's opener or the item's creator rather than exposing a second scope. *assumed* (F1, F2)
- [lunch-api] Past rounds are listed 20 per page, most recent first. *assumed* (F1)
