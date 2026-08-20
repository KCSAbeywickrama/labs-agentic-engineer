# ADR-0007 — The runner image names playwright-cli's browser

**Status:** Accepted

## Context

A validation run explores the deployed app with `playwright-cli` before it
authors anything, then runs the specs it wrote with `npx playwright test`. The
`aep-validation` skill instructs the bare form —
`playwright-cli open <url>` (`references/authoring.md:37`).

In the runner image that command could not work. The p26-bare-minimum-hello run
of 2026-08-18 hit it as its first browser action and got:

```
Error: Daemon pid=296: Daemon process exited with code 1
```

That is a wrapper: playwright-cli launches the browser in a detached daemon and
surfaces only its exit code, never its stderr. Reproduced against
`aep-runner:dev`, the daemon's actual error is:

```
PlaywrightError: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome
```

**Playwright separates the engine from the build of it.** `browserName` picks
the engine (`chromium`, `firefox`, `webkit` — Playwright's own downloads under
`PLAYWRIGHT_BROWSERS_PATH`); `channel` picks *which build* of that engine
(unset = Playwright's own; `chrome`/`msedge` = the vendor's, at a system path).
The error names both: engine chromium, distribution `chrome`.

**playwright-cli's default is the pair, not the engine.** In the playwright-core
vendored by `@playwright/cli@0.1.15` (`coreBundle.js:71050-71056`):

```js
let browserName = browser.browserName;
if (!browserName) {
  browserName = "chromium";                    // engine
  if (browser.launchOptions.channel === void 0)
    browser.launchOptions.channel = "chrome";  // …and the branded build of it
}
```

Both assignments live in one `if (!browserName)` branch, so the default engine
cannot be had without the `chrome` distribution. That distribution is a **vendor
install**, not a Playwright download — `playwright install --dry-run chrome`
reports `Install location: <system>` and prints no download URL — and
`Dockerfile:98` bakes only Playwright's chromium. It was never going to be there.

**A second blocker sits behind the first.** Channel `chrome` also leaves the
sandbox on (`:71057-71059`):

```js
browser.launchOptions.chromiumSandbox =
  channel !== "chromium" && channel !== "chrome-for-testing";
```

The Chromium sandbox cannot start as the unprivileged `aep` user the pod runs
as. So installing Chrome would not have fixed this; it would have moved the
failure one layer deeper, with a less legible message.

`npx playwright test` was unaffected throughout — `@playwright/test` never forces
a channel — which is why the same pod that failed at seq 52 passed its test runs
at seq 102-105. The agent recovered by reading the CLI's own source
(`program.js`, `session.js`) and retrying with `--browser=chromium`, at a cost of
roughly two minutes of a six-minute run. Every validation run paid this, and paid
it differently.

## Decision

**1. The image names the browser type, as an ENV.**
`PLAYWRIGHT_MCP_BROWSER=chromium` in `Dockerfile`, beside the version pins.
`resolveBrowserParam` maps `chromium` → `{browserName: "chromium", channel:
"chrome-for-testing"}` (`:71101-71102`), and `chrome-for-testing` is the alias
for the baked build (`chromiumAliases`, `:28590`) — so one value corrects the
distribution *and* takes the non-root-safe sandbox branch.

An ENV rather than a flag or a config file, because:

- `runner.ts:342` spreads `process.env` into the agent's child env, so an image
  ENV reaches every agent shell with no plumbing and no entrypoint change.
- It is a documented public knob — the package README's env table and
  `configFromEnv` (`:71201`) — not an internal detail read off the source.
- It is a **default, not a lid**: an explicit `--browser=` still wins, so an
  agent with a reason to choose otherwise keeps that ability.
- It makes the skill's existing instruction correct **as written**, so no
  documentation has to change and none can drift out of step with the image.

**2. Chromium, not Chrome.** Three independent reasons, any one sufficient:

- *The tests already run on it.* `playwright.config.template.ts` sets no
  `browserName` and no `projects`, so `npx playwright test` uses Playwright's
  default, chromium. Exploration must use the same engine and build the
  assertions will execute against, or the agent validates behaviour it never
  observed.
- *The pinned version only has it.* `playwright install --list` shows Playwright
  1.61.1 (`@playwright/test`, i.e. `AEP_PLAYWRIGHT_VERSION` — the contract the
  skill pins `tests/e2e/package.json` to) carrying only `chromium-1228` and its
  headless shell.
- *Chrome cannot be used, only added.* Root plus Google's apt repo, a few hundred
  megabytes, and a browser that auto-versions independently of
  `AEP_PLAYWRIGHT_VERSION` — which breaks the "pinned as a pair" contract stated
  at `Dockerfile:90-92`.

There is also a licensing question, and this ADR deliberately does not answer it.
Chromium is open source; Chrome and Edge are proprietary, and the runner image is
**redistributed** into customer clusters, so baking one in is redistribution
rather than a local download. That needs legal review before anyone does it, not
a Dockerfile decision. Staying on chromium avoids the question entirely.

**3. Not a `.playwright/cli.config.json`.** The obvious-looking simplification —
a config file setting `browser.browserName: "chromium"` — **still fails**. Naming
the type there leaves `channel` undefined, and the expression at `:71057-71059`
then evaluates true and re-enables the sandbox. Verified: that config dies, and
adding `launchOptions.chromiumSandbox: false` to it launches. Recorded here so
the ENV is not later "tidied" into a config file that reintroduces the failure.

**4. No skill change.** The bare command in `references/authoring.md:37` becomes
correct by construction. Adding a "do not override the browser" line would
document a trap the image no longer has.

## Consequences

- `playwright-cli open <url>` works as the skill instructs, on the same build the
  specs execute on. No image growth, no new dependency, no new license surface.
- The exploration session and the test run can no longer diverge on browser
  build: both resolve to `/ms-playwright/chromium-<rev>/chrome-linux/chrome`.
- **Explicit overrides still fail, by design and by omission.**
  `--browser=chrome` and `--browser=msedge` fail — absent, per this decision.
  `--browser=firefox` and `--browser=webkit` also fail, for an unrelated reason:
  `playwright-cli install-browser` (`Dockerfile:102`) downloads those binaries
  but `Dockerfile:98` installs system dependencies for chromium only, so they
  report *"Host system is missing dependencies to run browsers"*. The image
  therefore carries browser bytes it cannot launch. Left as-is here; removing
  them is a separate change.
- The upstream `--browser` help string and env-table both read *"possible values:
  chrome, firefox, webkit, msedge"*, omitting `chromium`, while the README's
  config schema documents `browserName?: 'chromium' | 'firefox' | 'webkit'`.
  Upstream's own vocabulary is inconsistent; the value we set is the one its
  config schema and its code (`case "chromium"`) both support.

## Relationship to ADR-0006

ADR-0006's Consequences state *"Chromium is unchanged:
`playwright.config.template.ts` still applies `--host-resolver-rules` … `.curlrc`
is a curl mechanism and does not reach the browser."* That remains true and is
not contradicted here. The two decisions are orthogonal:

- ADR-0006 is about **name resolution** — teaching curl which address a
  `.localhost` host is at.
- This ADR is about **which binary launches** — nothing to do with resolution.

They compose, and it was checked rather than assumed: with the ENV set, a
`--config` carrying only `browser.launchOptions.args` (the shape a
`--host-resolver-rules` override takes) opens successfully; without it, the same
config fails on the missing Chrome. Before this change the config-file route
alone could not work at all.

## How this is verified

CI has no Docker step and never builds `aep-runner:dev`, so — as with ADR-0006's
curl half — this is checked by hand against the image after
`make build-runner FORCE=1`, and re-checked whenever `PLAYWRIGHT_CLI_VERSION`
moves (the line numbers above are `@playwright/cli@0.1.15`).

```sh
# 1. The documented bare command opens a browser.
docker run --rm --entrypoint sh aep-runner:dev -c \
  'playwright-cli open "http://example.invalid/" 2>&1 | grep -E "opened with pid|not found at"'
# expect: "### Browser `default` opened with pid N"
#   (before this change: "Chromium distribution 'chrome' is not found at
#    /opt/google/chrome/chrome")

# 2. It is a default, not a lid — an explicit channel still wins, and still fails.
docker run --rm --entrypoint sh aep-runner:dev -c \
  'playwright-cli --browser=chrome open "http://example.invalid/" 2>&1 | grep -E "not found at"'
# expect: the /opt/google/chrome/chrome error

# 3. It composes with a resolver-override config (ADR-0006's browser half).
docker run --rm --entrypoint sh aep-runner:dev -c '
  cd /tmp && printf "%s" \
    "{\"browser\":{\"launchOptions\":{\"args\":[\"--host-resolver-rules=MAP a.localhost 10.0.0.1\"]}}}" > c.json
  playwright-cli --config=c.json open "http://example.invalid/" 2>&1 | grep -E "opened with pid|not found at"'
# expect: "opened with pid N"  (with PLAYWRIGHT_MCP_BROWSER unset: the chrome error)

# 4. The binary is the baked one, not a runtime download.
#    chromium.executablePath() → /ms-playwright/chromium-1228/chrome-linux/chrome
```

End to end, the signal is the absence of a detour: in the archived NDJSON for a
validation cycle the agent should go `agent_started` → `playwright-cli open` →
`snapshot`, with no `/etc/hosts`, `ss -tlnp` or `program.js` inspection in
between. The 2026-08-18 p26 run, seq 52-81, is the baseline that shows the
detour.
