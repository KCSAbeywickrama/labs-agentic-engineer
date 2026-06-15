# AGENTS.md — packages/clients

Hand-written cross-cutting clients for infrastructure that has no OpenAPI we own:
k8s, OpenChoreo, OAuth/OIDC, secret manager, etc.

**Status:** empty bucket. Ported from `asdlc-service/clients/*` (`plan.md` §10).

> Note: **only infra clients** live here. Service-to-service clients are
> *generated* from contracts (`@aep/contracts`), not hand-written. Which of
> today's `asdlc-service/clients/*` are infra vs. generated is a deferred
> decision (`plan.md` §0).

## Conventions

- One client per concern, one public entry point each.
- No business logic — transport + auth + (de)serialization only.
