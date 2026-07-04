# Console development flow

Issue-driven (ADR-0001): a feature lives in a **GitHub issue** from idea to
ship. The repo keeps only what must outlive the feature — the PRD, the
guides, and concise ADRs. Console work requires `gh` auth. The
`/console-feature` skill drives this flow end-to-end (with a checkpoint at
each stage); this doc remains the spec it follows.

Issues live in the **upstream** repo — pass
`--repo wso2/labs-agentic-engineer` to every `gh issue` command (working
clones may have a fork as `origin`).

```
PRD.md ──(context)──▶ feature issue ──▶ /grill-me ──▶ decisions comment
                      (labels:                             │
                       console,feature)     durable? ──▶ ADR in design/decisions/
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

1. **Open a feature issue.** `gh issue create` with labels `console` +
   `feature`; the body is the feature doc (template below). Read `PRD.md`
   first — the feature must fit the product picture or explicitly change it.

2. **Grill it.** Run `/grill-me` on the issue. While the issue is **open**,
   edit the body in place so it always reflects the current shape of the
   feature.

3. **Record decisions.** Post the grilling outcome as a **comment** on the
   issue: what was decided, why, what was rejected.

4. **Graduate durable decisions to ADRs** (`design/decisions/ADR-NNNN-*.md`).
   A decision earns an ADR when it **(i)** sets a convention other features
   must follow, **(ii)** changes the PRD, or **(iii)** rejects an approach
   someone would plausibly re-propose. Feature-local choices stay in the
   issue. A superseding ADR marks the old one `Superseded by ADR-NNNN`.

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
   for console work) → typed MSW mocks (cover the scenarios from the
   decisions comment) → UI in mock mode (`VITE_API_MODE=mock`). Follow
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

- **Closed issues and merged PRs are frozen history** — never edited or
  pushed to when later work supersedes them; post-merge requests become a
  new issue referencing the original. **ADRs are the current truth**;
  supersede explicitly.
- Lookup order for any session needing context: **ADRs first**, then
  `gh issue list --repo wso2/labs-agentic-engineer --label console --label
  feature` (and `--state closed` for history).
- No UI feature work without a feature issue. Bug fixes and polish are
  exempt.

## Feature issue body template

```markdown
## Problem
<!-- What's broken or missing for the user. Not the solution. -->

## Users
<!-- Which PRD personas this serves. -->

## Experience walkthrough
<!-- The user's path, step by step. This is what gets grilled. -->

## Scope
**In:**
**Out (explicitly):**

## Contract changes
<!-- aep-api endpoints needed (OpenAPI sketch), or "None". Becomes the BE
     handshake issue (flow step 5). -->

## States to design
<!-- Empty / loading / error / permission states. -->

## Open questions
<!-- Worked through in the grilling. -->
```
