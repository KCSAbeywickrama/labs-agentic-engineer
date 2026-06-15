# AGENTS.md — tests/integration

API integration tests (vitest) against the real cluster. Exercise service
boundaries without a browser.

**Status:** empty bucket. Ported from `tests/` (`plan.md` §10).

## Conventions

- Run against the cluster from `deployments/` — no mocked infra.
- DB resets between suites via the test-only reset endpoint (`TEST_MODE=true`).
- Assert against the generated contract types from `@aep/contracts`.
