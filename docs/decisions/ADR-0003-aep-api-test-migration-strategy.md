# ADR-0003: aep-api test-migration strategy (characterize-then-refactor)

- **Status:** Accepted
- **Date:** 2026-07-01
- **Context:** `services/aep-api` works but is under-tested (51 `_test.go`, only
  **1** real handler test, **2** dbtest files, **0** `_component_test.go`, no root
  integration suite on this branch). We want to converge it onto the layout in
  [`aep-api-target-structure.md`](../design/aep-api-target-structure.md) *without*
  a big-bang PR and *without* changing behavior. The open question was how to get
  a safety net when there's almost no coverage to start from. A dry-run that
  drives the app and "collects the values" was proposed as the source of tests.

## Decision

Migrate **in place, one component at a time**, under a test net we build first.
Nine forks were resolved (full plan + living tracker in
[`aep-api-test-migration-progress.md`](../design/aep-api-test-migration-progress.md)):

1. **Safety net = the in-process tiers** (unit + component + dbtest) from the
   target doc. A captured HTTP request/response is an e2e *golden* — the
   integration tier, scoped out ("owned elsewhere"). It is not the net.
2. **Model = characterize-then-refactor in place** (Feathers' cover-and-modify),
   **not** a strangler. There is no second implementation to route toward — the
   target is the same code re-homed under `internal/` and verticalized. (Extends
   [ADR-0002](./ADR-0002-clean-orphan-branch.md), which already rejected
   "strangler" at the repo level.)
3. **Phase 0 keystone before any per-feature work.** The component tier can't be
   written until `internal/app.Build` is extracted from `package main` and a
   `componenttest` harness exists — neither does today. Phase 0: **0a** harvest
   e2e goldens → **0b** extract `internal/app.Build`/`Bootstrap` (protected by
   0a, since `buildApp` has zero coverage) → **0c** `componenttest` harness +
   run the org-scope/IDOR gate in **ENFORCE** (kill the global gate-mode flip) →
   **0d** `dbtest.New` (testcontainers + pgtestdb). "Test-first" applies *within*
   each feature (Phase 1+), not to the harness.
4. **Pilot-first, not breadth-first.** Pilot A = `project` (already spine-correct
   + the one existing handler test → proves the harness with ~zero restructure).
   Pilot B = `orgcreds` (1466-LOC untested god-file needing a split → proves the
   pin→restructure→keep-green loop under real churn). Then replicate.
5. **Done-gate per component** = structure converged to its vertical + behaviors
   proven at their correct tier + e2e goldens still pass. **Deviation from the
   target doc:** its strict "each behavior at exactly one tier, delete the higher
   copy" rule is **softened** — purposeful re-proving (e.g. an IDOR check at both
   component and golden) is allowed. Honesty and maintainability outrank coverage.
6. **Test honesty is gated two ways:** (a) **coverage** watched per feature as a
   *gap-finder*, no hard %; (b) an **agent-verification pass** (reusing the
   code-review / feature-verifier infra) that reviews each feature's tests for
   honesty (fails on a real regression? over-mocked? tautological?),
   maintainability, and tier-fit. Its sign-off is the `agent-verified` column;
   open findings block "done".
7. **Progress doc** = a new living tracker,
   `docs/design/aep-api-test-migration-progress.md`, whose columns are the
   done-gate. Session TaskList mirrors it as ephemeral working state only.
8. **Harvest** = drive the real console via `playwright-cli skill` with HAR network
   capture(or added logs) + verbose aep-api logs, over the happy-path spine + a few error cases.
   Stored under `services/aep-api/testdata/harvest/`. Used as the 0b before/after
   diff oracle and as realistic component-test inputs. **One-time**, not a
   maintained e2e suite.
9. **Replicate order = the product spine** (project→requirements→design→task
   (+codingagent)→component→skills→idp→organization→orgcreds), reusing harvested
   fixtures in flow order. `gitrepo` + `artifacts` (git-exec heavy, zero tests,
   need a `gittest` harness) go **last** as their own sub-phase; they are pinned
   indirectly by spine goldens meanwhile. Backend-only features (no `*_huma.go`)
   get unit + dbtest only — no component tier is the correct exception, not a gap.

## Consequences

- **+** The one genuinely risky move (extracting untested `buildApp`) is done
  first, behind an e2e diff oracle, before the rest depends on it.
- **+** The composition-root extraction is reused verbatim by every component
  test — the harness *is* `app.Build`. No parallel wiring, no fourth framework.
- **+** Pilot A de-risks the harness with a clean feature; Pilot B de-risks the
  restructure loop with the worst one — before committing 12 more features to it.
- **+** Per-feature landing = reviewable PRs; matches the target doc's "converge
  while touching each area," not a big-bang diff.
- **−** Phase 0 is upfront harness work with no per-feature test to show for it
  until it lands — accepted; it is an unavoidable prerequisite.
- **−** Softening the anti-duplication rule risks some redundant tests; mitigated
  by the agent-verify pass flagging *accidental* (vs purposeful) duplication.
- **−** The dbtest tier requires Docker wherever it runs; the fast lane
  (`-short`) needs none. `gitrepo`/`artifacts` still need a separate `gittest`
  bet, deferred to the end.


## Notes

- As this is a big migration, use subagent to implement phases, add logs, do playwright cli skill sessions, test and verify sessions as well. Main Agent coordinates and makes sure the subagent completesd the task as specified and the stucture before moving on to the next phase. 
- You can always add logs(with a prefix) deploy it, run it using playwright cli skill, and collect the logs. This will be useful for writing various tests also.
- Its ok to take time on completing phases, quality and reliability is more important.
- If you do a change to runners, you can build that and push it as well with a tag, then change the bff to use that or some other mechanism.
- Make sure existing tests work before you start, if not, you have the freedom of deleting tests and starting from 0 tests as well.
- You are free to improve test framework related stuff like code coverage etc too, whatever best practices you should use.
- Make sure to do the demo flow on each phase, and verify nothing is broken, and run the tests as well. Fix then and there with real values. 
- After each phase, make sure the structure is as per the target doc, do a review using more subagents on code quality all that, make sure all tests pass, then commit(avoid commiting anything in design dir) before moving to next phase.


## Demo Flow
- teardown the existing cluster, start the env fresh (in case anything, otherwise use the existing cluster if its healthy)
- make sure, in organization settings, github repo,pat and anthroppic key is set, if not use deployments/.env creds to update them before anything.
- create new project
- prompt - write a hello world svc
- generate requirmeent -> design -> tasks.
- ensure all there, repo created, issues created
- implement via remote agent -> make sure live logs are there while in progress 
- merge pr, verify the webhook based auto build and deploy.

- In case of openchoreo cluster issues teardown the existing cluster, start fresh.


## Upon Finish

- Check the progress notes and see if we left out anything. plan them out and address them all. ask me if you need any inputs.

- Verify the current codebase of the aep-service with the target structure, cross check. Check if we missed anything(and correct it). Codebase should look exactly like the structure shown. 

- See if the tests covers the funtinolaties and the test inputs and asserts are correct and the coverage as well. 

- Do one last demo run in a fresh env. This should not face any issues or bugs and should be stable, if you find anything, fix and reiterate.


