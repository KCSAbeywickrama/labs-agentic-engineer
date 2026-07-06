# ADR-0003 — Dependency status is computed at read time, never persisted

A dependency's `status`/`reason` (resolved, unresolved, blocked/access-required,
needs-spec) is derived on every read by comparing the authored design against
live platform state (the external-resource registry, the org endpoint catalog,
provisioned resources). It is structurally unrepresentable in `design.json` —
the codec rejects it on write.

The source implementation persisted status into the design file and it went
stale the moment the platform changed (a provider unpublishing, values being
provided). Persisting also made the agent responsible for a judgment only the
platform can make. The cost — every read pays catalog lookups — is acceptable
at org scale and keeps the file a pure statement of intent.
