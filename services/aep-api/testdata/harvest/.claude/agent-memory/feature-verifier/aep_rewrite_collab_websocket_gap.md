---
name: aep_rewrite_collab_websocket_gap
description: Real-time collaborative editing websocket (ws://.../collab/...) always 502s in this docker-compose stack — collab-server isn't deployed, non-blocking
metadata:
  type: project
---

In the aep-console docker-compose stack (deployments/), the requirements/design
editor tries to open `ws://localhost:8090/collab/<doc-id>/<doc-id>?...` for
live collaborative editing. This always fails with a 502 and repeats every
~1-2s. Root cause confirmed via `docker logs aep-console`: nginx logs
`collab-server could not be resolved (2: Server failure)` — the `collab-server`
upstream host has no DNS entry, i.e. that microservice simply isn't part of
this compose stack.

**Why this matters:** it's noisy (dozens of console errors) and looks alarming
during verification, but it's cosmetic — the requirements/design document
itself still renders and saves correctly via the regular (non-collab) API
path, independent of this websocket. Not a regression to flag against a
backend rebuild.

**How to apply:** when a verification run shows repeated `ws://.../collab/...`
502 errors in console logs, check `docker logs aep-console` for the
"collab-server could not be resolved" nginx error before treating it as a
new bug — if present, it's this known environmental gap, not a regression.
