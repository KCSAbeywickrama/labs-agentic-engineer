# Validation design

How AEP verifies that a delivered change **satisfies the user's requirements** — a structured
acceptance artifact, a durable VALIDATION phase, and the agents/workflows that run it.

**Start here:** `00-overview.md`.

| File | Shows |
|---|---|
| `00-overview.md` | **Design overview** — the `validation-criteria.json` artifact and its lifecycle, the VALIDATION phase (state machine + sequence), the `ValidationWorkflow` child + per-lane Jobs, the agent roster, fail/loop-back + always-human sign-off, Temporal integration, advantages, and complexities. |

Companion ADR: `../../decisions/ADR-0005-validation-phase.md`.
