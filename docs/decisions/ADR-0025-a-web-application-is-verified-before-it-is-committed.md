# ADR-0025 — A web application is verified before it is committed

**Status:** Accepted · **Related:**
[ADR-0012](ADR-0012-one-debian-runner-image-for-both-task-kinds.md) (one image
serves both task kinds — this adds a browser driver to it),
[ADR-0014](ADR-0014-skill-audience-is-metadata-visible-not-loadable.md)
(skill audience — why a new coding-audience skill needs no runner change),
[ADR-0020](ADR-0020-a-run-species-is-a-workflow.md) (a run species is a
workflow — validation is the other species, and stays one)

## Context

A coding run finishes a `web-application` when the component compiles,
type-checks and bundles. Those three gates say the code is well-formed. They say
nothing about what the screens do, and the defects they miss are the ones a user
meets first: a page that renders the wrong content, a navigation arrow the
wireframe draws and the router never registered, a button wired to nothing, a
form that accepts input and discards it.

Everything downstream of the run assumed those defects would be found later.
`aep-validation` does find them — it drives the **deployed** system against the
validation criteria — but by then the build's pull request has merged. A defect
it reports becomes a `bug` issue, a second cycle, a second pull request and a
second deploy. The feedback loop for "this screen does not work" ran through the
whole platform when the person best placed to fix it — the agent that had just
written the file — had finished and gone.

The obstacle was never intent. It was that a coding run has no running system:
no cluster, no sibling service, no identity provider. `references/component-
contract.md` says so directly, and it is right to — a build that starts talking
to infrastructure stops being a build.

## Decision

**A `web-application` is opened in a real browser and used before its work is
committed**, against a mock backend on the runner itself. Four parts:

**1. Mock mode is a dev-only mode of the app, authored by the builder.** MSW
intercepts `/api` in the browser (the pattern `apps/console` already uses), and a
small Vite plugin does the two things a request interceptor cannot: serve
`/env-config.js` before the bundle runs, and substitute `src/auth.ts` with a mock
that resolves a user without an IDP. `skills/react-webapp` owns the procedure and
carries the verbatim assets. Production is untouched and provably so — the
skill's Verify step greps `dist/` for `mock/` and `msw` and fails on a hit.

**`mockEnv` mirrors what the platform actually emits**, not what the app's
`src/env.ts` declares. That inversion is what makes mock mode a *detector*
rather than a stage set: an app that reads a sibling's address out of
`window._env_` dies here for exactly the reason it dies in a pod. Both fixtures
this was built against carried that defect, and mock mode reproduced it before a
cluster ever saw them.

**2. The agent that built the app is the agent that walks it.** Its whole
procedure is `skills/mock-verification`; it drives the page through
`agent-browser`. It reports one verdict per story, and the third verdict is not
a hedge: `[~]` marks a story whose truth lives outside the app — a total the real
service computes, a permission the gateway enforces. Marking those honestly is
what keeps the other two verdicts worth reading.

The walk is therefore not a review of the build but the **last step of it**:
`references/component-contract.md` defines a `web-application` as green when it
builds **and** walks, and `react-webapp`'s Development flow numbers the walk as
a step like any other. A builder holds the whole component open, so a fix is
better targeted and far cheaper than one briefed to a separate agent through
pasted verdicts.

**3. Its scope is the component, not the issue.** The boundary comes from
`wireframes.dsl` and the product requirements — documents that sit on disk
whatever the issue set says — with the current issue for emphasis. Scoping a
verifier to the issue being worked asks it to confirm the new behaviour and
nothing else, which is the one shape that cannot see a regression; and a
regression is what a cycle produces, through a shared navigation bar, a layout,
a regenerated client, a page edited for an unrelated reason. This was settled by
experiment: two wordings that scoped the walk through the *issues* both failed,
because the lead derives its working set from issues that are **not done** and so
never reads the issue an earlier cycle closed. A scope the lead cannot name is
not a scope.

**4. Coverage is protected by a phase, not by a second agent.** One agent that
both walks and fixes has one failure mode: it repairs the defect on screen two
and never opens screens five through nine. So the checklist is written **before
the browser opens** — from `wireframes.dsl` and the requirements — and the walk
completes before any file is edited, with one carve-out for a defect that blocks
the walk. Then a single fix pass, then a re-walk of what was fixed: a screen is
cleared by clicking it again, never by the edit compiling. Three walk-and-fix
passes at most, stopping early on a clean walk or on a pass that ends with the
failures it started with.

Because all of this happens **before** the commit, what a reviewer receives is
one pull request carrying the build *and* the fixes.

## The platform does not orchestrate this

There is no new API, no workflow activity, no database table, no status
callback. The loop lives entirely inside the coding session, driven by
`skills/aep`, and reaches the platform only as the resulting commits and pull
request. The mirror already hands an implementation run every coding-audience
skill, so a new skill needs no runner code change.

Two platform changes were needed, and only two:

- **The runner image gains `agent-browser`** (`runners/remote-worker/Dockerfile`),
  pointed at the Chromium ADR-0012 already bakes for Playwright via
  `AGENT_BROWSER_EXECUTABLE_PATH`. No third browser is downloaded.
- **The coding job's deadline names three hours** (`codingDeadlineSeconds`),
  with the OpenChoreo ComponentType schema ceiling raised to match. The coding
  path previously sent no deadline at all and inherited the schema default, so
  `EnsureComponentType` had to learn to converge a stale ComponentType rather
  than return early on a 409.

## Alternatives rejected

- **Verify after deployment and let `aep-validation` own it.** That is the status
  quo, and it is still right for what it judges — a deployed system against live
  infrastructure is a different question with a different answer. What it cannot
  do is put the fix in the same pull request as the defect.
- **A read-only verifier subagent plus a separate fixer subagent.** Shipped
  first, then merged. The separation it bought was mostly nominal — a finding
  was already re-judged by the *next* round's walk, which the merged shape keeps
  — while the costs were real: two extra dispatches per round, verdicts
  hand-copied into a prompt, and a fixer that had to re-derive the cause a
  verifier was forbidden to diagnose.
- **Have the platform run the rounds** as workflow activities, for visibility in
  the run history. It would need the runner to report per-round state to an API
  that does not exist, to serve a loop whose whole cost is already inside one
  session. The tool calls reach the progress feed as they are.
- **A hand-rolled Vite middleware** instead of MSW. Written first, then deleted:
  it reimplemented matching and body parsing that MSW already does, in a repo
  that already runs MSW.
- **Generated Playwright specs** instead of an agent driving the page. A spec
  encodes what its author expected; the whole point here is to find what nobody
  expected. Specs are also a second artifact to maintain against screens that
  are still moving.

## Consequences

- A web-app subagent runs longer than a service one — a build, then up to three
  walk-and-fix passes driving a browser. This is the reason for the three-hour
  deadline. It is one dispatch, not the four to seven the two-agent shape cost.
- Nothing outside the walker's own skill describes the loop. The lead's part is
  two lines: name `mock-verification` and `agent-browser` in a web-app
  subagent's prompt, and carry any still-open `[ ]` line into the run's record.
- The mock harness is committed with the app. It is dev-only, absent from
  `dist/`, and it doubles as the fixture a human can run locally with
  `npm run dev:mock`.
- A `[~]` verdict is a deliberate hand-off: stories whose truth lives outside the
  app remain `aep-validation`'s to judge, and the verdict names them so nobody
  assumes they were covered here.
- A defect the rounds could not clear does not block the cycle. It is carried
  into the run's record naming the screen and what happens on it.
