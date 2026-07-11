Here is a draft plan to refine:

# VALIDATION Phase — Implementation Plan

## Context

The AEP SDLC cycle (requirements → design → implement → merge → deploy) never verifies that what was built satisfies the requirements — "done" is asserted, not verified. The acceptance oracle already exists: the spec/design agent authors `specs/validation/validation-criteria.json` in the project repo via the shipped `skills/validation-criteria/SKILL.md` (schema: `requirements[] → criteria[] {id: AC-NNN-x, must, method: e2e|scenario|manual, covered}`).

This plan adds the VALIDATION phase: when a project's implementation tasks are all deployed, the platform creates **one GitHub validation task (issue) per project** capturing everything needed, dispatches the existing one-shot coding agent (`runners/remote-worker`) against it, and the agent authors e2e tests (Playwright), runs them against the deployed app, and opens a PR containing the tests + a validation report.

**Decisions locked with the user:**
- Fresh design; the Temporal ValidationWorkflow design (ADR-0005 / `validation-agent-based` branch) is abandoned. Reuse the GitHub-issue + coding-agent dispatch pipeline.
- UI e2e: planner → generator → healer workflow implemented as **AEP skills** using **playwright-cli** (`@playwright/cli`, Bash-driven — no MCP). Specs are `@playwright/test`.
- API (non-UI) e2e: `@playwright/test` `request` fixture — same runner, same report.
- v1 scope: automate `method: e2e` only; `manual` → human checklist in report; `scenario` → listed as not-yet-validated.
- Test credentials: **platform-injected env** (`AEP_E2E_USERNAME/PASSWORD`) from a project-level secret; graceful `not_run` degradation when unset.
- `covered` semantics: write `true` once a spec passes; **never flip back to false** (regressions surface in the report only).
- PR opens **ready-for-review** even with failures — pass/fail counts in the title; failures are report content, not task failure.
- v1 **includes** the platform report read-model (internal ingest endpoint + status API); console UI deferred.

## End-to-end flow

1. Last implementation task reaches `deployed` → `DispatchCascadeHook.OnTaskDeployed` (per-project advisory lock) → new `MaybeTriggerValidation`.
2. Eligibility passes → create `ComponentTask{Kind: validation}` → resolve deployed URLs → create GitHub issue (labels `aep`, `validation`) → dispatch K8s Job with the Playwright-capable runner image.
3. Agent (skills-driven): reads issue + criteria → explores deployed app via playwright-cli → writes `specs/validation/test-plan.md` → authors specs in `tests/e2e/` → runs `npx playwright test` → heals brittle failures (bounded, never masks genuine failures) → generates report via deterministic script → flips `covered: true` for passers → POSTs report to platform (best-effort) → opens PR `Closes #N`.
4. Webhook links PR → `ready_for_review`; human merges → `merged` (resting state; build dispatch skipped for validation kind).

---

## Part A — Platform side (`services/aep-api`)

### A1. Data model
- `models/component_task.go`: add `Kind string` (`gorm:"not null;default:implementation;index"`) + constants `TaskKindImplementation`/`TaskKindValidation`; sentinel `ValidationComponentName = "aep-validation"` (valid k8s label value — stamped into Job labels in `job_template.go`). AutoMigrate backfills via column default (registered in `cmd/aep-api/main.go` + `internal/platform/dbtest/dbtest.go`).
- New `models/validation_report.go`: `ValidationReport{ID, TaskID(idx), OrgID, ProjectID(idx), PassedCount, FailedCount, NotRunCount, ManualCount, ScenarioCount, ReportJSON jsonb, CreatedAt}`. Register in both AutoMigrate lists.
- **Audit `ListByProjectID` consumers** (they now see validation rows):
  - `task/task_stream.go` reconciliation (`runReconciliationStreamed`, `ReconcilePendingForDesignChange`): skip `Kind == validation` (sentinel name isn't in the design — would be auto-rejected otherwise).
  - `task_stream.go` `freshCount` guard + `filterNonRejectedForPrompt`: exclude validation rows.
  - `codingagent/dispatch_service.go` `DispatchTasks`: exclude validation rows from `statusByComponent`; route them to the validation dispatch path (A4).
  - `repositories/task_repository.go` `GetByComponentName`: filter `kind = 'implementation'`.

### A2. Trigger
- New consumer-side port in `codingagent`: `ValidationTrigger{MaybeTriggerValidation(ctx, orgID, projectID)}` + `SetValidationTrigger` on `DispatchCascadeHook`; invoked inside the locked cascade after `DispatchTasks` (`dispatch_cascade_hook.go` — the per-project `pg_advisory_xact_lock` gives "exactly one validation task" for free).
- Eligibility (pure function + repo reads): ≥1 implementation task; all non-rejected/abandoned implementation tasks `deployed`; no active validation task (`pending/on_hold/in_progress/ready_for_review`) and no `merged` one for the current (spec, design) version pair; `specs/validation/validation-criteria.json` exists (new `ArtifactStore.ReadValidationFile` mirroring `ReadRequirementFile` in `internal/feature/artifacts/artifact_store.go`). Missing criteria file ⇒ log warning + skip.
- Manual escape hatch: `POST /projects/{projectName}/validation/run` (409 active, 422 criteria missing, 202 created).
- In-flight validation from a previous cycle **blocks** a new one until terminal (manual endpoint reports 409).

### A3. Validation issue body
New `internal/feature/gitrepo/validation_issue_body.go` — `BuildValidationIssueBody(task, componentRows, criteriaPath)`, modeled on `issue_body.go:BuildIssueBody`. Sections:
1. Intro (validation task: author e2e tests against the deployed system, run, commit report, open PR).
2. Acceptance oracle: criteria path, method semantics, v1 scope statement, covered write-back rule.
3. **Deployed endpoints table**: per design component — name, type, language, appPath, external URL (via `component.ComponentService.ListDeployments` → `firstExternalURL`, same mechanism as `dispatch_service.go:resolveDependencyEndpoints`), plus design.md/openapi.yaml pointers.
4. Test layout conventions: `tests/e2e/` own package at repo root (outside all App Paths → never triggers component rebuilds); one spec per criterion; title prefix `AC-NNN-x:`.
5. Report requirements: commit `specs/validation/report.md` + `report.json`; POST report.json to the platform callback; issue-comment summary.
6. PR conventions: one PR, body contains `Closes #<issueNumber>`, tests + report only — never modify app source under component appPaths.
7. Footer pointing at the `aep-validation` skill.

### A4. Dispatch
- Config: `cfg.ValidationRunnerImage` (`VALIDATION_RUNNER_IMAGE`) in `internal/config/` + `.env.example`.
- New `DispatchValidationTask(ctx, task)` on `dispatchService`, mirroring `dispatchOne` minus component machinery: skip `ensureOCComponent` and deps gating; reuse task-JWT mint, `anthropicSvc.ApplyWPSecret`, board moves, `markFailed`. `JobInputs.RunnerImage` already exists — set it to the validation image; `ActiveDeadlineSeconds: 7200`.
- Prompt: `buildValidationAgentPrompt(task)` — thin, mirrors `buildAgentPrompt`: "This is a **validation task**. Work on this GitHub validation issue: <url> … follow the `aep-validation` skill's workflow … PR body must include `Closes #N`."
- Run name keeps the `ca-` prefix → `JobWatcher` + `CodingAgentWatcher` work unchanged.
- **URL lag race**: if any component's external URL is empty, set `on_hold` + `DispatchDeferredAt` (existing `OnHoldWatcher` retries, 2-min deadline → `failed`). Issue creation lives inside the dispatch path (URLs → `CreateIssue` → proxy dispatch), idempotent on `task.IssueURL != ""`.
- Legacy Argo path: validation **fails loudly** when proxy-path prerequisites are absent (no image parameter on the ClusterWorkflow). Follow-up noted, not v1.
- `RetryTask`: kind-branch → `DispatchValidationTask`.

### A5. Lifecycle
- No new states in `internal/contracts/task_state.go`. `pending → in_progress → ready_for_review → merged`; `merged` is the validation task's documented resting state (nothing emits `push.matched` for it).
- One kind-branch in `task/handlers.go:PullRequestClosed`: skip `wfService.DispatchTaskBuild` when `Kind == validation`.
- Failure paths reuse: watcher-driven `coding_agent.failed` → `failed`; PR closed-unmerged → `rejected`; org-disconnect `abandoned` cascades unchanged.

### A6. Report ingest + status API + credentials
- Internal endpoint `POST /internal/v1/tasks/{taskId}/validation-report` (runner-auth via `auth.RunnerScopedInput`, registered through `api.InternalDeps` like `task_internal_huma.go`): validates report.json shape, upserts one `validation_reports` row per task (latest wins).
- `GET /projects/{projectName}/validation`: validation task summary + report counts/criteria statuses (or `report: null` → "pending"). Console UI deferred.
- **Test credentials**: `PUT /projects/{projectName}/validation/credentials` stores username/password via the same secret-manager path as the Anthropic key (`ApplyWPSecret` pattern); dispatch injects `AEP_E2E_USERNAME`/`AEP_E2E_PASSWORD` into the validation Job (optional secretRef in `job_template.go`, omitted when unset). Runner spreads env to the agent's child process already (`runner.ts`).

### A7. Package layout + wiring
- New vertical slice `internal/feature/validation/`: `validation_service.go` (trigger eligibility, create+issue+dispatch orchestration, ingest, status), `validation_huma.go`, `validation_internal_huma.go`. Ports consumer-side: `ValidationDispatcher` (satisfied by `dispatchService`), `EndpointResolver` (adapter over `component.ComponentService.ListDeployments` at composition root); direct use of `gitrepo.IssueService` + `artifacts.ArtifactStore`.
- `internal/arch/arch_test.go`: extend `featureEdgeAllowlist` with `"validation": {"artifacts", "gitrepo"}`.
- Wire in `internal/app/app.go`: construct service, `cascadeHook.SetValidationTrigger`, add to `HumaDeps`/`InternalDeps`.

---

## Part B — Agent side (`runners/remote-worker`)

**Zero runner TypeScript changes.** Everything is skills + a Dockerfile variant. Skills live in the **runner plugin** (not aep-api builtins): `//go:embed builtin/*/SKILL.md` ships only SKILL.md (no reference scripts), per-task skills resolve from the design's `skillsApplied` (project-level — would leak into implementation tasks), and workflow skills are platform-owned agent behavior like `aep`. The existing per-task pull still delivers project stack skills (`thunder-authentication`, `react-webapp`…) to validation tasks for free — no `TaskSkillsService` change.

### B1. Three new plugin skills (`runners/remote-worker/plugin/skills/`)

**`aep-validation/SKILL.md`** — orchestrator (analog of `aep` for validation tasks). Workflow:
- Read issue (`gh issue view --comments`); required sections (criteria path, deployed endpoints); missing section → issue comment + fail loudly.
- Branch `validation/issue-<N>`. Partition criteria by method; `covered:true` + spec exists → regression set (run only), `covered:false` → author.
- Scaffold if absent (idempotent): `tests/e2e/package.json` (private, `@playwright/test` pinned to image's `$AEP_PLAYWRIGHT_VERSION`), `playwright.config.ts` from template, `lib/targets.ts` + `targets.json` (issue endpoints; env override `AEP_E2E_TARGET_<NAME>` wins), `scripts/generate-report.mjs` copied from references, `.gitignore`.
- PLAN → invoke `playwright-authoring`; commit `specs/validation/test-plan.md` (reviewable artifact).
- GENERATE → one spec per criterion: `tests/e2e/specs/AC-001-a.spec.ts`, title `test('AC-001-a: <must>')` — the `AC-\d{3}-[a-z]:` prefix is the report script's join key.
- RUN → `npm ci && npx playwright test --reporter=json` (also writes `test-results/results.json`).
- HEAL → invoke `playwright-healing` (bounded, B1c).
- REPORT → run `generate-report.mjs` (deterministic): writes `specs/validation/report.md` + `report.json`, sets `covered: true` for passing e2e criteria (never writes `false`). Commit together.
- Callback (best-effort, skip silently if `AEP_PLATFORM_URL` unset — local harness): `curl POST $AEP_PLATFORM_URL/internal/v1/tasks/$AEP_TASK_ID/validation-report`.
- PR ready-for-review: title `Validation: <X>/<Y> e2e criteria passing`, body `Closes #N` + summary table + report path. Issue comments at milestones.
- Auth degradation: creds required but `AEP_E2E_USERNAME` unset → author specs anyway, mark affected criteria `not_run`, state blocker in report + issue comment.
- Deny additions: never edit app source under App Paths; never edit criteria beyond `covered`; never delete a committed spec; never leave `.only`/`.skip`; never commit credentials. `aep`'s auth/git/deny rules still apply.
- `references/`: `generate-report.mjs` (full script, ~200 lines, zero-dep Node), `playwright.config.template.ts`, `report-format.md`.

**`playwright-authoring/SKILL.md`** — PLAN + GENERATE discipline: explore every flow with playwright-cli against the deployed URL before writing its spec (a live-failing flow still gets an honestly-failing spec); playwright-cli command reference (write our own — check license before vendoring upstream skill text); role/label locators, web-first assertions, no `waitForTimeout`; unique test data per run (deployed DB persists); API specs via `request` fixture asserting only what the `must` claims; auth via shared `lib/auth.ts` setup project + `storageState` reading `AEP_E2E_USERNAME/PASSWORD`; spec is done when it passes twice consecutively.

**`playwright-healing/SKILL.md`** — hard rule first: a heal changes *how the test drives the app*, never *what it claims the app does*. Classification table (brittle: locator/strict-mode, timing, data collision, session; genuine: assertion mismatch, unexpected status, app error page, missing feature). Triage = re-drive live via playwright-cli. Bounds: max 2 heal attempts per criterion, max 2 focused re-run waves, then one final full run for the authoritative results.json. Artifacts: commit per heal `heal(AC-NNN-x): <classification>: <change>` + `tests/e2e/heal-log.json` entry (report script folds into a Healing log section). Forbidden moves listed explicitly (edit expected values, delete assertions, `expect.soft`, `.skip`/`.fixme`, try/catch around expects).

### B2. Base skill edit
`plugin/skills/aep/SKILL.md`: ~4-line pointer — "if the prompt says validation task, `aep-validation` replaces the implementation workflow; auth model, git/gh conventions, deny-list still apply." Bump `plugin/.claude-plugin/plugin.json` to 0.5.0.

### B3. Report format (in `references/report-format.md`, generated by the script)
- `report.json`: `{schemaVersion, issue, commit, generatedAt, playwrightVersion, totals{e2e{total,pass,fail,notRun}, manual, scenario}, criteria[{id, requirementId, must, method, status: pass|fail|not_run|manual|not_validated, spec, healed, healAttempts, flaky, durationMs, failure{message, location}|null}]}`.
- `report.md`: header (project, issue, timestamp, commit) → summary table → e2e results table → failure detail subsections → manual checklist (`- [ ] AC-… — must`) → scenario not-validated list → healing log.
- Mapping: title regex `^(AC-\d{3}-[a-z]):`; reporter `expected`→pass, `flaky`→pass+flag, `unexpected`→fail, missing→not_run. Unmatched/duplicate titles → script exits non-zero (agent must fix naming before PR).

### B4. `Dockerfile.validation`
Current image is `node:22-alpine` — musl, can't run Playwright's chromium. New `runners/remote-worker/Dockerfile.validation`: `FROM node:22-bookworm-slim`; apt `git curl bash python3 ca-certificates` + `gh` (GitHub apt repo); no Go; `npm i -g @playwright/cli @playwright/test@<pinned>`; `ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` + `npx playwright install --with-deps chromium` (then `chmod -R a+rX`); `ENV AEP_PLAYWRIGHT_VERSION=<same pin>`; same `aep` user, same entrypoint. Verify playwright runs headless as `aep`. Deployment plumbing: build/push alongside the existing runner image; set `VALIDATION_RUNNER_IMAGE`.

### B5. Local harness
`local/run-local.sh`: `DOCKERFILE="${DOCKERFILE:-$WORKER_DIR/Dockerfile}"` + `docker build -f "$DOCKERFILE" …`; document in `local/README.md`. Skill iteration is live via the existing `plugin/` bind mount.

---

## Implementation order

1. **Platform model layer** (A1) + consumer audits; dbtest for kind backfill + reconciliation skip.
2. **Report script + conventions** (B3, `references/generate-report.mjs` first — its contract anchors both sides) + `tsx --test` unit test against fixture results.json/criteria.
3. **Skills** (B1, B2) + `Dockerfile.validation` (B4) + harness tweak (B5); iterate locally with a fixture repo (hand-written criteria file + hand-written validation issue against a reachable deployed sample). Scenario matrix: green run · genuine failure (healer must refuse) · brittle failure (seed bad locator) · iteration N+1 · missing issue section.
4. **Issue body + dispatch** (A3, A4) + prompt; unit tests for builder/prompt/eligibility.
5. **Trigger + validation feature slice + wiring** (A2, A7); dbtest for trigger idempotency under the advisory lock, on_hold deferral.
6. **Webhook kind-branch** (A5); gittest end-to-end: issue create → PR `Closes #N` → ready_for_review → merged without build dispatch.
7. **Report ingest + status API + credentials endpoint** (A6); componenttest coverage (401/409/422/202, ingest upsert).

## Verification

- `make build`, `make test`, `make lint`, `make typecheck`, `make license-check` at root.
- Go: new dbtests (`make -C services/aep-api test-db`), componenttests, gittest webhook flow, arch test allowlist.
- Agent side: local one-shot harness run (`DOCKERFILE=Dockerfile.validation ./local/run-local.sh`) against the fixture repo; inspect branch, PR, committed report, heal-log; verify covered flags flipped only for passers.
- End-to-end (cluster): deploy a sample project, let all tasks reach deployed, observe automatic validation issue + Job + PR; `GET /projects/{p}/validation` returns ingested counts.

## Out of scope / follow-ups (documented, not built)

- Scenario-lane automation (agentic judgment verdicts); console validation UI; legacy Argo `aep-validation-agent` ClusterWorkflow; automated fix-task loop on failures; `AEP_TASK_KIND` env + skill preload switch; superseding in-flight validation on a new deploy cycle.

---

## Addendum — where does `validation-criteria.json` actually get generated? (open decision, discuss with team)

**The gap.** The Context above assumes "the spec/design agent authors
`specs/validation/validation-criteria.json` via the shipped skill." In practice
it does not, because of a use-case mismatch:

- The oracle-generation instruction was added only to the **`design-generate`**
  genai steering (`services/aep-api/internal/feature/genai/steering.go`, artifact
  (5)).
- The **new console** (`apps/console`, the one in use) authors *all* specs —
  requirements **and** design — through **one** interactive collab chat that
  always sends `useCase: "requirements-chat"`, `collab: true`
  (`apps/console/src/features/agent-chat/api/turns.ts`). The **"Generate design"**
  button is just a canned instruction (`buildDesignGenerationInstruction()` in
  `features/projects/lib/promptStore.ts`) sent through that same chat turn.
- So a `design-generate` turn is **never** invoked by the new console, and the
  steering that would produce the oracle never fires. Confirmed empirically: for
  recent projects `agent_turns` shows only `requirements-chat` (+ `task-plan`)
  turns; the design files were written by the big `requirements-chat` turn and
  committed by the collab committer as `aep: apply file changes: collab session`.
  Only the legacy console's Architecture page still sends `design-generate`.
- Side effect of the same mismatch: the **MCP dependency-discovery** block only
  attaches to `design-generate` turns (`turn_runner.go` `mcpForTurn`), so the new
  console's design authoring silently skips dependency discovery too.

The end state we want is unchanged in all options: tapping **Generate design**
produces the design artifacts **and** `specs/validation/validation-criteria.json`
in the same action (shown as two things in the UI, generated together).

### Option 1 — extend the "Generate design" canned instruction (SIMPLEST — v1)

Add the oracle ask to `buildDesignGenerationInstruction()` so the CTA's
instruction tells the agent to also produce `validation-criteria.json` via the
`validation-criteria` skill (from the requirements prose; preserve `covered:true`
on unchanged criteria when the file exists).

- **Pros:** one file changed (client); scoped *exactly* to the Generate-design
  action (fires nowhere else); no UX change; the model already has the skill in
  its catalog. Ships today.
- **Cons:** generation guidance lives in a client-side English string rather than
  server-versioned steering; does not restore MCP dependency-discovery; relies on
  the model honoring the extra step in a room-mode turn.
- **To verify:** in room mode the file source is the collab **doc**, not the
  snapshot — confirm the new `specs/validation/validation-criteria.json` is
  committed through the collab committer (JSON, non-markdown → not held), and that
  "preserve `covered`" on re-generate works (the doc must contain the existing
  file for the agent to see it).

### Option 2 — make "Generate design" a first-class `design-generate` turn (cleaner, more work)

Switch the CTA to dispatch a real `design-generate` turn, activating the existing
server steering (5).

- **2a (in-room / collab):** keep `collab: true` so the live spec-view editing
  feel is unchanged, but the turn is a proper `design-generate`. Restores MCP
  discovery; server-versioned ordered generation; requirements→design lineage
  (`specTag`). Costs console plumbing: a second send path, the re-attach filter
  (`useAgentChat.ts` assumes `requirements-chat`), and a separate conversation
  (`…--design-generate--…`) whose narration lives outside the chat history.
- **2b (detached commit-fold):** background turn landing one `generate(design): …`
  commit; needs a dedicated "generating design…" progress affordance (how the
  legacy console behaved). No live co-editing during generation.

### Option 3 — steer the `requirements-chat` use case (REJECTED)

Append the oracle ask to the `requirements-chat` steering server-side.

- **Rejected because:** that use case backs *every* chat turn, so the oracle would
  be (re)generated on the first requirements draft, every requirements edit, and
  every unrelated design follow-up — wrong phase, constant churn/commits, wasted
  tokens. The Generate-design action is distinguished by its **instruction**, not
  its use case, so blanket use-case steering cannot scope to it.

### Decision

Ship **Option 1** now (unblocks the flow with minimal risk). Keep server steering
(5) on `design-generate` (still correct for the legacy console and any future
first-class design-generate path). Revisit **Option 2a** as the durable home once
the team weighs the console plumbing vs. the MCP-discovery / server-versioning
benefits.