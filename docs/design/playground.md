# Playground — local-filesystem harness for both agents

**Status:** BUILT (steps 0a + 1–8 of §13, branch feat/playground); step 0b
(live-env parity capture) pending a cluster session.
**Scope:** a root-level `playground/` workspace package (`@aep/playground`) — a TUI/CLI
that runs the **real** engineering agent and the **real** coding agent against a plain
local project directory, phase by phase, with skills and prompts loaded from the
working tree. No git, no GitHub, no Postgres, no cluster.

---

## 1. Goals

The playground works on any local directory the user picks:

```
<project>/specs/     — spec artifacts (exact production layout)
<project>/issues/    — task files (replaces GitHub issues)
<project>/…          — the application source the coding agent edits in place (no PR)
```

Hard requirements:

1. **Phased development** — requirements → design → tasks → code as separate runnable
   steps; the user inspects/edits artifacts between phases.
2. **Independent coding runs** — point the coding agent at an existing project that
   already has `specs/` + `issues/` and run one issue file, without re-running earlier
   phases (for honing the coding agent).

Purpose: edit a `SKILL.md`, a prompt, or a steer string → rerun one phase → observe.
Each loop is one keypress, seconds of overhead, zero rebuilds, no cluster round-trip.

## 2. Approach: run the real agents, swap only the adapters

Principle: **what you hone in the playground must transfer to the platform.** The
playground never forks agent logic — the bytes reaching the model (system prompt,
skill catalog, tools, snapshot view, instruction composition) are byte-identical to
production, which is testable (§14). Everything dropped is driver plumbing invisible
to the model.

- The **engineering agent** is a stateless turn server whose only inputs are an
  immutable file snapshot, a `SkillSource`, a model, and a `ConversationStore`, and
  whose only output is a tool-call stream + terminal manifest. Its in-process boot
  (`createApp({store, buildModel, auth, workspaceMountRoot})`,
  `services/agents/src/server.ts:69`) is already used by the in-package playground and
  the eval harness. The playground boots this app in-process and swaps the adapters
  around it.
- The **coding agent** already separates the cwd-agnostic SDK session
  (`runClaudeQuery`, `runners/remote-worker/src/lib/runner.ts:107` — zero git imports)
  from GitHub-coupled provisioning (`provisionWorkspace`, credhelper). Branch/commit/PR
  mechanics are **LLM behavior encoded in the `aep` skill**, not TypeScript — so a
  no-PR local mode is a skill variant, not a code fork. Two hardcoded values must
  become parameters for this to hold: the plugin path and the `aep:aep` skill preload
  (§3).

Rejected alternatives (do not re-litigate): calling `runConversationTurn()` directly
(forks prompts/composition, skips the real HTTP contract, auth middleware, and
TurnGuard) and orchestrating the shipped server + runner as external processes
(slowest loop, process management, still needs the same runner mode switches).

## 3. Ports catalog

| Port | Defined in | Production adapter | Playground adapter | Status |
|---|---|---|---|---|
| `SkillSource` (catalog/load/loadReference) | `services/agents/src/agents/main/skill-source.ts` | `SnapshotSkillSource` over the org-skills snapshot | same `SnapshotSkillSource`; the snapshot is materialized from working-tree `skills/` per turn | exists — reuse |
| `ConversationStore` (get/save) | `services/agents/src/store/conversation-store.ts` | `PostgresConversationStore` | **`FileConversationStore`** → `<project>/.aep-playground/conversations/` (one `general.json` shared by all spec phases + one-shot `task-plan` files, mirroring production's conversation model; atomic tmp+rename, stale `status:"active"` reset on load, `--fresh` rotates) | exists — new adapter |
| Model seam (`buildModel(apiKey)`) | `services/agents/src/server.ts` (CreateAppDeps) | per-org key via `X-Anthropic-Key` | same `createModel`, key from `ANTHROPIC_API_KEY`; `MockLanguageModel` for playground's own tests | exists — reuse |
| Workspace mount (`workspaceMountRoot`) | `services/agents/src/server.ts` | shared RWX volume written by aep-api | temp snapshot tree written per turn (EvalWorkspace pattern) | exists — reuse |
| **`SpecWorkspace`** (project view in / turn output out) | new, `playground/src/ports/spec-workspace.ts` | git snapshot in; Go fold + one commit out | `FsSpecWorkspace`: dir → files map (production turn filter); client fold (`FileBundle` + `applyToolCall`) + diff-write back | new (TS side) |
| **`IssueStore`** (list/create/update tasks) | new, `playground/src/ports/issue-store.ts` | plan tap → GitHub issues (`aep:task/v1` block + labels) | `FsIssueStore`: fold `planTask`/`updateTask` ok tool-results → `issues/<n>.md` | new (TS side) |
| **`WorkspaceProvider`** (provision → `WorkspaceLayout`) | new, `runners/remote-worker/src/lib/ports.ts` | `provisionWorkspace` (clone + credhelper + gh wrapper) | `localDirWorkspace(projectDir)`: workspace **is** the project dir | introduced |
| **`SkillLibrarySource`** (skillsApplied → `SkillResolution[]`) | formalizes the injectable `clone` seam, `skills_resolver.ts` | `git clone --depth 1` org-skills w/ PAT | injected copy of repo-root `skills/` | seam exists — name it |
| `ProgressSink` (NDJSON schemaVersion 1 on stdout) | `runners/remote-worker/src/lib/progress/emitter.ts` | aep-api tails the pod log | TUI spawns the runner and parses the same lines | exists — reuse contract |
| **Plugin + preload selection** | today hardcoded: `PLUGIN_PATH` and `skills: ["aep:aep"]` (`runner.ts:29,151`) — these bake the GitHub-PR workflow into every session, so **both** must become parameters | `plugin/` (`aep` skill) | `plugin-local/` (`aep-local` skill) via new `basePluginPath` **and** `basePreload` params, both defaulting byte-identically to today | introduced |
| Canned phase prompts | `apps/console/src/features/projects/lib/promptStore.ts` (`buildSpecGenerationInstruction`, `buildDesignGenerationInstruction`) — pure TS | console CTAs | same functions, promoted to a shared package and imported by both | **moved** → shared TS module (§9) |
| Live steer strings | Go constants: `steeringByUseCase["general"]` + `collabDepsSteer` (`genai/steering.go`), `planInstruction` (`task/plan.go`) | appended server-side to every turn instruction | verbatim TS copies in the playground, cross-linked by comments to the Go source (§9) — **aep-api untouched** | duplicated + pinned |

Cross-language note: `SpecWorkspace`/`IssueStore` cannot be one compiled interface
across Go and TS. The shared thing is the **contract** — the turn snapshot filter, the
SSE tool-call/manifest frames, the plan tool-result schemas, the `tasks/<n>.md` context
format — all already pinned in `@aep/agent-stream` and `packages/contracts/schemas/`.
The Go production driver is the reference implementation of the same contract.

## 4. Directory layouts

### 4.1 The playground package (repo root)

```
playground/                          # workspace package @aep/playground (private)
  package.json                       # deps: @aep/agents, @aep/agent-stream, @clack/prompts, yaml, ajv
  AGENTS.md                          # incl. the documented divergences (§10)
  src/
    cli.ts                           # entry — `pnpm play [project-dir] [command] [args]`
    commands.ts                      # requirements|design|tasks|code|chat|check|undo — all headless-capable
    tui/
      picker.ts                      # project dir picker / recent list
      phase-menu.ts                  # home: phase statuses + actions
      chat.ts                        # streaming chat loop (reuses agents-playground rendering)
      review.ts                      # changed-file list, diff, open-in-$EDITOR, validate
      code-view.ts                   # live coding timeline (NDJSON → formatted lines)
    ports/
      spec-workspace.ts              # SpecWorkspace + FsSpecWorkspace
      issue-store.ts                 # IssueStore + FsIssueStore + renderTaskContextFile (TS)
      conversation-store.ts          # FileConversationStore
      progress.ts                    # NdjsonProgressReader
    engine/
      agents-app.ts                  # boot the real agents app in-process (eval/harness pattern)
      turn.ts                        # one eng-agent turn: snapshot → stream → fold → reconcile (+ parity check)
      coding-run.ts                  # spawn remote-worker local.ts, stream NDJSON
      compose.ts                     # instruction composition: shared prompts + pinned steer copies (§9)
      gates.ts                       # phase preconditions
      derived.ts                     # .dsl → .excalidraw, cell-diagram.gen.json (reused materializeDerived)
    state/
      project.ts                     # .aep-playground/project.json
      undo.ts                        # pre-coding-run snapshot + restore
  test/                              # mock-model phase tests (no tokens)
```

`pnpm-workspace.yaml` must gain the `playground` glob (current globs don't cover a root
dir), and root `make build/lint/typecheck/license-check` pick it up via turbo.

### 4.2 A playground project directory

```
<project>/                           # any plain directory the user picks
  specs/                             # EXACT production layout
    requirements/requirements.md
    design/
      design.cell
      design.md
      components/<name>/design.json  # skillsApplied lands here (model-authored, schema-gated)
      components/<name>/design.md
      components/<name>/openapi.yaml
      components/<name>/wireframes.dsl
      components/<name>/*.excalidraw # derived (playground-written, filtered out of turns)
      cell-diagram.gen.json          # derived
    validation/validation-criteria.json
  issues/                            # tasks-phase output; coding-phase input (format §6)
    1.md  2.md  3.md
  src/ …                             # whatever the coding agent builds — the project IS the workspace
  .aep-playground/                   # playground state (dot-dir ⇒ invisible to eng-agent turns)
    project.json                     # issue counter, last-folded hash, phase marks
    prompt.md                        # the initial idea (mirror of the console's create prompt)
    conversations/general.json       # ONE spec conversation for req/design/chat (console parity)
                                     #   + task-plan-<ts>.json one-shots (plan turns are fresh each time)
    runs/<ts>-code-issue-<n>/        # progress.ndjson + claude.log per coding run
    undo/<ts>/                       # pre-coding-run snapshot (restorable)
```

Safety by construction:

- The production snapshot filter (`keepInTurnSnapshot`: `*.md/*.dsl/*.cell` +
  `design.json`/`validation-criteria.json`, dot-led segments dropped) means the
  engineering agent never sees `.aep-playground/`, binaries, or derived artifacts —
  the same view production gives it.
- **`issues/` is additionally excluded from spec-turn snapshots** (requirements/design/
  chat). Production spec turns never see tasks (tasks live in GitHub); without this
  exclusion, `issues/*.md` would pass the filter and leak. Issues enter *only* the
  task-plan turn. App-source `*.md` (e.g. a README the coding agent wrote) passes the
  filter exactly as it would in production — left as-is for parity.
- Path-escape fencing on every write (`resolveWithin`, reused from the existing
  playground fold).

## 5. Per-phase execution flow

All engineering-agent phases share one engine loop (`engine/turn.ts`), the direct
descendant of the `services/agents/playground/playground.ts` loop:

```
read <project> → files map           (FsSpecWorkspace, production turn filter, minus issues/)
materialize files + working-tree skills/ into fake content-addressed snapshots
build TurnRequest {instruction: canned/user text + generalSteer + collabDepsSteer [+ target], workspace ref, toolset?}
POST to the in-process agents app    (streamTurn; self-minted HS256 token, X-Anthropic-Key from env)
render every StreamPart live         (text deltas, tool cards with early path extraction)
fold tool-call frames                (FileBundle + applyToolCall over the server's filtered view)
verify manifest sha256s vs the fold  (cheap D14 parity — WARN on mismatch, never block)
diff-write the project dir           (reconcile, fenced) + materialize derived artifacts
conversation persisted by the service itself (FileConversationStore)
update .aep-playground/project.json  (last folded hash → drives filesChangedExternally)
```

Server constraints the engine must honor (all satisfied by the existing
`EvalWorkspace` + eval-auth code, reused): turns are **workspace-shaped only** (inline
files 400); snapshot dirs must follow the exact mount layout
`repos/<org>/<proj>/<slug>/snapshots/<sha>` plus `_skills/org-skills/snapshots/<sha>`;
fake shas are content-addressed **lowercase 40-hex**; `skillsRef` is mandatory (an
empty skills snapshot is still materialized); conversation ids are fence-valid
(`org_play--proj_<slug>--<useCase>--<uuid>`) with matching `X-Org-Id`. MCP is **off by
default** (the existing playground defaults `AEP_MCP_URL` to a localhost aep-api;
here "no cluster, no network" must be literally true) — `--mcp` re-enables the
passthrough.

**Instruction composition** mirrors production exactly (§9): canned or free-chat text,
plus the `general` steer, plus `collabDepsSteer`, plus `\n\n(target: X)` when
`--target` is given. All spec phases share **one** conversation
(`…--general--<uuid>`) — the console's one-conversation-per-project model.

### Phase 1 — requirements

- **Gate:** none. First run prompts for the idea (stored to `.aep-playground/prompt.md`).
- **Instruction:** `buildSpecGenerationInstruction(idea)` from the shared prompts
  module (§9), composed as above.
- **Output:** `specs/requirements/requirements.md` (+ files under `specs/requirements/`).
- **Iterate:** follow-ups are free-chat text in the **same** `general` conversation →
  history-aware edits (exactly the console's chat panel). Hand-edits between turns are
  first-class: the engine compares disk to the last-folded hash and sets
  `filesChangedExternally: true` (production D20 semantics).

### Phase 2 — design

- **Gate (playground-side UX only; production has no server gate on this path):**
  `specs/requirements/requirements.md` non-empty.
- **Instruction:** `buildDesignGenerationInstruction()` (§9) — the canned design text,
  which also asks for validation criteria as the final step (see
  docs/design/validation.md "The acceptance oracle") — composed as above. Artifact
  order and structure come from the working-tree skills and the agent's system prompt.
- **Output:** the full design bundle. `skillsApplied` is authored by the model into
  each `design.json` under instruction from the working-tree
  `high-level-architecture` skill (named by `collabDepsSteer`, which is why that steer
  is kept even without `--mcp`) and shape-checked by the `FileBundle` schema gate —
  identical to production. The gate enforces *validity*, not *presence*: capture
  depends on the skill instruction reaching the model, so the playground's
  `SkillSource` always includes the working-tree library.
- Without `--mcp` there is no dependency-discovery MCP: org-service dependencies may be
  invented by the model. Accepted for skill iteration; documented caveat.

### Phase 3 — tasks

- **Gate:** `specs/design/design.md` present + ≥1 component `design.json` valid against
  the published schema (subset of the production build gate; no v\<N\> tag).
- **Turn:** same route with `toolset: "task-plan"` — no file tools exist on this
  toolset, so `specs/` cannot be touched. This is the same live machinery the BFF's
  planner (`task/plan.go`) drives server-side on `POST /build`.
- **Instruction:** `planInstruction` (shared steering file, §9) **+
  `renderPlanContext(existing open issues)`** — the production channel: existing tasks
  ride the *instruction* as rendered context files, not the snapshot (`plan.go:183`).
  Each plan turn uses a **fresh one-shot `task-plan` conversation** (`plan.go:223`),
  also production behavior. Whether the server-side `TaskPlan` accumulator accepts
  `updateTask{issueNumber}` refs for instruction-carried tasks is settled by spike 0a
  (§13) **before** `FsIssueStore` is built; if it rejects them, fall back to the eval
  harness's files-map channel (`evals/task-plan/harness.ts`) and record the divergence
  in §10.
- **Fold:** `FsIssueStore` consumes **ok** tool-results only, mirroring
  `plan_tap.go` semantics including its preload: existing issues are loaded before the
  turn so `updateTask` refs resolve exactly like the production tap (frozen
  preloaded-context anti-hallucination fence). `planTask` ok → allocate next issue
  number, compute the production dedupe `key`
  (`hex(sha256(project\nlineage\ncomponent\ntitleSlug))[:12]`, lineage constant
  `"local"`), skip duplicates by key or normalized title, write `issues/<n>.md`;
  `updateTask` ok → resolve by `issueNumber` (preloaded) or title (created this run)
  and patch the file. Nothing is written without a terminal manifest.
- **Review:** the TUI lists created/updated issues with `dependsOn` edges; the user
  edits issue files freely before coding.

### Phase 4 — code (also the standalone requirement-2 entry)

```
pnpm play <project> code                 # the WHOLE plan, one go, dependency order
pnpm play <project> code issues/3.md     # one independent run (the honing loop)
```

Works on **any** directory containing `specs/` + `issues/` — no playground state, no
prior phases, no engineering-agent process. Plain `code` executes every
non-deployed issue topologically by `dependsOn` (status re-read between runs,
so a dependent sees the dep its predecessor just deployed; an issue whose dep
is still not deployed at its turn is skipped, never a hard error). The
per-issue form exists for honing a single task, not for driving the plan.

1. **Gate:** the issue file parses (frontmatter `component`, `title`). If `dependsOn`
   components have issues not yet `derivedStatus: deployed`, warn — an ordering *hint*,
   never a hard block (the production "deployed" oracle is dropped).
2. **Safety snapshot (mandatory):** copy the project (minus `.aep-playground/`,
   `node_modules`, dot-dirs) to `.aep-playground/undo/<ts>/`; `play undo` restores.
3. **Spawn** `npx tsx runners/remote-worker/src/local.ts` with:
   ```
   AEP_LOCAL_PROJECT_DIR=<project>      AEP_LOCAL_ISSUE_FILE=issues/3.md
   AEP_LOCAL_SKILLS_DIR=<repo>/skills   AEP_LOCAL_PLUGIN_DIR=<repo>/runners/remote-worker/plugin-local
   AEP_COMPONENT_NAME=<from issue frontmatter>   ANTHROPIC_API_KEY=…
   ```
   `local.ts` composes: `localDirWorkspace` → `readSkillsApplied(projectDir, component)`
   (verbatim; reads `specs/design/components/<name>/design.json`) → `resolveTaskSkills`
   with an injected copy-clone over the working tree → `materializeSkills` (per-run
   plugin under `.aep-playground/runner/`) → `runClaudeQuery` with
   `basePluginPath=plugin-local`, `basePreload=["aep-local:aep-local"]`, and the prompt:
   *"Work on the task described in `issues/3.md` (relative to your cwd). Read it first.
   The workflow and constraints are in the `aep-local` skill. When done, update the
   issue file's `derivedStatus` as the skill describes."* Same exit codes (0/1/2).
4. **TUI** streams stdout NDJSON → live timeline; transcript + progress archived under
   `.aep-playground/runs/`.
5. **Status write-back (single owner):** the issue file's frontmatter `derivedStatus`
   is the one source of truth. The agent sets it per the skill; **the playground CLI is
   the writer of record** — on exit 0 it normalizes/repairs to `deployed` (tolerant
   posture, same as production's `taskmeta.Repair`), on nonzero exit or Ctrl-C it sets
   `failed`. Re-plan turns see status because the file *is* the context render.
6. **Re-run loop:** edit a SKILL.md / the plugin skill / the issue → `code` again
   (optionally `--restore` first). Each run is a fresh SDK session (production parity:
   `persistSession: false`).

The `aep-local` skill keeps the production `aep` skill's project conventions (App Path,
full-contract, no-stubs, don't-start-servers, workload.yaml grammar where relevant) and
replaces the GitHub workflow with: read the issue file → implement in place → run build
verification with the local toolchain → append a `## Progress` note and set
`derivedStatus`. If the project happens to be a git repo, the skill may commit locally
per logical step (never push) — free diffing, zero remote coupling.

## 6. Issue-file format (`<project>/issues/<n>.md`)

Production has two renderings of a task: the GitHub issue body (HTML machine block,
`taskmeta`) and the plan-context file (`taskplan/context_file.go` ⇄
`parseTaskContextFile`). The playground standardizes on the **context-file format**
because agent code already parses it (`@aep/agent-stream`'s `parseTaskContextFile`
plucks known keys and ignores extras), making re-plan turns free:

```markdown
---
issueNumber: 3
component: "user-service"
title: "Implement the user service"
dependsOn: ["auth-service"]
origin: "spec-plan"
derivedStatus: "ready"        # ready → (running) → deployed | failed
key: "a1b2c3d4e5f6"           # production dedupe recipe; lineage constant "local"
---

> **Rationale:** one-line planner justification (from planTask)

<task body markdown written by updateTask — scope, acceptance notes, files to touch>
```

- Field order and quoting mirror Go `TaskContextFile.Render` exactly so a TS
  `renderTaskContextFile` round-trips through `parseTaskContextFile` (unit-tested both
  directions, pinned against the Go renderer's fixtures).
- `derivedStatus` reuses production vocabulary; `deployed` means "landed in the project
  dir". `specTag`/`designTag` are omitted (no tags).
- Rendering an issue into a plan-turn context entry is a straight copy to
  `tasks/<issueNumber>.md`.

## 7. TUI screens & CLI verbs

Stack: `@clack/prompts` + readline streaming — the stack the in-package agents
playground already uses; no new TUI framework. **Every screen is also a headless CLI
verb with meaningful exit codes**, so edit-skill→rerun loops are scriptable:

```
$ pnpm play                          → recent-projects picker / "open directory…"
$ pnpm play ~/work/todo-app          → phase menu
$ pnpm play ~/work/todo-app design   → run one phase headlessly; exit code = phase result
$ pnpm play ~/work/todo-app code issues/3.md --restore
```

**Phase menu (home).** One line per phase with FS-derived status:

```
  AEP playground — todo-app (~/work/todo-app)     model claude-sonnet-5 · skills: 11 (working tree)
  ▸ 1 Requirements   ✓ requirements.md (2.1 KB, edited 3m ago)
    2 Design         ✓ 4 components · skillsApplied: go, react-webapp
    3 Tasks          ✓ 5 issues (3 deployed, 1 ready, 1 failed)
    4 Code           run an issue →
    chat · check · undo · quit
```

A phase with unmet gates shows why ("Design — blocked: requirements.md is empty").

**Chat screen (requirements/design/free chat).** Streaming text deltas; tool cards
appear the moment the streamed input yields a `path` ("⟳ Creating
specs/design/design.cell …" → "✓ created"); on `[DONE]` → change summary →
`(r)eview / (c)ontinue / (m)enu`. First entry into requirements auto-seeds the canned
generate instruction (console parity); later entries are free chat in the same
`general` conversation, exactly like the console's chat panel.

**No review screen.** The playground is used with an editor (VS Code) open —
file browsing, diffing, and hand-edits are the editor's job, and hand-edits
between turns are first-class (D20). Turns auto-write the project; validation
survives as the headless `check` verb.

**Tasks screen.** Table of `issues/*.md` (number, component, title, dependsOn,
derivedStatus, blocked-by) → `(p)lan/replan`, run the plan (one go), or run a
SINGLE task — offered only when its dependsOn components are deployed (the
same gate the batch enforces; blocked tasks show why in the table). No file
affordances — hand-authoring/editing an issue is a direct file edit.

**Coding-run screen.** Live timeline from the unchanged NDJSON contract:

```
  ▸ workspace ready (local dir, no clone)
  ▸ skills: org-go, org-react-webapp materialized
  ▸ agent started
  $ go test ./...
  ✓ edit src/user/handler.go
  ■ result success (4m12s)   issue 3 → deployed
  transcript: .aep-playground/runs/…/claude.log
```

Ctrl-C kills the child (run marked `failed`, undo snapshot intact). After: `(r)e-run`,
`(u)ndo`, `(l)og`, task list.

## 8. Skills + prompt hot-iteration (incl. skillsApplied)

- **Engineering agent:** the working-tree `skills/` library is loaded at the start of
  every phase run and materialized into a content-addressed snapshot — an edited
  SKILL.md yields a new snapshot on the very next turn, even mid-session.
  **Prerequisite fix:** `EvalWorkspace.materializeSkills` memoizes the *first* library
  content per instance (`services/agents/evals/workspace.ts`), silently defeating
  mid-session edits — drop the memo (the existing `existsSync` dedupe suffices) and add
  a regression test (edit a skill → next turn's catalog reflects it). The catalog and
  `loadSkill` bodies are then byte-identical to production because production code
  (`SnapshotSkillSource`) reads the materialized dir.
- **skillsApplied:** nothing new. The model authors it into each component's
  `design.json` under instruction from the working-tree `high-level-architecture`
  skill; the `FileBundle` strict-object write-gate shape-checks it mid-turn with
  self-correction. The only production writer dropped is aep-api's append-only CRT
  annotation pass, which only fires for platform-resource dependencies that don't
  exist locally.
- **Coding agent:** `readSkillsApplied` → `resolveTaskSkills` (injected working-tree
  copy) → `materializeSkills`, all verbatim, fresh per run. Editing a skill and
  re-running the same issue is the tightest loop in the system.
- **Prompts/steering:** system prompts (`prompt.ts`, plugin SKILL.md files) are read
  from source per `tsx` process — edits apply next run. The canned phase prompts are
  shared TS functions and the three live steer strings are provenance-commented copies
  in `engine/compose.ts` (§9) — all plain source, edits apply on the next run.

## 9. Instruction composition — one source for playground and production

The instruction reaching the engineering agent is composed from these pieces (the
console never sends a `useCase`, so every console spec turn runs as `general` and the
server composes `instruction + steeringByUseCase["general"] + collabDepsSteer +
targetSuffix`, `genai_service.go:268-270,394`):

| Piece | Lives in | Used when |
|---|---|---|
| `buildSpecGenerationInstruction(idea)` | `apps/console/src/features/projects/lib/promptStore.ts` | "Generate spec" CTA — wraps the create-prompt idea |
| `buildDesignGenerationInstruction()` | same | "Generate design" CTA — also mints validation criteria |
| free user text | chat panel | every chat turn |
| `steeringByUseCase["general"]` | `genai/steering.go:40` | appended to **every** console turn |
| `collabDepsSteer` | `genai/steering.go:51` | appended to every collab turn — and all console turns are collab turns |
| `targetSuffix(target)` | `genai_service.go:608` | `\n\n(target: X)` when a target is set |
| `planInstruction` + `renderPlanContext(tasks)` | `task/plan.go:46,181-231` | the server-side planner turn (`POST /build`) |

**Do not mirror** the `requirements-generate` / `requirements-chat` /
`design-generate` entries of `steeringByUseCase` or the `design-generate`-gated
requirements check (`genai_service.go:339-346`): no current client sends those
useCases — they are dead paths (flagged for separate platform cleanup, out of this
design's scope).

Sharing plan (**no aep-api changes**):

- Promote the two canned prompt builders out of the console into a shared module
  (e.g. `packages/contracts/prompts/`), imported by **both** the console and the
  playground. One source, no Go involved, hot-editable for iteration.
- The three live Go strings — `general` steer, `collabDepsSteer`, `planInstruction` —
  are **duplicated as verbatim TS constants** in `playground/src/engine/compose.ts`,
  each carrying a provenance comment naming its Go source
  (`// MUST match steeringByUseCase["general"], services/aep-api/internal/feature/genai/steering.go`);
  a reciprocal one-line comment lands on the Go side when convenient. A cheap parity
  test (assert the TS constant appears verbatim in the Go source file) guards drift
  without any build coupling. Extraction to a shared file was considered and rejected
  as overkill for three strings.
- `renderPlanContext`'s rendering is already mirrored by `renderTaskContextFile` (§6),
  round-trip-pinned against the Go renderer.

A prompt-parity fixture test (§14) asserts the fully composed instruction —
canned/free text + general steer + collabDepsSteer + target suffix, and the plan
instruction + context — byte-equals what production composes for the same inputs.

## 10. Documented divergences from production

Pinned in `playground/AGENTS.md` so nobody mistakes them for production behavior:

| Divergence | Why | Parity path |
|---|---|---|
| `issues/` excluded from spec-turn snapshots | production spec turns never see tasks (they live in GitHub) | n/a — this *is* parity in effect |
| MCP off by default | no cluster; avoids a localhost mint attempt per turn | `--mcp` passthrough against a locally running aep-api |
| `collabDepsSteer` present without a live MCP tool | kept for byte parity (all console turns carry it; production local planes can also run steer-without-MCP) | `--mcp` makes the named tool real |
| No CRT-annotation append, no lineage diffs in replans | platform resources don't exist locally | manual edit; replan is still files-based |
| `key` lineage constant `"local"`; no spec/design tags | no builds/tags locally | dedupe across replans still works |
| Design-phase gate is playground-side UX | production has no server gate on the console's design path | n/a — gate is advisory convenience |

## 11. Deliberately dropped production machinery

| Dropped | Why safe for a skills/prompt playground |
|---|---|
| Thunder OIDC / M2M JWKS / per-org keys | in-process boot self-mints an HS256 token against the **real** auth middleware (eval pattern) — the gate code still runs; no tenant boundary exists locally |
| Postgres (conversations, turns, executions) | `ConversationStore` is a first-class seam; one-active-turn is the in-memory `TurnGuard` + a foreground CLI |
| Git, bare mirrors, CAS, one-commit fold, D15 | committed-truth makes a multi-writer distributed system converge; a local dir with one user IS the truth. The cheap half of D14 (manifest sha256 parity) survives as a drift alarm |
| v\<N\> tags + build gate + Temporal devflow | phases are explicit CLI commands; the validation half survives as `play check` (advisory) |
| GitHub issues/labels/webhooks/plan tap | `FsIssueStore` folds the same tool-result frames the tap consumes |
| Execution funnel, "deployed" oracle | ordering survives as an advisory warning from issue frontmatter |
| K8s Job, ExternalSecrets, credhelper/PAT, PR flow | no remotes; PR mechanics are skill prose → replaced by `aep-local` |
| Collab server + flush protocol | single-user terminal; streamed tool cards + post-turn diff replace live co-editing |

Nothing dropped changes the bytes reaching either model — the checkable fidelity claim
(§14).

## 12. Safety

The coding agent runs `bypassPermissions` **outside a container** on a user-chosen
directory (production runs it inside a disposable pod). v1 ships concrete mitigations,
not a banner:

- **Mandatory** pre-run undo snapshot + `play undo` restore (§5 step 2).
- First-run confirmation naming the exact directory, per project.
- Deny-list in the `aep-local` skill: stay inside cwd, never touch `~`, no network
  installs beyond the project's package manager.
- Docs recommend pointing it at a git-tracked scratch project.
- Documented `--docker` hardened path (run the existing runner image with the project
  bind-mounted — the `runners/remote-worker/local/` harness pattern) as the recommended
  follow-up default.
- `ANTHROPIC_API_KEY` from env/`deployments/.env`; never written into project state;
  the runner's progress scrubber already redacts it.
- Path-escape fencing (`resolveWithin`) on every engineering-agent write.

## 13. Implementation plan

| # | Step | Size |
|---|---|---|
| 0a | **Spikes (no cluster, go/no-go for the architecture):** (1) root-level script imports `createApp` via a draft exports map, boots it with `MockLanguageModel`, runs one turn against a temp project dir — proves external importability + the whole §5 engine loop premise before any real code; (2) a `toolset:"task-plan"` mock-model turn with **instruction-carried** context and a scripted `updateTask{issueNumber}` — settles the §5 phase-3 channel (production channel vs files-map fallback) before `FsIssueStore` is built | 0.5d |
| 0b | **Live-env reference capture (the parity oracle):** bring up the local cluster once with `AGENT_DEVTOOLS=true`; run one full production pass (requirements → design → build/plan → one coding task); harvest as committed, dated fixtures: per-phase composed prompts + catalog + instruction (`generations.json`), the plan turn's instruction + `planTask`/`updateTask` frames, the org `_skills` snapshot (diff vs working-tree `skills/` → settles catalog parity), the runner's dispatch env + NDJSON progress log, and one same-instruction non-collab turn to confirm collab/non-collab output equivalence. These fixtures ARE the reference bytes for the §14 prompt-parity tests — without this capture that test has no oracle. Re-capture whenever platform prompts/skills change materially | 1d |
| 1 | **PR 1 (console-touching only, isolated):** promote the console's canned prompt builders (`promptStore.ts` `buildSpecGenerationInstruction`/`buildDesignGenerationInstruction`) to a shared TS module consumed by console + playground. The three live steer strings are NOT extracted — the playground carries provenance-commented verbatim copies + a grep-parity test (§9); **aep-api is untouched**. Dead `steeringByUseCase` entries also untouched (flagged for separate cleanup) | 0.25d |
| 2 | **PR 2 (production-touching, isolated):** `@aep/agents` curated `exports` map (`./server`, `./store`, `./shared/*`, `./evals-kit`, `./playground-kit`); generalize `playground/threads.ts` → path-parameterized `project-fs`; fix the `EvalWorkspace.materializeSkills` memo (+ regression test); **delete the dead `playground/tasks.ts` + `evals/taskplanner/`** (they import a deleted module; nobody should copy them) | 0.5d |
| 3 | Playground skeleton: cli, picker, phase menu, `FsSpecWorkspace`, `FileConversationStore` (atomic tmp+rename; reset stale `status:"active"` on load), `engine/agents-app` + `engine/turn` with manifest parity check; **requirements + chat end-to-end**; `pnpm-workspace.yaml` + turbo wiring | 1.5d |
| 4 | Design phase: gate + composed instruction + derived artifacts + review screen + `play check` (Ajv against the published design schema) | 1d |
| 5 | Tasks phase: TS `renderTaskContextFile` (round-trip tests vs Go fixtures), instruction-carried plan context (verify server-side `updateTask{issueNumber}` resolution; files-map fallback per §5), `FsIssueStore` + plan fold (unit tests against recorded mock-model tool-result frames: ref-by-issueNumber vs ref-by-title, dedupe by key/normalized title, patch semantics, crash-mid-fold writes nothing), tasks screen | 1.5d |
| 6 | remote-worker ports (**production-touching, additive**): `ports.ts` (WorkspaceProvider, SkillLibrarySource), `basePluginPath` + `basePreload` params (defaults byte-identical to today; unit-pinned), `src/local.ts` entry (imports nothing outside the package — remote-worker stays workspace-dep-free for its standalone image), `plugin-local/` `aep-local` skill (shared sections carried VERBATIM + a byte-identity test — factoring into `references/*.md` was rejected during implementation: moving preloaded body content into lazily-loaded references would change production's in-context bytes; plugin-local + local.ts are `.dockerignore`d out of the production image) | 1.5d |
| 7 | Coding-run flow: undo snapshot + restore, spawn + `NdjsonProgressReader` + timeline, `derivedStatus` write-back on exit codes, re-run loop, standalone `code` on a bare specs+issues dir | 1d |
| 8 | Hardening + fidelity: mock-model phase tests (no tokens), **prompt-parity fixture test** (composed system+user prompt byte-equals production for a fixture project), docs (`playground/AGENTS.md` incl. §10 divergences), license headers, root make green | 1d |

Total ≈ **9.5 dev-days**; steps 3–5 and 6–7 parallelize. Step 0 runs first and gates
the rest: 0a failures change the architecture (exports shape / plan-context channel),
0b produces the fixtures every later parity test consumes. Existing code is touched
only by PR 1 (console: a pure move of two prompt builders), PR 2 (services/agents),
and PR 6 (remote-worker) — each independently landable and behavior-preserving by
default. **aep-api is not touched at all.**

## 14. Testing strategy

- **Mock-model phase tests** (`MockLanguageModel`) drive every phase without tokens:
  scripted tool-call streams → assert folded files, issue files, conversation files.
- **Prompt-parity fixture test** — the fidelity claim made falsifiable: for a fixture
  project + skills set, assert the composed system prompt, catalog, and full
  instruction (canned/free text + `general` steer + `collabDepsSteer` + target suffix;
  plan instruction + rendered context) are byte-equal to production's. The reference
  bytes are the step-0b live-env captures (`AGENT_DEVTOOLS` generations), committed as
  dated fixtures and re-captured when platform prompts/skills change.
- **Plan-fold unit tests** against recorded tool-result frames (the `plan_tap.go`
  semantics matrix, §13 step 5).
- **Round-trip pin:** TS `renderTaskContextFile` ↔ `parseTaskContextFile` ↔ Go
  `Render` fixtures.
- **Skill hot-reload regression:** edit a SKILL.md mid-session → next turn's catalog
  reflects it (guards the memo fix).
- **Runner defaults pin:** `basePluginPath`/`basePreload` defaults produce today's
  exact session options.
- **Steer-copy parity test:** each TS steer constant must appear verbatim in its Go
  source file (a read-the-source assertion — no build coupling); plus the
  `aep`/`aep-local` shared-reference identity check.

## 15. Out of scope (v1)

Validation task kind (Playwright image), multi-project org semantics, build/deploy
phases, `--docker` hardened coding runs (documented, deferred), cassette record/replay
integration (natural v2: pipe `streamTurn` through `@aep/sse-cassette` for tokenless
TUI iteration), a web UI.
