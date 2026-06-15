# ADR-0002: Rewrite on a clean orphan branch (not a strangler)

- **Status:** Accepted
- **Date:** 2026-06-15
- **Context:** the rewrite reorganizes the repo into a clean monorepo. Two shapes
  were considered: (a) a *strangler* where the new scaffold coexists with the old
  tree on one branch, kept green together; (b) a *clean-slate* orphan branch where
  the scaffold is built at the repo root with none of the old code present.

## Decision

Build the rewrite on a **fresh orphan branch** (`aep-rewrite`) seeded with an
empty commit. The repo root starts truly empty; the scaffold is created at the
root. The existing codebase stays on `main`/`rewrite` and is **ported in later**
(`git checkout main -- <path>`, then reshaped), branch-to-branch.

**Endgame:** the branch is grown until it fully replaces the current codebase,
then **promoted to the default branch**; old `main` is archived. It is never
merged back — the orphan history *is* the new history.

## Consequences

- **+** Pristine root: no legacy workspace globs, no dual `go.work` entries, no
  "keep the old code green" constraints during the scaffold phase.
- **+** The old code's known-good state lives untouched on `main`/`rewrite` and is
  the rollback target until cutover.
- **−** Unrelated history: a merge-back would need `--allow-unrelated-histories`.
  Accepted deliberately — the intended cutover is a default-branch swap.
- **−** `deployments/` and anything needed to *run* the system are absent until
  ported, so the stack can't come up during pure-scaffold work. If a runnable
  stack is wanted early, `deployments/` is one of the first ports.
