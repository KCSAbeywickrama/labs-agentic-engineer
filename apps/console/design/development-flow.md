# Console development flow

Issue-driven (ADR-0001): a feature lives in a **GitHub issue** from the
moment it's been grilled until it ships. The repo keeps only what must
outlive the feature — the PRD, the guides, and concise ADRs. Console work
requires `gh` auth.

**Start every frontend feature with the `/console-feature` skill** — pass it
the idea in plain words. It runs the grilling interview, opens the feature
issue from the outcome, and then drives the build with a checkpoint at each
stage. This doc remains the spec it follows.

Issues live in the **upstream** repo — pass
`--repo wso2/labs-agentic-engineer` to every `gh issue` command (working
clones may have a fork as `origin`).

```
PRD.md ──(context)──▶ /console-feature <idea> ──▶ grilling interview
                                                           │
                                    (decided shape) ──▶ feature issue
                                                        (labels:
                                                         console,feature)
                                                           │
                                        durable? ──▶ ADR in design/decisions/
                                                           │
        needs BE change? ──▶ separate BE issue (handshake) │
                                                           ▼
                                          PRD "In flight" line (issue link)
                                                           │
   contract diff ──▶ console gen ──▶ mocks ──▶ UI build ──▶ PR
                                                           │
                            feedback loop: review ⇄ push (on the PR)
                                                           │
                                                        merge (PR frozen)
                                                           │
                                                           ▼
        ship: validate ──▶ PRD inventory row ──▶ close the issue
```

## Steps

1. **Grill the idea.** Before any issue exists, run `/grill-me` on the raw
   idea (the `/console-feature` skill does this for you). Read `PRD.md` and
   the ADRs first — the feature must fit the product picture or explicitly
   change it. Every open question is decided by the developer in the
   interview, never answered on their behalf.

2. **Open the feature issue.** `gh issue create` with labels `console` +
   `feature`; the body is the feature doc (template below), filled from the
   grilling outcome — including the **Decisions** section: what was decided,
   why, what was rejected. The issue is born grilled: it exists only once
   the shape of the feature is settled.

3. **Keep it current.** While the issue is **open**, edit the body in place
   so it always reflects the current shape of the feature, Decisions
   included. The issue tracks the **end state**, not the history of getting
   there — superseded rationale is overwritten, and anything that must
   survive that becomes an ADR (step 4).

4. **Graduate durable decisions to ADRs** (`design/decisions/ADR-NNNN-*.md`).
   A decision earns an ADR when it **(i)** sets a convention other features
   must follow, **(ii)** changes the PRD, or **(iii)** rejects an approach
   someone would plausibly re-propose. Feature-local choices stay in the
   issue's Decisions section. A superseding ADR marks the old one
   `Superseded by ADR-NNNN`.

5. **BE handshake.** New/changed `aep-api` behavior gets its own GitHub
   issue whose body is the request (proposed spec diff, rationale, link to
   the feature issue). The handshake issue must **exist before build**;
   explicit BE agreement is required **before ship**, not before build —
   mock-mode FE work can't break anyone, and the FE PR makes the contract
   discussion concrete. FE and BE send separate PRs referencing it.

6. **Mark it in flight.** One line + issue link in the PRD's **In flight**
   section.

7. **Build.** Contract diff in `packages/contracts/api/v1/openapi.yaml` —
   the spec is the **source of truth** for the API (see #76); editing it
   *is* the contract change — → `pnpm --filter @aep/console gen` (console-
   scoped; root `make gen` regenerates every Go module and is never needed
   for console work) → typed MSW mocks (cover the scenarios from the issue's
   Decisions section) → UI in mock mode (`VITE_API_MODE=mock`). Follow
   `design-system.md` and `api-guidelines.md`.

   **The PR is where the build lives from here.** Open it upstream, attach
   the feature's screenshots to it (drag-and-drop by a human — screenshots
   are never pushed to git branches), and post a comment on the feature
   issue linking the PR: from that point all feedback belongs on the PR,
   not the issue. Review comments loop back into this step (implement →
   verify → push). A **merged PR is frozen** — anything requested after
   merge becomes a new issue referencing the original.

8. **Ship.** Entry condition: the BE handshake issue is agreed and
   implemented. **Validate the feature** (the validation procedure is
   defined per-feature by the developer for now — a fixed procedure will be
   specified here later). Then move the PRD In-flight line into the feature
   inventory (linking the issue + any ADRs), amend affected PRD sections,
   **close the issue**. A feature PR without the PRD update is incomplete.

## Rules

- **`/console-feature` is the entry point** for frontend feature work — an
  idea goes through the skill (grill → issue → build), not straight into
  code.
- **Closed issues and merged PRs are frozen history** — never edited or
  pushed to when later work supersedes them; post-merge requests become a
  new issue referencing the original. **ADRs are the current truth**;
  supersede explicitly.
- Lookup order for any session needing context: **ADRs first**, then
  `gh issue list --repo wso2/labs-agentic-engineer --label console --label
  feature` (and `--state closed` for history).
- No UI feature work without a grilled feature issue. Bug fixes and polish
  are exempt.

## Feature issue body template

Filled from the grilling outcome — the issue is created after the interview,
not before it.

```markdown
## Problem
<!-- What's broken or missing for the user. Not the solution. -->

## Users
<!-- Which PRD personas this serves. -->

## Experience walkthrough
<!-- The user's path, step by step. The grilled, decided version. -->

## Scope
**In:**
**Out (explicitly):**

## Decisions
<!-- The grilling outcome: what was decided, why, what was rejected.
     Durable ones graduate to ADRs (flow step 4). -->

## Contract changes
<!-- aep-api endpoints needed (OpenAPI sketch), or "None". Becomes the BE
     handshake issue (flow step 5). -->

## States to design
<!-- Empty / loading / error / permission states. -->

## Open questions
<!-- Anything the grilling deliberately left open, with why. Empty is the
     normal case — open questions are what the interview closes. -->
```
