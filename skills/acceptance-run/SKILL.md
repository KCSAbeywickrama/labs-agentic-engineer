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
4. Confirm the app answers at its base URL, and note how to **reset it to empty**
   (see Isolation).

## Isolation — reset, then build

Each scenario starts from the state its `Given` steps describe and nothing else.
Do not let one scenario's leftovers stand in for another's setup.

Reset by the cheapest total means the app allows — restarting a service whose
store is in memory, a seed endpoint, a fresh context — then build the `Given`
state through the app's own interface. Record which reset you used once, at the
top of the report; if the app offers none, say so, because every later scenario
is then suspect.

## Step routing

| Keyword | You do |
|---|---|
| `Given` | Establish the state. Acting through the UI is fine; so is a direct API call, which is faster and less brittle for setup. |
| `When` | Perform the one action, through the UI. |
| `Then` | **Assert.** |
| `And` / `But` | Inherit the previous keyword. |

`Then` is the only keyword that decides anything. Everything else exists to
reach it.

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
| `blocked` | a `Given` or `When` could not be carried out, so no `Then` was ever reached |
| `unjudgeable` | the `Then` asks about something this app cannot show you |

`failed` and `blocked` are both defects and must not be merged: one says the
behaviour is wrong, the other says you never got to see it. `unjudgeable` is for
truth that lives outside the running app — a number a stubbed backend invents, a
side effect in another system. It is an honest answer and always better than
guessing; never report `passed` because a scenario looked plausible.

## The report

Write `tests/acceptance/report.json`. One entry per scenario in the feature
files — every one, including those you could not run.

```json
{
  "schemaVersion": 1,
  "generatedAt": "<ISO>",
  "baseUrl": "http://localhost:5173",
  "reset": "restart the API process (in-memory store)",
  "scenarios": [
    {
      "feature": "Adding items to the list",
      "rule": "An item that duplicates one already on the list is rejected",
      "scenario": "Trying to add an exact duplicate",
      "tags": ["@negative"],
      "outcome": "passed",
      "steps": [
        { "text": "Dan tries to add another item named \"Milk\"", "keyword": "When",
          "command": "agent-browser find role button click --name \"Add\"" },
        { "text": "he is told \"Milk\" is already on the list", "keyword": "Then",
          "command": "agent-browser wait --text \"already on the list\" --timeout 3000",
          "exit": 0 }
      ]
    }
  ]
}
```

Then run the report checker named in the run's instructions. It fails the run if
a scenario in the feature files has no entry, so a scenario you could not manage
must be reported `blocked` — never dropped.

## Do not

- Do not edit the feature files to match what the app does. They are the
  specification; a mismatch is the finding.
- Do not fix the app. This run reports; repairing is someone else's step.
- Do not report `passed` for a `Then` you did not settle with a command.
