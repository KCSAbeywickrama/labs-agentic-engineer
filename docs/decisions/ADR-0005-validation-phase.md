# ADR-0005: Requirement-validation phase and acceptance artifact

- **Status:** Proposed
- **Date:** 2026-06-26
- **Context:** the development cycle (`requirements → design → implement → merge → complete`) has no
  point at which AEP verifies that what was built **satisfies the user's requirements**. Gates advance
  the flow but "done" is asserted, never checked — so autonomous mode can ship a confident, wrong
  result. We add requirement-satisfaction as a first-class phase. Full design:
  `docs/design/validation/00-overview.md`. Builds on ADR-0003 (orchestration topology).

## Decision

| Concern | Decision |
|---|---|
| Validation kind | **Satisfaction (output)**: does the delivered change satisfy the requirements — not requirement input-quality (deferred). |
| Mechanism | **Hybrid**: executable e2e tests + agentic scenario judgment + (later) traceability. |
| Acceptance artifact | **`validation-criteria.yaml`** — structured mirror of the prose requirement, in the **project repo** at `specs/validation/`. |
| Artifact authorship | **`validation-criteria-author`** agent, on the **requirements → design** transition; derived from the **prose requirement only** (never design/code) to keep the oracle independent. |
| Artifact lifecycle | **Committed + human-reviewed like `design.md`** (generated and committed directly, no PR; re-committed on edits). Documented exception to the "generated artifacts are gitignored" rule, because it is the downstream oracle. |
| Does it feed design? | **Two variants prosed** — A: criteria feed the design/coding agents (better aim, weaker independence); **B (recommended default): review-only oracle** that does not feed design (full independence). |
| New phase | **`MERGE → VALIDATION → COMPLETE`**, with `VALIDATION → DESIGN` on failure. |
| Topology | **`ValidationWorkflow` child** started by `DevelopmentFlowWorkflow` at VALIDATION. **No per-criterion task workflows** (a criterion is a bounded agentic loop, not a webhook-driven state machine). |
| Job model | **Per-lane Jobs** (e2e-lane, scenario-lane), dispatched concurrently, reusing the coding-agent Job dispatch + `wc-<org>-remote-worker` `ResourceQuota`. Parallelism happens inside each Job. |
| Agents | `validation-criteria-author`; `e2e-test-author`; `e2e-test-healer`; `scenario-validator`. Failure **diagnosis** is a field on lane output (`{verdict, reason, reentry}`), not a standalone agent yet. |
| Healer contract | Repairs **brittle** specs only (locators/waits/setup). Real-vs-brittle adjudication kept **independent of the healer**; genuine assertion failures route to diagnosis as real fails — never healed to green. |
| Report | Deterministic **`AssembleReport`** activity (not an agent): auto-validated results + manual checklist + hand sign-off space. Committed to the project repo + read-model. |
| Sign-off | **Always human**, not subject to `GatePolicy`. **No cycle ever auto-COMPLETEs.** Execution autonomy is separate from sign-off. |
| Loop-back | **Fail auto-loops to DESIGN** (no human), report-driven `reentry` (`design` default; `implement` once IMPLEMENT-phase conformance exists; `criteria`). Bounded by a **max-attempt guard** that escalates to a human. |
| `covered` flag | Validation-owned; set true after a passing e2e run to skip regeneration; future regeneration must preserve/reset it deliberately. |
| Determinism | All I/O (Jobs, agent runs, commits, report writes) in activities; workflow branches on the **recorded** verdict only. |
| v1 scope | Satisfaction checks at the **VALIDATION phase only** — no DESIGN-gate traceability, no per-task validation. |

## Consequences

- A confident-but-wrong delivery can no longer ship unattended — every cycle halts at a human
  validation sign-off.
- Reuses existing machinery (child-workflow tier, Job dispatch, per-org quota, read-models, gate
  await); little new infrastructure beyond the new phase + agents.
- Adds a hard prerequisite: a **running deployed app** for Playwright to target after MERGE (dev
  deployment or an ephemeral validation env).
- Several items are **deferred** and called out so they are not lost: requirement-change handling
  (criterion ID stability + freshness/invalidation), the IMPLEMENT-phase design-conformance check (which
  enables `reentry: implement`), and DESIGN-gate traceability.
- The **Variant A/B** choice is left open here deliberately; B is the recommended default. Resolving it
  is the main follow-up to this ADR.
