# ADR-0020 — A run species is a workflow, not a branch

**Status:** Accepted · **Refines:** [ADR-0011](ADR-0011-milestone-is-the-unit-of-execution.md) (the
milestone is still the unit of execution; what changes is how many supervisors work one)

## Context

ADR-0011 put ONE supervised run on a milestone and worked it until it settled. Judging the result was
that run's last cycle: at deployed-green the supervisor minted the version's validation task,
dispatched an agent at it, read the committed report back as the run's verdict, and — on a failure it
had attempts left for — filed a repair issue per criterion and went round again.

It held together while a verdict was a step in delivering a version. It stopped holding as soon as the
verdict became a fact about a version that had *already* shipped:

- **The two answers have different lifetimes.** "Is the increment built" is answered in minutes and
  then never again. "Does the deployed system hold" is asked at deployed-green, asked again after a
  `src/validation` fix months later, and asked by a human clicking revalidate on a version three
  releases old. A workflow that owns both cannot settle: the run that delivered `v3` is the only thing
  holding `v3`'s verdict, so it either stays alive indefinitely or the verdict is orphaned.
- **The failure classes are not interchangeable.** A validation agent that dies through its whole
  re-dispatch budget failed the entire version — `redispatch-budget` on the dev run — even though every
  line of code had merged, built and deployed. The version was delivered; nobody had looked at it. One
  run row cannot say both.
- **The repair loop ran inside the delivery loop.** A failed verdict filed bugs into the working set
  the same run was polling, so the boundary's own rules (no-progress, the cycle ceiling, the fix chain)
  were being asked to bound work minted by a stage that sat outside them. `RunValidates` existed
  precisely to tell the loop which of two shapes it was in.
- **The revalidate endpoint had to fake a run.** It started a run whose working set was empty *by
  design* and whose first act was to skip the loop — the loop it nominally shared — and enter at
  validation. Every predicate in the boundary carried an exception for it.

There are three species of run, and `kind` (`dev` / `task` / `validation`) already named them. They
were three branch sets inside one workflow.

## Decision

**Each run species is its own top-level Temporal workflow.**

```text
DevRunWorkflow          gates → plan → cycle loop → mint the validation task → settle
TaskRunWorkflow         cycle loop → settle
ValidationRunWorkflow   adopt-or-mint the task → agent stage → verdict → repair issues → close → settle
```

A **dev run settles at deployed-green having minted the version's validation task, and never
validates.** A **validation run**, started by the reconcile sweep because an open `validation`-kind
issue exists, produces the verdict. `RunValidates` now answers `validation` and nothing else, so the
newest *validating* run on a milestone owns that version's answer and a dev run's empty verdict means
"not judged yet" rather than "judged and fine".

### They are independent executions, not children of a parent

The obvious alternative is a milestone-level parent workflow with three child executions. It is
rejected, and the reason is the lifetime problem above stated precisely: **a parent would have to
outlive what it supervises.** A build settles; validation may start much later, or after a
`src/validation` fix, or never — a project with no acceptance oracle never gets one. A parent waiting
on a child that may never be started is a workflow with no terminating condition, which is the exact
shape that made validation-inside-delivery unsettleable. Child workflows would also make cancel and
signal delivery a two-hop question, and put a run's budgets one level away from the run that spends
them.

Independence costs nothing in routing because **the run ROW is the routing table.** The event plane
already resolves a run row before it signals anything, and the row's `kind` gives both the workflow
type and the workflow id's prefix (`delivery.RunKindOf` → `RunWorkflowName` / `MilestoneRunWorkflowID`).
There is no lookup table to keep, and no parent to ask.

### The kind prefix on the workflow id is load-bearing

Ids are reused under `WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE`, because a milestone sees sequential
runs of one kind across its life. Three species sharing one grammar would therefore claim the SAME id
in turn — and a stale `pull_request` signal aimed at a settled dev run would be delivered to the
validation run that claimed the id afterwards, which would then read the cycle facts of a merge that
was never its own. The grammar is `<kind>-<org>-<project>-<milestone>`; a row with no kind reads as
`dev`, which is the only kind a row could have carried before the column existed.

`AbandonRun` (project delete) consequently terminates **all three** ids. There is no row left to ask
which ever existed — the rows are purged in the same teardown — so a kind missed there leaves a
supervisor retrying its milestone poll forever against a repository that is gone, squatting on an id
any later same-named project's first run is then refused as `AlreadyStarted` on.

### One `Activities` struct, three `RegisterWorkflow` calls

Temporal registers an activity by its **reflected method name**. Two activity structs sharing any
method name panic the worker at Start — a boot-time crash whose stack names neither workflow — and
three structs carved out of one loop would share a great many. So the split is by FILE inside one
package, over one shared `loop` struct (it owns the signal channels, the budgets and the cycle state,
and every workflow wants all three), with one `Activities` struct and three workflows taking method
expressions off it. That is the only shape that cannot break that way, whatever gets added later.

Sub-packages were considered and rejected: `internal/arch` gives siblings a blanket import ban with no
layer concept, and second-level packages are unchecked in both directions — so sub-packages would be
*less* protected than files.

**Dev and task are the same loop with different bookends** — one `bookends{before, onEmpty}` value, not
two cycle loops that drift apart. Every rule that makes the loop safe is therefore one implementation:
a fix applied to a defect run cannot silently miss a release.

### The validation workflow does not share the cycle loop at all

It has no working set to poll, and its pull request touches only `tests/` — so the path diff yields no
components and both the build and the deploy stage were already silent no-ops for it. It **skips them
outright**, which is the honest form of what was already true and removes two stages' worth of failure
modes from a run that could never reach them.

Two things span validation runs: the version's attempt allowance and the previous report's digest.
Neither is carried, because there is nothing to carry them in — each attempt is its own execution, so
the previous one's state is gone. Both are **derived from the ledger**: attempts is how many
`kind = validation` runs the milestone has, and the digest is the newest prior validation cycle's
`run_cycles.validation_digest`. Two consecutive identical digests prove the repair moved nothing and
stop the chain even though the allowance is not spent.

The digest is written by the **same activity as the verdict**, and must be: that cycle write is fenced
write-once on an empty verdict, so a digest recorded afterwards could never land on the cycle it
belongs to — and the next attempt would silently have nothing to compare against.

### The validation task's close is the platform's, and every ending performs it

The reconcile sweep starts a validation run BECAUSE an open `validation`-kind issue exists. So a run
that gave up and left the task open would be restarted within a tick, give up again, and keep doing
that forever, paying for two agent dispatches each time — and nothing outside the workflow can repair
a dead dispatch. **The task is therefore closed on every ending, verdict or no verdict**, including an
agent that died through its whole re-dispatch budget. What that leaves is a version that is deployed
and unjudged: honest, since no verdict is claimed, and one click from being asked again.

### `Validates #N` — and why not simply dropping `Closes #N`

Platform-owned close means the validation pull request must not carry a GitHub closing keyword: two
owners on one issue race on every attempt, and a reopen for the next attempt racing the host's own
close is indistinguishable from a human reopening it.

**Taken literally, dropping `Closes #N` breaks auto-merge.** `decideAutoMerge` requires a pull request
to reference at least one armed issue in the milestone, and the reference is parsed by `resolvesRefRE`,
which matches only GitHub's closing keywords. A validation pull request referencing nothing would be
treated as somebody else's work, would never merge, no report would ever be committed, and **every
validation would settle `unreported`** — a verdict about the software produced entirely by the
platform's own filter.

So the reference stays and becomes non-closing: **`Validates #N`**. `Validates` is not a GitHub closing
keyword, so the host closes nothing and the platform is the single owner. `resolves.go` gains a second
parse and `decideAutoMerge` admits it, **scoped to a reference to a `validation`-kind issue** — without
that scope it would become a general-purpose way to get a pull request merged while closing nothing,
and the working set would never empty. A coding pull request carrying only `Validates #N` is declined.

The two lists never merge. A coding pull request's `Resolves` list is also the durable record of what
that cycle finished (`RunCycle.Resolves`), so folding a reference that closed nothing into it would
claim work that is still open.

### The sweep becomes the trigger router, and reads issues

For each known milestone with no live run: an open `validation`-kind issue starts a validation run;
otherwise open work starts a run as before. It reads the milestone's OPEN ISSUES (REST, no label
filter) and decides in Go, because routing by kind is an intersection GraphQL's union-valued `labels:`
argument cannot count — the same shape, and the same reason, as the auto-merge policy. One REST call
per known milestone per pass replaces one GraphQL call; the cycle-boundary poll keeps its counts,
because that read runs at every boundary and is the loop's hottest.

### A build is refused while validation is live

409, alongside the build mutex's own refusal. A delivery run merging and promoting while validation
asserts against the deployment would be judging a moving target — the verdict would name criteria true
of neither the old release nor the new one. A validation run deliberately sits outside the build mutex
(it re-judges a version that already shipped, so holding up the next build for its duration would be
wrong), which is why this refusal is an explicit read rather than an index. The way past it is to
cancel the validation, which is one click.

## Consequences

- **Terminal reasons stay honest per species.** `redispatch-budget` on a dev run means the delivery
  agent died; on a validation run it means the judge did, and the version is still delivered. The list
  of reasons is unchanged — the split needed no new failure class.
- **The two verdicts a version can hold are on different rows.** The dev run's verdict column stays
  empty (or `skipped`, when there is no oracle and nothing will ever judge it); the validation run's
  carries the answer. Readers take the newest *validating* run on the milestone.
- **`RunValidates` narrowed rather than disappeared.** It is still the one place "which rows can carry
  a verdict" is written, which is what stops a task run's `skipped` from making a genuinely passed
  version read as unvalidated.
- **A version with no acceptance oracle records `skipped` at delivery.** No validation task is filed,
  so nothing will ever judge it, and an empty verdict would read as "any moment now" forever.
- **In-flight runs do not survive the upgrade.** The workflow type and the id grammar both changed, so
  a run mid-loop across the deploy is neither signalled nor resumed. Same drain-not-migrate posture as
  [ADR-0019](ADR-0019-deploy-order-follows-the-hard-wiring-edges.md), for the same reason:
  `workflow.GetVersion` would mean keeping the fused loop alive for old histories.
- **The platform change and the skill change ship together.** `skills/aep-validation` writes
  `Validates #N`; the dispatch prompt and the validation issue's body say the same thing and say why.
  Shipping either half alone breaks every validation — one way leaves two owners on the task, the other
  leaves the pull request unmergeable.

## Not done, deliberately

**A validation run does not rebase its own pull request.** A conflict on a validation pull request
settles the run under `conflict-budget`; the conflict issue the event plane minted is ordinary work in
the milestone for a task run to pick up, but nothing in this workflow can rebase a branch, so there is
no second attempt to make. Fixing it properly means the conflict recovery chain becoming reachable from
the validation workflow, which is the cycle loop it deliberately does not share.

**Nothing re-judges a version automatically after a repair.** A failed attempt files one bug per failed
criterion and closes the task, so the repair is worked by an ordinary run and the version's verdict
stays at the failure until a human asks again. Reopening the task off a merged `src/validation` fix is
the missing edge, and it belongs to the task run's own bookend.

The mechanism — the file split, the shared `loop`, and the full invariant list — is documented where it
is enforced: [`internal/delivery/README.md`][delivery] (L2) under the README ladder
([ADR-0008][adr8]), and [`internal/delivery/run/doc.go`][rundoc] for the three workflows themselves.

[delivery]: ../../services/aep-api/internal/delivery/README.md
[adr8]: ADR-0008-architecture-in-readme-ladder.md
[rundoc]: ../../services/aep-api/internal/delivery/run/doc.go
