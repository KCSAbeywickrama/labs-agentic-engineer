# AGENTS.md — skills/

The platform's **one authored skill library**. Every skill any AEP agent loads is
a directory here: `<name>/SKILL.md` plus whatever it ships beside it
(`references/`, `assets/`, `scripts/`).

Two consumers read this directory, and neither one vendors a copy:

| Consumer | How it gets here | What it takes |
|---|---|---|
| `aep-api` (the BFF) | image path `/app/skills` (`COPY --from=skills`), read at runtime | seeds + reconciles **every** skill into each org's `org-skills` git repo, which is the live store the design-time agents and the console read |
| the coding runner | image path `/app/skills` (same named build context) | assembles a session plugin from an explicit **subset** — `aep`, `aep-validation`, `playwright-cli` (`runners/remote-worker/src/lib/base_plugin.ts`) |

Both paths are bind-mounted from the working tree in dev (`setup-k3d.sh` for the
cluster, `pnpm play` for the playground), so **a skill edit needs no rebuild**.

## Kinds — `metadata.aep.kind` in frontmatter

An absent kind means `org`, which is a real decision, not a default to lean on:

- **`platform`** — AE-owned, read-only in the console. The design-flow skills
  (`design`, `start`, `grilling`, `task-planning`, `task-breakdown`,
  `high-level-architecture`, `cell-architecture-dsl`, `openapi-conventions`,
  `excalidraw-wireframes`, `validation-criteria`) and the runner's own workflow
  skills (`aep`, `aep-validation`, `playwright-cli`).
- **`org`** — the org-visible stack skills (`go`, `ballerina`, `react-webapp`,
  `api-management`, `thunder-authentication`). Editable and deletable by an org.

Kind decides console visibility and who may edit a skill. It decides **nothing
about loading**: a component's `design.json` may attach a skill of any kind via
`skillsApplied` (the architect attaches `openapi-conventions` and
`excalidraw-wireframes`, both `platform`), and every attached skill reaches a
coding session the same way — listed, then loaded on demand. `org` used to buy a
preloaded body; it no longer does, so a run's startup context does not grow with
the number of components a project designed.

Kind is not a visibility switch either. **Every skill here is listed in the
design-time catalog** (name + description; the body only arrives on `loadSkill`),
so a description is what decides whether an agent loads a skill it shouldn't —
**and now, whether it loads one it should**. Write it to name the trigger:
`aep`'s says "Load when working a CODING run … never loaded to author specs/",
and `ballerina`'s says "Apply when a component's `language` is Ballerina. For a
Go service, use `go` instead." A description like "Conventions for writing Go
applications" names no trigger and is a defect — that one was `go`'s, and it was
invisible for as long as `go` was preloaded regardless.

## Who owns what

- **`aep` is the umbrella**, and it is split by reader. `SKILL.md` is the **run**
  (start the cycle → work the issues → finish) and only the lead ever reads it.
  The platform contract every component obeys — App Path, port, config + error
  shape, CORS ownership, how a dependency's contract is found, green, and the
  rails that bind anyone touching the filesystem — is
  `references/component-contract.md`. That file is what a **fan-out subagent**
  reads: it gets its contract from its prompt, never by loading this skill, so
  the fan-out section names the file and a rule that is not in it does not reach
  an implementer. The lead reads it too, for inline work and for authoring
  `workload.yaml` (whose format is `references/workload-and-wiring.md`).
- **Stack skills own only their stack**: layout, `Dockerfile`, libraries, the
  verify command, their own pitfalls. Restating a platform-contract rule in a
  stack skill is a defect — it is preloaded context paid twice, and the two
  copies drift (a live example: the deny-list once banned CORS middleware
  outright while `go` required it for an unmanaged service). A cross-stack
  *practice* ("read config in one place at startup") is the contract's; **which
  file it lands in** is the stack skill's.
- Inside `aep`, the tie-break: a rule naming `git`/`gh`/an issue/a PR belongs to
  `SKILL.md`; one naming a path, a file or an env var belongs to the component
  contract. The contract is stated as information rather than a build procedure,
  so it reads the same for a component's first line and for a change to one that
  shipped weeks ago.
- Niche material only some runs need goes to `references/`, not into a body.
- **Every reference is mode-neutral.** The assembler copies a skill's whole
  directory into both modes' plugins and overlays only `SKILL.md`, so a
  reference reaches a playground session byte-identical — and the `aep` skill
  lets an agent read its own `references/`. Mode-specific text therefore stays
  in `SKILL.md` even when it is long (the branch-identity procedure is there for
  this reason alone). `base_plugin.test.ts` fails on platform mechanics in a
  reference, so this is caught at CI, not in a local run.
- **Instructions are as short as they can be and stay unambiguous.** State the
  rule and the failure it prevents; the maintainer's history behind it goes in
  this file or an ADR, not into every run's context.

## `overlays/` — how local mode is made

`skills/aep/overlays/local.md` turns the `aep` skill into the playground's
local-mode workflow (a plain project dir, `issues/*.md`, no remote, no PR). The
authored `SKILL.md` is the **platform** run, with no mode markup in it; the
overlay is a list of anchored edits the runner applies when it assembles a
session for `mode: "local"`. Grammar and rationale: the overlay's own header, and
`runners/remote-worker/design/decisions/ADR-0004-library-owned-workflow-skills.md`.

Three things to know before touching either file:

1. **`overlays/` is compose-time input, not skill content.** The assembler never
   copies it into a session, and `aep-api`'s `loadLibrary` never seeds it. Both
   are pinned by tests; don't route new content through it.
2. **Every anchor must match exactly once, or the run fails at startup.** That is
   deliberate: a silently-missed anchor would leave the platform's `gh`/PR
   procedure in a local session. If you reword a passage the overlay anchors,
   the playground breaks loudly and you re-anchor it.
3. **The platform text is the trunk.** Overlay a passage only when the unmodified
   version would make a local run attempt something impossible. Prose that
   exists in both files is the cost being controlled — `base_plugin.test.ts`
   caps it, and the cap only ratchets down. Reading an inert paragraph is far
   cheaper than maintaining a second copy of it.

## Running a runner skill by hand

`make runner-plugin` assembles the base plugin into
`runners/remote-worker/.plugin-dev` (git-ignored) — the same assembler a session
runs, so there is no second copy to drift. Then
`claude plugin install <printed path>`, and use your own `gh auth login`; the
workflow is the platform's. `MODE=local make runner-plugin` gives the
playground's composed body instead.

## Conventions

- The directory name and the frontmatter `name:` must match — `loadLibrary`
  warns and **skips** a mismatch, so the skill silently disappears from every org.
- Keep a description to one sentence that names when to load the skill, not what
  it contains. It is the only part of a skill most agents ever see.
- A skill is prose for a model, so the usual writing rules apply harder: state
  the rule and the reason it exists, never both halves of a choice.
