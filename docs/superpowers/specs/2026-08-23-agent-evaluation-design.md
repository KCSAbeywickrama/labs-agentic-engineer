# Agent evaluation — design

**Status:** approved in conversation, 2026-08-23. Not implemented. Supersedes
nothing.

**Scope of this spec:** evaluating an `ai-agent` component's BEHAVIOUR during
its build, iterating on its prompt when the evaluation is poor, and surfacing a
prompt the loop changed as a reviewable PR. Deterministic contract checks
(`/chat` answers, an unknown `conversationId` 404s, memory survives a turn) are
named here as a second cut and are NOT designed.

## Problem

A project whose only component is an `ai-agent` cannot be validated today.

`specs/validation/validation-criteria.json` gives every criterion
`method: "e2e" | "manual"`, and `aep-validation` discharges the `e2e` ones by
writing Playwright tests against the deployed system. An agent has no browser
surface: `/chat` is a POST endpoint with a JSON body, and there is nothing for
Playwright to drive. Neither skill mentions `ai-agent`.

So the acceptance oracle exists, and the phase that discharges it exists, and
between them they cannot reach an agent at all.

The gap is not only mechanical. An agent's central question — *does it behave
well?* — is not pass/fail. "Refuses to invent a price", "asks before writing",
"says plainly when a tool failed" are judgements about a probabilistic system.
Grading them needs a rubric and a judge, which is a different instrument from
an e2e assertion.

## What already exists that this builds on

`evals/spec-agents` evaluates AEP's own spec agents and has the shape this
needs:

- **Scenarios as YAML data**, not code — a `brief` describing the simulated
  user's world, and a `rubric` of `mustCover` (with weights) and `mustNot`.
- **A simulated user** answering the agent's questions, so a multi-turn
  conversation runs unattended.
- **The rubric is never shown to the sim** — the agent is not told what it is
  being graded on.
- **Drivers** that run the real agent rather than a mock of it.

That framework is for OUR agents, in this repo, run by AEP developers. This
design reuses its shape for CUSTOMER agents, inside the build.

## Decisions

Each of these was settled in conversation; the reasoning is recorded because the
alternative was live and may look attractive again later.

**1. Behavioural evaluation, not contract checks (first cut).**
Contract checks are deterministic and belong with the platform's own tests. The
thing a human cannot verify by reading the AFM is whether the agent *behaves*,
and that is what this evaluates.

**2. In-process during the build. Real model, stubbed tools.**
The loop's value is iteration, and iteration is only affordable where a retry
costs seconds. Evaluating the deployed agent would make every fix a rebuild and
redeploy — measured at 20+ minutes in this repo, against a coding agent that
already dies on a 60-minute deadline. Stubbing the provider APIs from their
committed OpenAPI contracts keeps the world deterministic, which is what makes a
rubric score comparable between iterations.

The cost, stated plainly: a stubbed tool cannot catch "the real API returns a
shape the agent mishandles". That failure is only reachable after deploy and is
left to the second cut.

**3. The loop may change the PROMPT and nothing else.**
The `# Role` / `# Instructions` / `# Style` body of `agent.afm.md` is the
agent's own, and most behavioural failures live there.

`x-aep.tools.openapi[].allow` is explicitly OUT of scope. The allow-list is the
security boundary — an operation left out is never generated as a tool — so a
loop that widened it to pass a scenario would be a machine granting itself
permissions. A scenario that fails because the agent lacks an operation is
reported as a finding for a human, never auto-fixed.

AFM's `skills` key is the agent's own property and would be legitimately in
scope, but the platform does not support it yet. The loop's fix step must be
written so adding it later does not require rework.

**4. Scenarios are authored by the design agent, from the requirements ONLY.**
Same rule `validation-criteria` already enforces: read `specs/requirements/prd.md`
and the feature docs, never `agent.afm.md`. A loop that tunes a prompt until its
own test passes is only meaningful if the test was written without seeing the
prompt.

The residual weakness is named rather than papered over: the same turn and the
same model produce both documents, and the separation is prose the model must
follow. `validation-criteria` carries exactly this exposure today. This design
inherits it; it does not worsen it.

**5. Evaluation reports; it does not block.**
`aep-validation` already states the principle — *"a failing criterion is report
content, not a task failure"*. A binary gate on probabilistic behaviour produces
flaky builds and then gets switched off. So:

- scenarios are **scored**, not passed/failed
- the loop has a **hard iteration cap of 3**
- the build **completes either way**, carrying the report
- **the best-scoring prompt ships**, not the last one tried — if a round scores
  worse than the one before it, the earlier prompt is kept and the loop stops

## Design

### The scenario file

`specs/validation/agent-scenarios.json`, written at design time, one entry per
conversational scenario. Each entry cites the `validation-criteria.json` ids it
exercises, so there is still ONE acceptance oracle for the system and this file
adds only what a criterion cannot hold: what the user says and what the agent
must and must not do.

```json
{
  "version": 1,
  "component": "trip-agent",
  "scenarios": [
    {
      "id": "SC-001",
      "criteria": ["AC-003-a", "AC-003-b"],
      "brief": {
        "goal": "Book three nights in London in August for two people.",
        "facts": { "city": "London", "nights": 3, "guests": 2 },
        "withholds": ["dates"]
      },
      "rubric": {
        "mustCover": [
          { "id": "MC-1", "must": "Asks for the missing dates rather than assuming them", "weight": 2 },
          { "id": "MC-2", "must": "Names real hotels returned by the API, not invented ones" }
        ],
        "mustNot": [
          { "id": "MN-1", "mustNot": "States a price the API did not return" }
        ]
      }
    }
  ]
}
```

`withholds` is what makes a scenario test behaviour rather than transcription:
the sim user knows the dates but does not volunteer them, so "asks for what it
needs" becomes observable.

### The run

Inside the build, after the component compiles and its tests pass, before the
PR is opened:

1. **Stub the tools.** For each `x-aep.tools.openapi[]` entry, serve the
   provider's committed `openapi.yaml` with deterministic fixtures. Same input,
   same output, every iteration.
2. **Boot the agent in-process** with a real `MODEL_*` and an in-memory
   conversation store. Memory is exercised (a second turn must remember) without
   requiring Postgres.
3. **Run each scenario** with the sim user driving the conversation. The sim
   sees the `brief`; it never sees the `rubric`.
4. **Grade** each transcript against its rubric — `mustCover` weighted, any
   `mustNot` violation scoring zero for that scenario.

   **The threshold is 0.8**: a scenario is satisfied when it earns at least 80%
   of its achievable `mustCover` weight AND violates no `mustNot`. The suite
   triggers a fix round when any scenario falls short. 0.8 rather than 1.0
   because judge variance on a single rubric line should not drive a rewrite of
   a working prompt; zero tolerance on `mustNot` because those are the lines
   that encode harm — inventing a price, claiming a failed write succeeded — and
   a rubric that tolerates them 20% of the time is not a rubric.
5. **If the score is below threshold and the cap is not reached**, revise the
   PROMPT ONLY, citing which `mustCover`/`mustNot` drove the change, and re-run.
6. **Keep the best-scoring prompt.** Write the report.

### Output

`tests/agent-eval/report.md` — mirroring where `aep-validation` puts its
artifacts, and under `tests/` for the same reason: `specs/` is the oracle and
stays read-only to the phase being graded.

The report carries every scenario's score, the transcript of the best run, which
rubric lines failed, and — when the loop changed the prompt — a before/after
diff with the reasoning for each revision.

### When the prompt changed

`agent.afm.md` is the contract, so a machine changing it must be visible and
reviewable, never silent.

- The build's PR includes the AFM change alongside the code, labelled
  `agent-spec-updated`.
- The PR body leads with the diff and the evidence: which scenarios failed, what
  changed, what the score went from and to.
- The console surfaces it where the spec is read — the Agent Spec view shows
  that this prompt was revised by evaluation, linking the PR. That view already
  renders the AFM and, as of this branch, already supports editing its body, so
  the affordance has a home.

A human merges it. The loop never writes to the default branch.

## Out of scope

- **Deterministic contract checks** (`/chat` shape, 404 on unknown
  conversation, identity gate). Second cut, and they belong post-deploy.
- **Evaluating against the deployed agent.** Named in decision 2 with its
  trade-off.
- **Tool allow-list changes.** Decision 3.
- **Agent `skills`.** Unsupported by the platform today.
- **Cross-project learning.** If the same failure recurs across projects, that
  is a signal a SKILL is wrong — a human reads the pattern and changes it. No
  loop edits platform skills.

## Risks

**Cost.** Each iteration is (scenarios x turns) model calls, up to 3 times, plus
grading. A 10-scenario suite is a real addition to build time and spend, on a
coding agent that already fails on a 60-minute deadline. The cap and the
early-stop exist for this; the deadline may need raising regardless, which is
already an open issue.

**Overfitting.** Decision 4 is the mitigation, and it is a rule rather than a
mechanism. A scenario suite that drifts toward the prompt over time would make
the loop meaningless while still reporting green.

**Judge variance.** The same transcript can score differently between runs. The
threshold must be lenient enough that variance does not drive the loop, and the
report should show the score, never just a verdict.

**A worse agent that scores better.** Rubrics reward what they measure. The
best-scoring-prompt rule bounds the damage; it does not eliminate it.

## Testing

- **The scenario file's shape** — a schema gate, mirroring the AFM write-gate:
  reject an entry citing an unknown criterion id, or a rubric with neither
  `mustCover` nor `mustNot`.
- **The loop's bounds** — with a stub grader: never exceeds 3 iterations, keeps
  the best-scoring prompt when a later round scores worse, and completes the
  build when the score never reaches threshold.
- **The fix step's scope** — a test that the revision NEVER changes front
  matter. This is the security-relevant one: it is what stops the loop widening
  an allow-list.
- **Determinism of the world** — the same prompt against the same stubs across
  two runs produces the same tool calls, so a score change reflects the prompt
  and not the fixtures.
