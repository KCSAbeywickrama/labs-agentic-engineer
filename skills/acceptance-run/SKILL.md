---
name: acceptance-run
description: Use when running the acceptance criteria against a live app — drive each Gherkin scenario in specs/acceptance/ with agent-browser and write tests/acceptance/report.json.
metadata:
  aep:
    kind: platform
    audience: [coding]
---

# Run the acceptance criteria

You execute `specs/acceptance/<slug>.feature` against a **running** app. There
are no step definitions and no generated test code: the scenario text is the
test, and you are the runner.

The whole value of this run is that its verdict can be believed. A scenario you
report as passing must have been settled by a command that could have said no.

## Before the first scenario

1. `command -v agent-browser` — if absent, the CLI is not provisioned: say so in
   one line, write no report, and stop. Do not search for it or install it.
2. Take your own session, once:
   `export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix acc)"`
   The default session is shared with every agent on the machine.
3. `agent-browser skills get core` — the CLI serves the guide for the version
   installed. Verbs and flags move between releases; this skill deliberately
   carries none of them beyond the few named below.
4. Read `/tmp/validation-context.json` — the platform writes it before this run
   starts, and it carries `{ "endpoints": [{"component","url"}], … }`. Take the
   base URL from there. **Never probe, scan, or guess an endpoint**, and never
   assume localhost: the app under test is deployed. Confirm it answers before
   the first scenario.

**One browser at a time.** Work the scenarios in sequence, in this agent. A live
Chromium is the largest thing in the cycle's pod, and a second session OOM-kills
the run mid-phase; splitting scenarios across dispatched agents looks like
parallel work and buys an OOM instead. This binds harder here than it did for a
compiled suite — there is a browser open for every scenario, not one per run.

## Isolation — own the container, don't reset

Each scenario starts from the state its `Given` steps describe and nothing else.
The app is deployed and keeps its data: there is no process to restart, no
database to truncate, and anything you delete belongs to somebody.

So isolate by **creating what you assert about**. Where the `Given` names a
container — a round, a board, a list — make a fresh one through the app's own
interface and keep every later step inside it. "The list is empty" is then true
because you just made it, and a count over that list is sound no matter what
else the database holds.

Where the product has no container to own, assert on the **change** instead of
the total: read the count before the `When`, and check it moved by exactly what
the `Then` claims. Weaker, because it assumes nothing else writes while you
work — but the platform runs one validation at a time per version, so that
holds here.

Record which of the two you used, once, at the top of the report as
`isolation`. If a scenario managed neither, say so there: every assertion it
makes is then suspect.

## Step routing

| Keyword | You do |
|---|---|
| `Given` | Establish the state. Acting through the UI is fine; so is a direct API call, which is faster and less brittle for setup. |
| `When` | Perform the one action, through the UI. |
| `Then` | **Assert.** |
| `And` / `But` | Inherit the previous keyword. |

`Then` is the only keyword that decides anything. Everything else exists to
reach it.

## Acting — a command that succeeded is not an action that happened

**`agent-browser click` on a disabled control prints `✓ Done` and exits 0.**
Measured, by role and by ref. The click does nothing and nothing says so. If the
`Then` that follows was already true, the scenario passes without ever
exercising anything — a false pass produced by the tool rather than by
judgement. (Playwright does not behave this way: `locator.click()` waits for
actionability and times out instead.)

So before acting on a control, read it:

```bash
agent-browser snapshot -i        # a control shows [disabled] when it is
```

- **A control the `When` needs that is `[disabled]` or absent means the action
  cannot be performed.** That scenario is `blocked`. Do not click it anyway and
  do not fall through to the `Then`.
- **Otherwise, prefer evidence over the exit code** — assert a state change only
  the action could have produced. `agent-browser network requests` shows whether
  the request actually left the page, which is the cheapest proof for anything
  that writes.

## Asserting — the part that matters

**Every `Then` is settled by one command whose exit code is the verdict**, and
that command and its exit code go in the report. A `Then` with no command
recorded is not a pass; it is `unjudgeable`.

```bash
agent-browser wait --text "already on the list" --timeout 3000   # 0 = present, 1 = not
agent-browser get value @e4                                       # 1 if the element is gone
agent-browser get count ".item"                                   # prints the number
agent-browser get url
```

- **Always pass `--timeout`.** The default is 25 seconds, so an unqualified
  failing assertion costs 25s. A few seconds is plenty against a local app.
- **Re-read after every action.** `@eN` refs belong to the snapshot that made
  them, and a snapshot taken before the click cannot witness its result. On a
  page that has just navigated, believe the second reading, never the first.
- **Absence is weaker than presence.** Nothing can wait for text to stay away,
  so "is not shown" has to be a `get count` of zero or a re-read that does not
  contain it. Prefer a positive assertion whenever the scenario allows one.
- **Assert exactly what the step claims.** An extra assertion turns an unrelated
  change into a false failure; a missing one makes the scenario vacuous.

## Outcomes — one per scenario

| Outcome | Means |
|---|---|
| `passed` | every `Then` was settled affirmatively by a recorded command |
| `failed` | a `Then`'s command said no — the app did not do what the scenario claims |
| `blocked` | a `Given` or `When` could not be carried out — the control was `[disabled]` or absent, or the state could not be reached |
| `unjudgeable` | the `Then` asks about something this app cannot show you |

**A prevented `When` is `blocked` even when the `Then` holds.** If the control
is disabled, the scenario did not exercise the behaviour it claims to — the
assertion would have held without it, so passing it records something that was
never tested. Judge the outcome on whether the action happened, not on whether
the page ended up in the right state. This rule exists because it is the one
place two runs of this skill disagreed with each other.

`failed` and `blocked` are both defects and must not be merged: one says the
behaviour is wrong, the other says you never got to see it. `unjudgeable` is for
truth that lives outside the running app — a number a stubbed backend invents, a
side effect in another system. It is an honest answer and always better than
guessing; never report `passed` because a scenario looked plausible.

## The report

Write `tests/acceptance/report.json`. One entry per scenario in the feature
files — every one, including those you could not run. Stamp `commit` with
`git rev-parse HEAD` so the report says which code it judged.

```json
{
  "schemaVersion": 2,
  "generatedAt": "<ISO>",
  "commit": "<git rev-parse HEAD>",
  "baseUrl": "https://<the deployed host from the validation context>",
  "isolation": "each scenario creates its own list and asserts only on that list",
  "scenarios": [
    {
      "feature": "Adding items to the list",
      "featureFile": "specs/acceptance/shopping-list.feature",
      "line": 24,
      "rule": "An item that duplicates one already on the list is rejected",
      "scenario": "Trying to add an exact duplicate",
      "tags": ["@negative"],
      "outcome": "failed",
      "steps": [
        { "text": "Dan tries to add another item named \"Milk\"", "keyword": "When",
          "command": "agent-browser find role button click --name \"Add\"" },
        { "text": "the list still has exactly one item", "keyword": "Then",
          "command": "agent-browser get count \"[data-testid=item]\"",
          "exit": 0, "observed": "2 — the list holds \"Milk\" and \" milk \"" }
      ]
    }
  ]
}
```

`featureFile` and `line` are where the scenario is written, so a reader — and a
repair issue — can go straight to it.

**`observed` is required wherever the exit code does not settle the step.**

| Case | Why |
|---|---|
| a nonzero exit | the exit says the assertion lost; `observed` says what was there instead, and that is what the repair issue quotes |
| no command at all | a `blocked` step has to record its reason — `the "Edit" button was [disabled]` — or nobody can tell an app that correctly refuses from one that is broken |
| a value-returning command (`get count`, `get value`, `get url`, `get text`) | exit 0 only means the command RAN. You read the printed value and judged; `observed` is that value, and without it the verdict is unauditable — which is the example above |

It is optional on a passing `wait`, where the command text and `exit: 0` already
say what held.

Then check it:

```bash
node "$AEP_SKILLS_DIR/acceptance-run/scripts/check-report.mjs" "$(git rev-parse --show-toplevel)"
```

It exits 2 on a contract breach and prints every one. A scenario in the feature
files with no entry fails it, so one you could not manage must be reported
`blocked` — never dropped. So does a `passed` whose `Then` carries no command
that could have said no, and a step missing the `observed` its exit code does
not supply. Fix the REPORT and run it again; never the feature files.

## Do not

- Do not edit the feature files to match what the app does. They are the
  specification; a mismatch is the finding.
- Do not fix the app. This run reports; repairing is someone else's step.
- Do not report `passed` for a `Then` you did not settle with a command.
