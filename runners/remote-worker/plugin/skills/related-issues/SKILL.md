---
name: related-issues
description: Load alongside the aep skill on every dispatched component task. Before implementing, search the repo's GitHub issues for others related to the same root cause/component and cross-link them with a short comment on each. Matters most for issues filed ad-hoc by an external system (e.g. the OpenChoreo SRE/RCA agent handoff) that has no visibility into the codebase or issue history — this skill is what actually looks into the repo on its behalf. Does not affect the PR workflow, deny-list, or workload.yaml conventions defined in the aep skill.
---

# Related-issue discovery

External callers that file issues against this repo — most notably the
OpenChoreo SRE/RCA agent, which creates an issue when a root cause needs a
code change — cannot see this repo's code or its open/closed issue history.
They know only what their own telemetry showed. Before you start
implementing, spend a couple of `gh` calls closing that gap: find other
issues about the same underlying problem and link them together so a human
reviewer sees the full picture, not just one report of it.

## When to run this

Right after "Find the issue" in the `aep` skill's workflow (step 1), before
creating your feature branch. Always run it — even if the issue looks
self-contained, a quick search costs one `gh` call and duplicate/overlapping
issues are common when multiple alerts fire for the same underlying defect.

## How to search

You're already in a clone of the repo, so `gh issue list --search` searches
this repo by default — no `--repo` flag needed.

```bash
# Pull a few keywords from the issue title/body: component name, error
# type, symptom (e.g. "timeout", "OOMKilled", "nil pointer").
gh issue list --search "<keyword1> <keyword2>" --state all \
  --json number,title,body,url,state
```

Try 1-2 keyword variations if the first search returns nothing obviously
relevant — issue titles vary in wording even for the same root cause. Don't
over-search; this is a discovery pass, not the main task.

## Judging relevance

An issue is "related" when it plausibly shares the same root cause or the
same affected component — not merely the same repo or a superficially
similar word. Skip issues that just happen to mention the same component
name for an unrelated reason. When unsure, err toward NOT linking — a wrong
link is more confusing than a missed one.

## Cross-linking

For each genuinely related issue you find (open OR closed — a closed one
may be a recurrence):

```bash
gh issue comment <current-issue-number> --body \
  "Related: #<related-issue-number> — <one-line reason, e.g. 'same OOMKilled root cause in the same component'>"

gh issue comment <related-issue-number> --body \
  "Related: #<current-issue-number> — <one-line reason>"
```

Post both comments (current → related, and related → current) so either
issue's viewer sees the connection. Keep the reason to one line — this is a
pointer, not a duplicate analysis.

## Constraints

- Read-only + comment-only on other issues. Never close, reopen, edit the
  body of, or add/remove labels on an issue other than the one you were
  dispatched to work.
- Do not let this block or meaningfully delay implementation — if the search
  turns up nothing, comment nothing and move on to the `aep` skill's
  workflow step 2.
- This skill does not change anything about your own issue's workflow,
  PR requirements, or the deny-list — those are defined in the `aep` skill
  and still apply in full.
