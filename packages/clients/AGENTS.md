# AGENTS.md — packages/clients

Hand-written cross-cutting clients for infrastructure that has no OpenAPI we own:
k8s, OpenChoreo, OAuth/OIDC, secret manager, etc.

**Status:** nothing here yet.

> Note: **only infra clients** live here. Service-to-service clients are
> *generated* from contracts (`@aep/contracts`), not hand-written.

## Conventions

- One client per concern, one public entry point each.
- No business logic — transport + auth + (de)serialization only.
