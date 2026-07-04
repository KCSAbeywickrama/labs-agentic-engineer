---
name: console-feature
description: Drive a console feature through the issue-driven cycle — create the issue, grill it, record decisions, build, ship — with a checkpoint at each stage.
disable-model-invocation: true
argument-hint: <feature idea in plain words, or an existing issue number to resume>
---

# Console feature cycle

Orchestrate the console's issue-driven feature flow. The **spec** is
`apps/console/design/development-flow.md` — read it first and follow its
rules and template; this skill only sequences the steps and checkpoints.

Non-negotiables (from the spec):

- Every `gh issue` command gets `--repo wso2/labs-agentic-engineer` — issues
  live upstream, never in forks. `gh` auth is required.
- Closed issues are frozen history: never edit one. ADRs are the current
  truth.
- Stopping at any checkpoint is a normal exit, not a failure. Tell the user
  they can pick the feature back up with `/console-feature <issue-number>`.

## Parse the arguments

- A bare number (`42`, `#42`) → **resume mode**.
- Anything else → **new-feature mode**, treating the text as the feature
  idea.
- No arguments → ask the user what the feature is, then new-feature mode.

## New-feature mode

1. **Gather context.** Read `apps/console/PRD.md` and the ADRs in
   `apps/console/design/decisions/`. If the idea overlaps existing work,
   check `gh issue list --repo wso2/labs-agentic-engineer --label console
   --label feature` (add `--state closed` for history). The feature must fit
   the product picture or explicitly change it.
2. **Draft the issue.** Fill the feature-issue body template from the spec
   (Problem / Users / Experience walkthrough / Scope / Contract changes /
   States to design / Open questions). Show the user the full draft — title
   and body — and get an explicit yes before creating anything.
3. **Create it.** `gh issue create --repo wso2/labs-agentic-engineer
   --label console --label feature` with the agreed title and body. Print
   the issue number, URL, and final body.
4. Continue to the stage walk below, starting at **Grill**.

## Resume mode

1. Fetch the issue and its comments:
   `gh issue view <n> --repo wso2/labs-agentic-engineer --comments`.
   If it's **closed**, stop: the feature shipped (or was abandoned); a
   follow-up needs a new issue.
2. Detect the furthest completed stage:
   - decisions comment posted on the issue?
   - in-flight line in `apps/console/PRD.md`?
   - contract change in `packages/contracts/api/v1/openapi.yaml`, mocks in
     `apps/console/src/mocks/`, UI code landed?
3. Report what you detected and continue the stage walk from the next
   incomplete stage.

## Stage walk

Work through the stages below in order. **Between stages, checkpoint with
AskUserQuestion**: continue to the next stage, or stop here (offer the
resume command). Skip a checkpoint only when the user already told you how
far to go.

1. **Grill.** Run the `grill-me` skill on the issue. If it isn't invocable
   in this session, conduct the interview yourself in its spirit: relentless
   rounds of pointed questions (AskUserQuestion) attacking the walkthrough's
   weak points and every Open question until each is decided — never answer
   one on the user's behalf, and on a timeout re-ask rather than defaulting.
   While the issue is open, edit the body in place (`gh issue edit`) so it
   always reflects the current shape of the feature.
2. **Decisions comment.** Post the grilling outcome as a comment on the
   issue: what was decided, why, what was rejected.
3. **ADR graduation.** Apply the spec's step-4 rule: a decision earns an ADR
   in `apps/console/design/decisions/ADR-NNNN-*.md` only if it sets a
   cross-feature convention, changes the PRD, or rejects a re-proposable
   approach. Feature-local choices stay in the issue.
4. **BE handshake** — only if the issue's Contract changes section is
   non-empty. Open a separate `aep-api` issue whose body is the request
   (proposed OpenAPI change, rationale, link to the feature issue). Both
   sides agree there before building; FE and BE ship separate PRs
   referencing it.
5. **PRD in-flight.** Add one line + issue link to the **In flight** section
   of `apps/console/PRD.md`.
6. **Build.** Contract diff in `packages/contracts/api/v1/openapi.yaml` →
   `make gen` → typed MSW mocks covering the scenarios from the decisions
   comment → UI in mock mode (`VITE_API_MODE=mock`). Use the `oxygen-ui`
   skill for all UI work; follow `apps/console/design/design-system.md` and
   `apps/console/design/api-guidelines.md`.
7. **Ship.** Smoke-verify against the real BFF. Move the PRD in-flight line
   into the feature inventory (linking the issue + any ADRs), amend affected
   PRD sections, close the issue. A feature PR without the PRD update is
   incomplete.
