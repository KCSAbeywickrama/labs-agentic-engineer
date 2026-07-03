# AGENTS.md — packages/contracts (`@aep/contracts`)

## Drift guard

`make -C services/aep-api openapi-check` regenerates and fails if the
committed spec is out of sync (make-level; no CI wiring yet).
