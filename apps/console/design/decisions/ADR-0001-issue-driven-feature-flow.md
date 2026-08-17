# ADR-0001: Issue-driven feature flow

- **Status:** Accepted
- **Date:** 2026-07-03
- **Context:** the original flow kept per-feature `feature.md` + `decisions.md`
  under `design/features/`. Grilled 2026-07-03: feature-local decisions go
  stale and mostly don't matter to other features, while AEP itself develops
  software from issues → coding agents — the console should dogfood that loop
  and get tracking/collaboration for free.

## Decision

- **A feature is a GitHub issue** (labels `console` + `feature`): the body is
  the feature doc; while the issue is open it is edited in place to match the
  current shape of the feature.
- **The issue is born grilled.** The grilling interview runs on the raw idea
  *before* any issue exists, and the issue is created from its outcome — the
  body carries a **Decisions** section (decided / why / rejected) instead of
  the outcome arriving later as a comment. An issue therefore always
  represents a settled feature shape, never a placeholder to grill into.
- **`/console-feature` is the entry point** for frontend feature work: pass
  it the idea, it grills, opens the issue, and drives the build.
- **Closed issues are frozen history** — never edited when superseded.
- **ADRs in `design/decisions/` are the current truth.** A decision graduates
  from the issue's Decisions section to an ADR when it (i) sets a convention
  other features must
  follow, (ii) changes the PRD, or (iii) rejects an approach someone would
  plausibly re-propose. Feature-local choices stay in the issue and may
  fossilize. A superseding ADR marks its predecessor `Superseded by ADR-NNNN`.
- **Lookup order for sessions:** ADRs first, then
  `gh issue list --label console` — console work requires `gh` auth.
- `design/features/` was deleted; its still-live content was distilled into
  ADR-0002…0004. The BE-handshake pattern (separate BE issue, both PRs
  reference it) is unchanged.

## Consequences

- The repo stays lean: guides + PRD + concise ADRs; workflow state lives where
  workflow tooling is (boards, labels, PR links).
- Sessions without `gh` access can't read feature history — accepted; ADRs
  carry everything that must survive.
