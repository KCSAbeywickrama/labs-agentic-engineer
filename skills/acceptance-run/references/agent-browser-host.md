# Running agent-browser on a developer machine

The runner image bakes the CLI and its browser; a host run has neither. Nothing
in this repo provisions them, and `skills/agent-browser/SKILL.md` tells an agent
that finds no `agent-browser` on `PATH` to stop rather than hunt — commit
`2760190a` exists because two playground agents each burned ~25 minutes
searching and hit the 600s tool timeout twice. **Provision before the run, not
during it.**

## Install

```bash
npm install -g agent-browser@0.35.2      # match runners/remote-worker/Dockerfile
```

`npm warn EBADENGINE` (package wants node ≥24, this repo runs 22) is expected
and ignored on purpose: the tarball ships prebuilt Rust binaries and no node
ever runs the CLI. The Dockerfile documents the same choice.

## Point it at a browser

Do **not** run `agent-browser install` if a Playwright chromium is already
present — the runner image deliberately reuses `@playwright/test`'s chromium
(revision 1228) rather than downloading a third browser.

```bash
# macOS arm64, revision 1228
export AGENT_BROWSER_EXECUTABLE_PATH="$HOME/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
```

Never set `AGENT_BROWSER_ARGS=--no-sandbox` on a host; it is a build-time-only
concession in the image.

## Verify — the round trip, not `doctor`

```bash
printf '<h1>agent-browser-ok</h1>' > /tmp/ab-smoke.html
agent-browser open file:///tmp/ab-smoke.html
agent-browser get text h1 | grep agent-browser-ok
agent-browser close --all
```

`agent-browser doctor --quick` is **not** a health check: the Dockerfile records
that it passes with `AGENT_BROWSER_EXECUTABLE_PATH` pointing at nothing at all.

## Always take a named session

```bash
export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix acc)"
```

The default session is one shared browser per machine, persisting across
conversations. Working in it can hijack another agent's page mid-task or
navigate away from something a person left open.
