# AEP Claude Code plugin

Defines the workflow contract an agent follows for an AEP coding run. The
dispatch prompt carries only the work; the whole procedure lives here — settle
the issue set and its order, work the issues against the component contract, and
leave the run's record behind.

**One authored skill, two modes.** `skills/aep/SKILL.md` serves both the
platform's GitHub-backed runs and the playground's file-based ones, and where
they differ the text is marked `<!-- mode:github -->` / `<!-- mode:local -->`.
A session never loads this file as authored — `src/lib/skill_compose.ts`
resolves the markers first, and the composed copy is what the SDK gets. In
`github` mode the run works a milestone's open `aep` issues on an
`aep/m<n>-c<k>` branch and opens ONE pull request listing `Resolves #N` per
completed issue, which the platform merges; no human does. In `local` mode there
is no remote and no PR: issues are `issues/*.md` and the record is a `## Progress`
note per issue. ADR: `../design/decisions/ADR-0001-one-mode-composed-skill.md`.

## What's inside

- `.claude-plugin/plugin.json` — plugin manifest.
- `.claude-plugin/marketplace.json` — marketplace metadata (for `claude plugin install`).
- `skills/aep/SKILL.md` — the coding workflow (both modes, markers unresolved).
- `skills/aep-validation/` — the validation workflow (issue-anchored).
- `skills/playwright-cli/` — vendored from `@playwright/cli` (Apache-2.0).

No MCP server. The agent uses `git` and `gh` directly inside the per-task
workspace; the platform observes the work via GitHub webhooks.

## Loaded by

`remote-worker/src/lib/runner.ts` is the single choke point: it calls
`composeBasePlugin()` and passes the **composed** plugin directory to the Claude
Agent SDK. It never passes this authored tree — doing the composition there means
no caller can forget and ship a session both procedures at once.

- **Platform runs** (`src/oneshot.ts`) compose for `github`.
- **Playground runs** (`src/local.ts`, `pnpm play <dir> code`) compose for `local`.
- **By hand** — `claude plugin install /path/to/aep/runners/remote-worker/plugin`
  installs the *authored* source, markers and all, so you read both procedures at
  once. Use the playground if you want the composed local body.

## Authentication

The skill never sees credentials. In `github` mode the workspace is provisioned
with the `lib/credhelper.ts` git credential helper and a `gh` wrapper that fetch
fresh tokens from git-service on every call; the agent just runs `git` and `gh`,
and a failure to authenticate is a platform fault it must stop on. `local` mode
needs no credentials at all — there is no remote, and the skill forbids `gh`.
A hand-install is the one case where a developer's own `gh auth login` applies.

See `docs/design/github-integration-phase0.md` §7 for the workspace credential
setup; `docs/design/github-integration-evolution.md` §6 for the per-org
credential model that takes over in Phase 2.
