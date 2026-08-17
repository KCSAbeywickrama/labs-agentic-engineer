---
name: console-feature
description: Drive a console feature through the issue-driven cycle — grill the idea, create the issue from the outcome, build, ship — with a checkpoint at each stage.
disable-model-invocation: true
argument-hint: <feature idea in plain words, or an existing issue number to resume>
---

# Console feature cycle

Orchestrate the console's issue-driven feature flow. This skill is the
**entry point for frontend feature work**: an idea goes through it — grilled
first, then written up as an issue, then built — never straight into code.
The **spec** is `apps/console/design/development-flow.md` — read it first and
follow its rules and template; this skill only sequences the steps and
checkpoints.

Non-negotiables (from the spec):

- **Grill before the issue exists.** The interview happens on the raw idea;
  the issue is created from its outcome, with the decisions in the body. Do
  not open an issue to "have somewhere to grill".
- Every `gh issue` / `gh pr` command gets `--repo wso2/labs-agentic-engineer`
  — issues and PRs live upstream, never in forks. `gh` auth is required.
- Closed issues and merged PRs are frozen history: never edit or push to
  them. ADRs are the current truth.
- `packages/contracts/api/v1/openapi.yaml` is the **source of truth** for
  the API (issue #76): editing it *is* the contract change. Regenerate with
  the console-scoped gen (`pnpm --filter @aep/console gen`), not root
  `make gen`.
- Stopping at any checkpoint is a normal exit, not a failure. Tell the user
  they can pick the feature back up with `/console-feature <issue-number>`
  once the issue exists — and that stopping mid-grilling means starting the
  interview over, since nothing is recorded yet.

## Checkpoint classes

Three kinds of pause, with different behavior when the user doesn't answer:

- **Hard-wait** — every grilling question and the issue-draft confirmation.
  User input is the entire point: on timeout, re-ask and wait. Never answer
  a grilling question on the user's behalf.
- **Auto-proceed** — the recording stages (ADR graduation, handshake issue,
  PRD in-flight). They only transcribe decisions the user already made:
  offer the checkpoint, and on timeout proceed.
- **Hard gate** — Build and Ship. On timeout or anything short of a clear
  yes, stop the session cleanly and print the resume command. Never build
  or ship on silence.

## Parse the arguments

- A bare number (`42`, `#42`) or issue URL → **resume mode**.
- Anything else → **new-feature mode**, treating the text as the feature
  idea.
- No arguments → ask the user what the feature is, then new-feature mode.

## New-feature mode

1. **Gather context.** Read `apps/console/PRD.md` and the ADRs in
   `apps/console/design/decisions/`. If the idea overlaps existing work,
   check `gh issue list --repo wso2/labs-agentic-engineer --label console
   --label feature` (add `--state closed` for history). The feature must fit
   the product picture or explicitly change it.
2. **Grill the idea** (hard-wait per question). Run the `grill-me` skill on
   the idea itself — no issue exists yet. If it isn't invocable in this
   session, conduct the interview yourself in its spirit: relentless rounds
   of pointed questions (AskUserQuestion) attacking the walkthrough's weak
   points and every unknown until each is decided — never answer one on the
   user's behalf, and on a timeout re-ask rather than defaulting. Keep the
   running outcome (decided / why / rejected) as you go; it becomes the
   issue's Decisions section.
3. **Draft the issue.** Fill the feature-issue body template from the spec
   (Problem / Users / Experience walkthrough / Scope / Decisions / Contract
   changes / States to design / Open questions) from the grilling outcome —
   the walkthrough is the decided version, and Open questions is normally
   empty because the interview closed them. Show the user the full draft —
   title and body — and get an explicit yes before creating anything
   (**hard-wait**).
4. **Create it.** `gh issue create --repo wso2/labs-agentic-engineer
   --label console --label feature` with the agreed title and body. Print
   the issue number, URL, and final body.
5. Continue to the stage walk below, starting at **ADR graduation**.

## Resume mode

1. Fetch the issue and its comments:
   `gh issue view <n> --repo wso2/labs-agentic-engineer --comments`.
   If it's **closed**, stop: the feature shipped (or was abandoned); a
   follow-up needs a new issue.
2. Check for the feature's PR:
   `gh pr list --repo wso2/labs-agentic-engineer --search "<n>" --state all`.
   - PR **merged** → the build round is frozen; new requests become a new
     issue referencing this one. Say so and stop (or offer to draft the
     follow-up issue).
   - PR **open** → feedback lives on the PR; enter the Build stage's
     feedback loop.
3. Otherwise detect the furthest completed stage — ADR in
   `apps/console/design/decisions/`? handshake issue open? in-flight line in
   `apps/console/PRD.md`? contract change, mocks, UI landed? — report what
   you detected, and continue the stage walk from the next incomplete
   stage. If the body has no Decisions section (a pre-grill-first issue, or
   one opened by hand), grill it now and edit the section in before going
   further.

## Stage walk

Work through the stages in order, honoring each one's checkpoint class.
Throughout: while the issue is **open**, edit the body in place
(`gh issue edit`) so it always reflects the current shape of the feature,
Decisions included.

1. **ADR graduation** (auto-proceed). Apply the spec's ADR rule: a decision
   earns an ADR in `apps/console/design/decisions/ADR-NNNN-*.md` only if it
   sets a cross-feature convention, changes the PRD, or rejects a
   re-proposable approach. Feature-local choices stay in the issue's
   Decisions section.
2. **BE handshake** (auto-proceed) — only if the issue's Contract changes
   section is non-empty. Open a separate `aep-api` issue whose body is the
   request: the proposed spec diff, rationale, link to the feature issue.
   The handshake issue must **exist before Build**; explicit BE agreement
   is required **before Ship**, not before Build (mock-mode FE work can't
   break anyone).
3. **PRD in-flight** (auto-proceed). Add one line + issue link to the **In
   flight** section of `apps/console/PRD.md`.
4. **Build** (hard gate to enter).
   - Contract diff in `packages/contracts/api/v1/openapi.yaml` (the source
     of truth) → `pnpm --filter @aep/console gen` → typed MSW mocks covering
     the scenarios from the issue's Decisions section → UI in mock mode
     (`VITE_API_MODE=mock`). Use the `oxygen-ui` skill for all UI work;
     follow `apps/console/design/design-system.md` and
     `apps/console/design/api-guidelines.md`.
   - **PR.** Push a feature branch upstream and open the PR against the
     working branch. Save UI screenshots to a local folder, print their
     paths, and ask the user to drag-and-drop them into the PR — never push
     screenshots to a git branch. Then post a comment on the feature issue
     linking the PR and redirecting all further feedback to the PR — the
     issue stops collecting comments once a PR exists.
   - **Feedback loop.** Review comments on the PR re-enter this stage:
     implement, verify, push. Before *every* push, check
     `gh pr view --json state` — if the PR merged meanwhile, do not push to
     its branch; further changes need a new issue (and its own PR). Contract
     deltas discovered here go to the handshake issue; spec-level changes to
     the feature also update the issue body.
5. **Ship** (hard gate to enter; entry condition: the BE handshake issue is
   agreed and implemented). **Validate the feature** — the validation
   procedure is defined by the user; ask how they want to validate until
   the flow spec defines it. Then move the PRD in-flight line into the
   feature inventory (linking the issue + any ADRs), amend affected PRD
   sections, and close the issue. A feature PR without the PRD update is
   incomplete.
