# ADR-0007 — The runner image names playwright-cli's browser

**Status:** Accepted

A validation run explores the deployed app with `playwright-cli` before authoring
specs, and the `aep-validation` skill instructs the bare `playwright-cli open
<url>`. That could not work in this image. Playwright separates the *engine*
(`browserName` — chromium/firefox/webkit, its own builds under
`PLAYWRIGHT_BROWSERS_PATH`) from the *build* of that engine (`channel` — unset
for Playwright's own, `chrome`/`msedge` for the vendor's, found at a system
path), and playwright-cli defaults to the **pair** (`chromium`, channel
`chrome`), both set in one branch. So its default engine cannot be had without
Google's branded build at `/opt/google/chrome/chrome`, which this image does not
carry: Chrome is a vendor install rather than a Playwright download, and the
Dockerfile's `playwright install --with-deps chromium` bakes only Playwright's
own chromium. The daemon died at launch and surfaced nothing but `Daemon process
exited with code 1`, so every validation run spent turns rediscovering it (#570).

Channel `chrome` also leaves `chromiumSandbox` enabled, and the sandbox cannot
start as the non-root `aep` user the pod runs as — so installing Chrome would
have moved the failure one layer deeper rather than fixing it.

## Decision

**The image names the browser type: `PLAYWRIGHT_MCP_BROWSER=chromium`.**
`resolveBrowserParam` maps `chromium` onto channel `chrome-for-testing`, the
alias for the baked build, which corrects the distribution *and* takes the
sandbox branch that works unprivileged — both blockers, one value.

- **An ENV, not a flag or a config file.** `runner.ts` already spreads
  `process.env` into the agent's child env, so an image ENV reaches every agent
  shell with no plumbing, and the skill's existing instruction becomes correct as
  written rather than growing guidance that can drift out of step with the image.
  An explicit `--browser=` still wins, so this is a default, not a lid.
- **Chromium, not Chrome.** The generated specs already run on it
  (`playwright.config.template.ts` sets no `browserName`, so `playwright test`
  takes Playwright's default), the pinned `AEP_PLAYWRIGHT_VERSION` ships only
  chromium, and exploration must use the build the assertions will execute
  against. Chrome would additionally need root plus Google's apt repo,
  auto-version independently of the "pinned as a pair" contract, and — as a
  proprietary browser in an image the platform redistributes — raise a licensing
  question that needs legal review rather than a Dockerfile edit.
- **Not a `.playwright/cli.config.json`.** Setting `browser.browserName` there
  leaves `channel` undefined, which re-enables the sandbox and still fails.
  Recorded because it is the obvious-looking simplification of this ADR.

## Consequences

- Exploration and the test run can no longer diverge on browser build: both
  resolve to `/ms-playwright/chromium-<rev>/chrome-linux/chrome`.
  `@playwright/test` is untouched — it never forces a channel and does not read
  this variable.
- Explicit overrides still fail, and now fail honestly. `--browser=chrome`/
  `msedge` are absent by this decision; `--browser=firefox`/`webkit` are absent
  because `playwright-cli install-browser` is given `chromium` explicitly. With
  no argument it also fetched firefox and webkit — ~546MB the chromium-only
  `--with-deps` line never gave system libraries, so they were downloadable but
  unlaunchable.
- CI has no Docker step and never builds `aep-runner:dev`, so a
  `PLAYWRIGHT_CLI_VERSION` bump has to be re-checked by hand: `playwright-cli
  open <url>` in the built image should print ``Browser `default` opened with pid
  …``.

Related: ADR-0006 pins endpoint *resolution* for curl and leaves the browser to
`playwright.config.template.ts`; this ADR is about which binary launches, and the
two compose. #570 carries the diagnosis and the code references; PR #571 carries
the before/after evidence.
