# What the design assumes about Slack

- A single incoming webhook URL is enough; the team has one Slack channel for lunch notifications. *assumed* (F4)
- Slack webhook delivery is best-effort: a failed post is not retried and does not block opening or closing a round. *assumed* (F4)
