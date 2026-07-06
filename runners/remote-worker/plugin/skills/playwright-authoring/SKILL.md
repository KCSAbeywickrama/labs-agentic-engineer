---
name: playwright-authoring
description: Load when authoring Playwright e2e specs for an AEP validation task (invoked from the aep-validation skill's PLAN/GENERATE steps). Discipline for exploring the live app with playwright-cli, writing the test plan, and turning acceptance criteria into deterministic @playwright/test specs — UI criteria via the browser, API criteria via the request fixture.
---

# Authoring validation specs

One rule above all: **explore first, author second**. Never write a
spec for a flow you have not successfully driven against the live app.
Specs written from imagination encode guesses about selectors and
behavior; specs written from exploration encode observations.

## Exploring with playwright-cli

`playwright-cli` drives a real browser from the shell. Typical loop:

```bash
playwright-cli open <url>        # start a session on the target
playwright-cli snapshot          # accessibility snapshot: elements + refs (e.g. e21)
playwright-cli fill <ref> "Ada"  # act on elements by ref
playwright-cli click <ref>
playwright-cli snapshot          # observe the result state
playwright-cli close             # end the session when done
```

Run `playwright-cli --help` (and `playwright-cli <command> --help`) for
the full command list — trust the tool's own help over memory. Notes:

- Snapshots are the ground truth for locators: the roles/names you see
  there are what `getByRole` will match.
- Close sessions when finished with a target; never commit session
  state, downloaded screenshots, or exploration artifacts.
- If a flow fails **in the live app itself** during exploration, that
  is a genuine finding, not a blocker: still author the spec so it
  fails honestly, and note the observation in the test plan.

## The test plan (PLAN)

Write `specs/validation/test-plan.md` before any spec. One section per
criterion:

```markdown
## AC-001-a — A text box for entering a name is visible

- Target: hello-web (primary)
- Steps:
  1. Navigate to /
  2. Locate the name text box (role: textbox, name: "Name")
- Assert: the text box is visible
- Observed in exploration: yes (snapshot shows textbox ref e12)
```

The plan is a reviewable artifact — a human should be able to check
your interpretation of each criterion before reading any code.

## Writing specs (GENERATE)

One criterion per file; the title prefix is the report's join key:

```ts
// tests/e2e/specs/AC-001-a.spec.ts
import { test, expect } from "@playwright/test";

test("AC-001-a: a name text box is visible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Name" })).toBeVisible();
});
```

### UI discipline

- **Locators:** `getByRole` / `getByLabel` / `getByPlaceholder` /
  `getByText` — in that order of preference. CSS/XPath selectors only
  when no accessible locator exists (and say why in a comment).
- **Assertions:** web-first (`await expect(locator).toBeVisible()`,
  `.toHaveText()`, `.toHaveValue()` …) — they retry until timeout.
  Never `page.waitForTimeout(...)`; never assert on raw
  `page.content()` when a locator assertion exists.
- **Assert what the criterion claims — no more.** The `must` sentence
  is the contract. Extra assertions turn unrelated changes into false
  failures; missing assertions make the test vacuous.
- **Independence:** each spec must pass when run alone
  (`npx playwright test specs/AC-001-a.spec.ts`). No ordering
  dependencies, no state left behind for the next spec.
- **Unique test data:** the deployed environment persists between runs.
  Suffix created entities with a run marker
  (`` const name = `ada-${Date.now()}` ``) so re-runs don't collide
  with earlier data.

### API criteria (request fixture)

No browser needed — use the built-in `request` fixture against the
component's URL from the targets helper:

```ts
// tests/e2e/specs/AC-003-a.spec.ts
import { test, expect } from "@playwright/test";
import { target } from "../lib/targets";

test("AC-003-a: API returns Hello, <name>!", async ({ request }) => {
  const res = await request.post(`${target("hello-api")}/api/hello`, {
    data: { name: "Ada" },
  });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ message: "Hello, Ada!" });
});
```

Verify the exact route/payload from the component's committed contract
(`specs/design/components/<name>/openapi.yaml`) and confirm it live
(`curl` or `request` exploration) before authoring.

### Authenticated apps

If the app requires login, use a Playwright **setup project** that logs
in once and saves `storageState` for the other specs, with credentials
from the environment only:

```ts
const user = process.env.AEP_E2E_USERNAME;
const pass = process.env.AEP_E2E_PASSWORD;
```

Never hardcode credentials in specs or commit a `storageState` file
(`.gitignore` it). If credentials are required but the env vars are
absent, don't fake a login: author the specs, let them land as
`not_run`/failing, and flag the blocker per the aep-validation skill.

## Definition of done

A spec is done when it passes **twice consecutively** against the live
app. A spec that alternates pass/fail is brittle — fix it now (see
`playwright-healing` for the brittleness taxonomy) rather than shipping
a flake into the regression set.
