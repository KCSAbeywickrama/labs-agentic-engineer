# ADR-0007 — The runner image runs the stable browser CLI, and names its browser

**Status:** Accepted

A validation run explores the deployed app with the Playwright browser CLI before
authoring specs, and the `aep-validation` skill instructs the bare
`playwright-cli open <url>`. That could not work in this image, for two unrelated
reasons found together.

**The CLI's default browser is a pair, not an engine.** Playwright separates the
*engine* (`browserName` — chromium/firefox/webkit, its own builds under
`PLAYWRIGHT_BROWSERS_PATH`) from the *build* of that engine (`channel` — unset
for Playwright's own, `chrome`/`msedge` for the vendor's, at a system path). With
no browser named it sets **both**, in one branch: `chromium` plus channel
`chrome`. So the default engine cannot be had without Google's branded build at
`/opt/google/chrome/chrome`, which this image does not carry — Chrome is a vendor
install, not a Playwright download. The daemon died at launch and surfaced
nothing but `Daemon process exited with code 1`, so every validation run spent
turns rediscovering it (#570). Channel `chrome` also leaves `chromiumSandbox`
enabled, which cannot start as the non-root `aep` user, so installing Chrome
would only have moved the failure one layer deeper.

**The `@playwright/cli` package pins prerelease Playwright, and always has.**
It depended on `playwright-core@1.62.0-alpha-*` while the specs ran under
`AEP_PLAYWRIGHT_VERSION`. Browser revisions are pinned per core, so the image
baked *two* chromium revisions and a run authored specs in one chromium that
`playwright test` then asserted in another. This is not upgrade-fixable: all 26
published versions of that package pin a prerelease, the latest to an alpha of
an unreleased 1.63, so it sits permanently ahead of the stable line. Upstream
knows (`playwright-cli#411` "cli is using pinned alpha versions";
`playwright#41546`, where their own bot confirmed the supply-chain chain "holds
up end to end" and which closed as completed).

## Decision

**1. The image names the browser type: `PLAYWRIGHT_MCP_BROWSER=chromium`.**
`resolveBrowserParam` maps `chromium` onto channel `chrome-for-testing`, the
alias for the baked build, correcting the distribution *and* taking the sandbox
branch that works unprivileged — both blockers, one value. An ENV rather than a
flag or config file: `runner.ts` already spreads `process.env` into the agent's
child env, so it reaches every agent shell with no plumbing and makes the skill's
existing instruction correct as written. An explicit `--browser=` still wins, so
it is a default, not a lid. Note a `.playwright/cli.config.json` setting
`browser.browserName` does **not** work — it leaves `channel` undefined, which
re-enables the sandbox — so do not "simplify" the ENV into one.

**2. The CLI is `playwright cli`; `@playwright/cli` is not installed.** Both
spellings execute the same `playwright-core/lib/tools/cli-client/program` and
expose an identical command surface, but the subcommand runs on the pinned
stable core. That collapses the two chromium revisions into one, so exploration
and assertion finally happen in the *same* build, and drops ~974MB. The package
only added a skill check and an npm-registry update check whose banner would
otherwise land in every agent's tool output.

**2a. Which is why `PLAYWRIGHT_VERSION` is floored at 1.62.1.** Through 1.61.x
`cli` was `command("cli", { hidden: true })`, and a Playwright collaborator
called it "an internal command meant for testing… the officially supported one
is [@playwright/cli]" (`playwright#41279`, closed **not_planned**) — a direct
contradiction of the #411 advice this decision was first built on. Depending on
it there would have meant depending on an internal API. 1.62.1 is the release
that promoted it: `command("cli")`, listed in `playwright --help` as "run
playwright cli commands from terminal", shipped alongside `mcp` and
`init-skills`. That is upstream's actual answer to #411/#41279/#41546 — not
fixing the package's pinning, but making the stable package self-sufficient. So
the floor is load-bearing: below it this arrangement is unsupported, at or above
it it is documented. Do not lower the pin.

**3. `playwright-cli` stays on PATH as a shim** (`exec playwright cli "$@"`).
Only `@playwright/cli` declares that binary name, and the CLI's own skill uses it
187 times against 2 mentions of the subcommand form, both buried in an
Installation section two-thirds of the way down. That skill is vendored upstream
prose this repo does not edit, and its fallback for a missing binary is
`npm install -g @playwright/cli@latest` — so without the shim an agent would
reinstall the package this ADR removes, at task time, over the network, and get
the second browser back. The shim keeps that path unreachable.

**4. No skill says any of this.** Upstream advises mentioning the convention when
installing the skills, and a first cut did — until it was clear the note buys a
run nothing: the shim makes `playwright-cli` work, so the agent never meets the
distinction, and the install fallback is reachable only when the binary is
missing, which it now cannot be. It would only add a second spelling to choose
between, in a body preloaded into every validation run. Same move as ADR-0006's
decision 5: fix the environment, then delete the explanation rather than reword
it (`skills/AGENTS.md` — history goes "in this file or an ADR, not into every
run's context"). One stale fact was corrected: the vendoring source.

## Consequences

- One chromium, revision-matched to `AEP_PLAYWRIGHT_VERSION`: a locator or aria
  snapshot captured while exploring is now asserted in the browser it was
  observed in.
- `@playwright/test` is untouched — it never forces a channel and does not read
  `PLAYWRIGHT_MCP_BROWSER`.
- The ENV is still required on the stable path: with it cleared, `playwright cli
  open` fails with the same `/opt/google/chrome/chrome` error. The two halves of
  this ADR are independent.
- `--browser=chrome`/`msedge` still fail (absent by decision 1), and
  `--browser=firefox`/`webkit` too — `playwright install --with-deps chromium`
  gives system libraries to chromium alone. The image no longer downloads those
  binaries at all.
- Bumping `PLAYWRIGHT_VERSION` now moves the CLI, its browser, the specs and the
  vendored skill together (`skills/playwright-cli/VENDORED.md`). One knob, not
  two — and it is what keeps the skill executable: the copy vendored from
  `@playwright/cli` documented `screenshot --hires` against a CLI that answered
  `Unknown option: --hires`. On 1.62.1 the skill and the binary agree again
  because they ship from the same package.
- A bump can also move the skill's *path and file set*, so the refresh recipe
  replaces `references/` rather than merging: 1.62 relocated the source to
  `lib/tools/skills/playwright-cli` and dropped `spec-driven-testing.md`.
- CI has no Docker step and never builds `aep-runner:dev`, so that bump is
  re-checked by hand: `playwright-cli open <url>` in the built image should print
  ``Browser `default` opened with pid …``.

Rejected: pinning `@playwright/test` to the CLI's alpha (aligns the revisions,
but `AEP_PLAYWRIGHT_VERSION` is written verbatim into every generated
`tests/e2e/package.json`, so it would commit a dated prerelease into customer
repos — and #411's reporter notes many orgs block alpha tags outright); npm
`overrides` forcing the package onto the stable core (verified working, but runs
it off its declared pin and `npm install -g` ignores `overrides`); and pointing
the CLI at the other revision via `launchOptions.executablePath` (also verified
working, and the worst of the three — it drives a browser build the client was
never released with, which is the pairing Playwright's revision pinning exists
to guarantee).

Not taken up yet: 1.62.1 also ships `playwright mcp`, so the runner could drive
the browser over MCP through the Agent SDK instead of Bash — a cleaner
integration than any CLI spelling, and a larger change than this ADR.

Related: ADR-0006 pins endpoint *resolution* for curl and leaves the browser to
`playwright.config.template.ts`; this ADR is about which binary launches, and the
two compose. #570 carries the diagnosis and code references; PR #571 the
before/after evidence.
