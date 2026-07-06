---
name: playwright-healing
description: Load when e2e specs fail during an AEP validation run (invoked from the aep-validation skill's HEAL step). Discipline for triaging Playwright failures against the live app, repairing only brittleness (locators, waits, setup) within a bounded budget, and never healing a genuine failure into green.
---

# Healing validation specs

**The rule, before anything else:** a heal may change *how the test
drives the app* — never *what the test claims the app does*. If a fix
would touch an expected value, a status code, or an assertion, it is
not a heal. The criterion fails, and that failure goes into the report
verbatim. A validation suite that heals genuine failures is worthless;
a red criterion is the phase working as designed.

## Triage: brittle or genuine?

For every failure, re-drive the exact steps with playwright-cli against
the live app before touching the spec:

- App behaves correctly live, but the spec fails → **brittle** (the
  test is wrong about *how* to drive/observe the app). Heal it.
- App itself misbehaves — wrong text, error page, 500, missing
  element the criterion requires → **genuine**. Do not touch the spec.

| Classification | Signature | Verdict |
|---|---|---|
| Locator drift | `locator not found`, strict-mode violation, timeout on a locator whose element IS in the live snapshot under a different role/name | brittle — heal |
| Timing | passes on manual re-drive; failure is a navigation/race (missing web-first assertion, asserting before a request settles) | brittle — heal |
| Data collision | failure mentions duplicate/existing entities from a previous run | brittle — heal (make test data unique) |
| Setup/session | expired or missing `storageState`, login step broke while the app's login works live | brittle — heal |
| Assertion mismatch | element/response found, but value differs from what the criterion expects | **genuine — report** |
| App error | 4xx/5xx, error page, crash, endpoint absent | **genuine — report** |

When unsure after re-driving: treat as genuine. A false red gets
caught by the human reviewer; a false green silently corrupts the
validation phase.

## Budget

- Max **2 heal attempts per criterion**; each followed by a focused
  re-run: `npx playwright test specs/<AC-ID>.spec.ts`.
- Max **2 focused re-run waves** after the initial full run.
- Then **one final full run** (`npx playwright test`) so
  `test-results/results.json` — the input to the report — reflects the
  authoritative end state.
- Still failing after the budget: leave it failing. In the plan/PR
  notes, mark it `genuine` or `unresolved (possibly brittle)`.

## Record every heal

One commit per heal, and one entry appended to
`tests/e2e/heal-log.json` (an array; create it if absent — it is
gitignored, per-run, and folded into the report by
`generate-report.mjs`):

```bash
git commit -m "heal(AC-001-b): locator drift: button renamed 'Say Hello' -> 'Greet'"
```

```json
{
  "criterionId": "AC-001-b",
  "spec": "specs/AC-001-b.spec.ts",
  "classification": "locator drift",
  "change": "getByRole('button', { name: 'Say Hello' }) -> { name: 'Greet' }",
  "commit": "<sha of the heal commit>"
}
```

## Forbidden moves

Never, under any classification:

- Edit an `expect(...)` expected value to match observed behavior.
- Delete or comment out an assertion.
- Convert `expect` to `expect.soft`.
- Add `.skip`, `.fixme`, or conditional early-returns around failures.
- Wrap assertions in `try/catch`.
- Add retries in the config (retries stay 0 — they mask brittleness).
- Raise a timeout to "fix" a hang: >15s expect timeouts need the app to
  be genuinely slow, and that observation belongs in the report, not
  buried in config.
