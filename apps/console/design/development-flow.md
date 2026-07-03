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
  contract diff ──▶ make gen ──▶ mocks ──▶ UI build ──▶ smoke vs real BFF
                                                           │
                                                           ▼
                            ship: PRD inventory row ──▶ close the issue
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

5. **BE handshake (unchanged).** New/changed `aep-api` behavior gets its own
   GitHub issue whose body is the request (proposed OpenAPI change,
   rationale, link to the feature issue). Both sides agree there before
   build; FE and BE send separate PRs referencing it.

6. **Mark it in flight.** One line + issue link in the PRD's **In flight**
   section.

7. **Build.** Contract diff in `packages/contracts/api/v1/openapi.yaml` →
   `make gen` → typed MSW mocks (cover the scenarios from the decisions
   comment) → UI in mock mode (`VITE_API_MODE=mock`). Follow
   `design-system.md` and `api-guidelines.md`.

8. **Ship.** Smoke-verify against the real BFF. Move the PRD In-flight line
   into the feature inventory (linking the issue + any ADRs), amend affected
   PRD sections, **close the issue**. A feature PR without the PRD update is
   incomplete.

## Rules

- **Closed issues are frozen history** — never edited when later work
  supersedes them. **ADRs are the current truth**; supersede explicitly.
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
