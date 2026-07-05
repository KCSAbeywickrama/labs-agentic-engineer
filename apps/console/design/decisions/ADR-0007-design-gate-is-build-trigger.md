# ADR-0007: The design gate is exercised by triggering build, not a separate approval

- **Status:** Accepted
- **Date:** 2026-07-05 (grilling of the spec-view feature,
  [#80](https://github.com/wso2/labs-agentic-engineer/issues/80))
- **Context:** the PRD described the design gate as a blocking
  "review and approve" step, implying a recorded approval action. The
  spec view needed to decide what its primary CTA does; a separate
  approve-then-build two-step was proposed and rejected.

## Decision

The developer passes the design gate by **triggering the build** from the
spec view. There is no separate "approve" action anywhere in the console
or the contract: reviewing the derived design and clicking **Build** *is*
the approval. The trigger maps to the existing non-deprecated **Tasks
surface** (`generate-tasks` / `dispatch-tasks`), not a new approval
endpoint.

## Consequences

- The PRD's design-gate wording ("reviews and approves") is amended to
  "reviews, then triggers build" when #80 ships.
- No `approved` bookkeeping is requested from the BE; gate state is
  implied by the project reaching the `tasks` phase.
- Features must not reintroduce an approve/sign-off action for the design
  gate — supersede this ADR explicitly if that becomes necessary.
- #80 ships the Build button UI-only (enablement + navigation); the
  binding to the Tasks surface lands as its own follow-up.
