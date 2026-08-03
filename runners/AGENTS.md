# AGENTS.md — runners/

One-shot / job images (not long-lived services). Run to completion in a pod.

**Status:** `remote-worker/` is the coding-agent runner — a TS Claude Agent SDK
one-shot pod that provisions a workspace, assembles its base plugin out of the
repo-root skill library, and runs the Agent SDK. Skills are **authored in
`<repo>/skills/`, not here** (`skills/AGENTS.md` has the authoring rules); this
package owns their delivery. The dev flow bind-mounts that library into the
runner pod at `/app/skills` for live skill edits (see
`deployments/scripts/setup-k3d.sh`).

## Conventions

- One entry point per pod (`src/oneshot.ts`); everything reachable from it.
- **Never put a credential in a git URL or in argv.** All clones go through
  `lib/git_clone.ts` — an authenticated URL leaks into `child_process` error
  messages (which the BFF forwards to the console build log), into `ps`, and into
  `.git/config`. Rationale inline in `git_clone.ts`; the BFF keeps a shape-based
  second line of defense in `delivery/codingagent/redact.go`.
- **ONE credential mechanism: the git credential helper in `lib/credhelper.ts`.**
  Every authenticated git operation in a run goes through it, the provisioning
  clone included — the clone wires it in with `git -c credential.<origin>.helper`
  because `.git/config` doesn't exist yet, and `workspace.ts` installs the same
  script durably afterwards. No GIT_ASKPASS, no token in argv or env, and the
  runner process never holds a GitHub token. Don't add a second path: the last
  one shipped a script serving two protocols that dispatched on `[ -n "$1" ]`,
  which is true for both, so the clone worked and every agent operation failed
  its auth silently. Putting the helper on the clone is what makes a break a
  provisioning failure instead. Any change to the generated scripts must keep
  `credhelper.test.ts` green — it drives them with real `git`, which is the only
  thing that would have caught that.
- Runner `console.*` is a **user-facing** channel, and it shares the file
  descriptor the NDJSON progress feed writes to. `installConsoleScrubber()` at
  each entry point converts every call into a scrubbed `log` progress event, so
  the feed stays parseable NDJSON end to end; don't bypass it by writing to
  `process.stdout` directly. The BFF still wraps any non-NDJSON pod line into a
  build-log event, but that is now a safety net, not the normal path.
- **The progress contract is `lib/progress/schema.ts`, and it moves with three
  mirrors**: `contracts/progress.go`, the three progress schemas in
  `packages/contracts/api/v1/openapi.yaml` (contract-first — then `make gen-api`),
  and the WORDING, which is nobody's here: `@aep/progress-view` renders every
  line for both the console and the playground, so an event without a case there
  reaches a user as a blank row or a raw field dump. Decisions and the SDK's
  measured capabilities are in
  `remote-worker/design/decisions/ADR-0002-run-observability.md`; read it before
  changing what a line says, because several of its entries are corrections of
  the obvious-looking choice.
- **Fan-out runs in the foreground.** A `PreToolUse` hook
  (`lib/fanout_foreground.ts`) forces `run_in_background: false` on every
  `Agent`/`Task` call that did not already say so. Backgrounding does not add
  concurrency — several fan-out calls in one turn is what does — and it detaches
  the subagent, so the SDK forwards none of its messages, a whole component's work
  reaches the feed as an empty section, and the session can finish while its
  children are still running (it did: `result: success` with one component
  stubbed and one missing). **Background is the SDK default**, so the hook keys on
  the flag's absence, not on `true`; the omitted-flag test is the regression pin.
  Rationale inline in the module; ADR-0002 decision 13 has the measurements.
- **Authored files land in the project.** `lib/workspace_guard.ts` is a
  `PreToolUse` hook that denies `Write`/`Edit`/`NotebookEdit` outside the
  workspace, and `promptWithProjectRoot` (`lib/runner.ts`) states the absolute
  root in the prompt — the runner is the only layer that knows it, since the two
  prompt builders sit either side of a language boundary and the path is decided
  after `provisionWorkspace`. Both exist because a run inferred that the
  skills-plugin directory's parent was the project root and built a whole
  component there, green. Writes are allowed outside the project in exactly two
  trees: the temp directory, and **any dot-directory under `$HOME`** — one rule,
  because every toolchain hides its cache in one (`.ballerina`, `.npm`, `.m2`,
  `.cargo`) and this module has no business tracking which stacks the image
  ships. The earlier version listed three, which silently contradicts the next
  stack skill added. A visible directory under `$HOME` stays denied, so a sibling
  checkout is still caught. Reads are deliberately NOT gated: a skill's
  `references/` live outside the project by construction, and the agent must be
  able to read the toolchain's own installation for a library's real signature.
  Bash is not gated either; a build writes where it writes, and the pod is the
  containment boundary. The guard catches the one expensive mistake, it is not a
  sandbox.
- **`allowedTools` restricts nothing here.** `bypassPermissions` +
  `allowDangerouslySkipPermissions` allow every harness tool regardless, so
  `BASE_ALLOWED_TOOLS` documents intent while `DISALLOWED_TOOLS` is the boundary
  that holds. Keep the harness's session-management surface (schedulers, task
  channels, interactive prompts) in the deny list: a one-shot pod has no user and
  no next session, and a reachable-but-useless tool is somewhere a run will spend
  a turn. Corollary: a typo in `BASE_ALLOWED_TOOLS` cannot fail loudly — it named
  `Task` for a whole SDK generation after the tool became `Agent`.
- Self-contained: all agent and SDK-specific wiring lives here.
- **Skills scope is stated by the caller, never read off `AEP_COMPONENT_NAME`.**
  A milestone Job carries a sentinel there (`aep-milestone`), so an
  implementation run resolves the union of `skillsApplied` across every
  `specs/design/components/*/design.json`; a validation run applies no design
  skills at all. The local harness (`local.ts`) carries its own sentinel
  (`aep-local-milestone`) for the same reason: a playground coding run works
  the whole project, same as the milestone loop, and may touch several
  components — there is no single one to name.
- **Only the base plugin preloads.** The SDK `skills:` array carries `aep:aep`
  (plus `aep:aep-validation` on a validation run) and nothing else; every
  project-attached skill is listed by description and its body arrives when the
  agent loads it. `buildSessionSkills` (`lib/runner.ts`) is the seam that holds
  this and `runner.test.ts` pins it. Kind decides the materialised prefix only —
  `org` bought a preloaded body until it didn't, which made a run's startup
  context grow with the number of components the project designed. The cost of
  the flip is that a skill's **description** is now the whole trigger, so a thin
  one silently loses its skill; `skills/AGENTS.md` owns that rule.
- **The base plugin is ASSEMBLED from `<repo>/skills/`, per session, per mode.**
  `lib/base_plugin.ts` is the single choke point: it selects the runner's three
  skills out of the library (`aep`, `aep-validation`, `playwright-cli`), applies
  `skills/aep/overlays/local.md` when the mode is `local`, and writes the result
  to a scratch dir the SDK loads. Three properties it exists to hold, all pinned
  by `base_plugin.test.ts`:
  **the selection is explicit** — the library also holds the design-flow skills,
  and a coding session that could see `design`'s description is one `loadSkill`
  from being told to author `specs/`;
  **`overlays/` never reaches a session** — the `aep` skill lets the agent read
  its own skill dir, so a local-mode overlay sitting beside `SKILL.md` in a
  production run is a second procedure it can find;
  **assembling happens here, not in the entrypoints** — a caller passes a mode,
  never a composed directory, so no new caller can hand the SDK something
  hand-built. Mode is stated (`BaseAgentConfig.mode`, default `github`), never
  inferred. ADR:
  `remote-worker/design/decisions/ADR-0004-library-owned-workflow-skills.md`.
- **Anything a skill must invoke by absolute path reads `$AEP_SKILLS_DIR`.** The
  runner stamps it (`lib/runner.ts`) because it is the only layer that knows
  where the library is: a mount point in the cluster, a bind-mount in the
  playground, a checkout on a developer's host. `aep-validation` runs the
  platform's report generator through it. A hardcoded path is wrong in two modes
  out of three — it was, and it named `/app/plugin`, which stopped existing when
  the plugin became an assembled artifact.
- **The library arrives as a BuildKit named context**
  (`--build-context skills=<repo>/skills` → `COPY --from=skills . /app/skills`),
  the same mechanism `aep-api` uses. Add it to any new build path or the image
  ships without a workflow: `build-runner.sh`, `release.yml`'s matrix row, and
  `local/run-local.sh` all pass it.
- **One image**, `remote-worker/Dockerfile`, serves BOTH task kinds
  (`AEP_TASK_KIND=implementation` and `=validation`). It is Debian-based
  because Playwright's browsers are glibc-linked; do not reintroduce a second,
  slimmer image without moving the Helm/compose/release/`AGENT_RUNNER_IMAGE`
  consumers with it. Build + k3d-import it locally with `make build-runner`.
  Full `deployments/scripts/setup.sh` pre-builds it in the background (off the
  critical path) and imports it in `setup-aep.sh`; `PREBUILD_RUNNER=0` reverts
  to a serial build. The build is skipped when the tag exists, so use
  `FORCE=1 make build-runner` after changing the Dockerfile or `src/`.
