---
name: aep_rewrite_status_lag_gotcha
description: aep-api /tasks list status field lags ~10-70s behind /builds and /deployments sub-resources during the build/deploy webhook pipeline
metadata:
  type: project
---

While polling the build/deploy pipeline after a PR merge (2026-07-02, Pilot A
full-demo verification), `GET /projects/<id>/tasks` sometimes reported a
stale `status` (e.g. still `building`) for 30-70s after the underlying
`GET /projects/<id>/components/<name>/builds` and `.../deployments`
sub-resources — and even `kubectl get pods`/`kubectl get jobs` directly —
already showed the workflow step `Succeeded` or the deployment `Ready`.
Confirmed this isn't a stall by checking k3d pod/job state directly
(`kubectl get pods -A | grep <build-job-name>`), which is authoritative and
faster than the aep-api's own view.

**Why:** likely a polling/reconciliation interval on the aep-api side between
the OpenChoreo workflow/release state and the task's derived `status` field
— not a bug, just latency in the status projection.

**How to apply:** when verifying build/deploy steps, don't conclude "stuck"
from the `/tasks` list status alone. Cross-check `/components/<name>/builds`
(look at `.items[0].tasks[].phase`) and `/components/<name>/deployments`
(look at `.items[0].status`), and if still ambiguous, `kubectl get
pods/jobs -A | grep <build-run-name>` for ground truth. See
[[aep_rewrite_pilot_a_full_demo]] for the full verified trace.
