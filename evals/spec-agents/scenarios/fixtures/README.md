# Captured-then-curated fixtures (#356)

Each directory is a frozen `specs/` state a section-alone scenario starts
from. Provenance: produced by one real run of the upstream section, then
reviewed and hand-tuned before freezing. Refreshing a fixture is a conscious
event — re-run the upstream section, re-curate, re-freeze — never silent
drift.

- `lunch-coordinator-requirements/` — requirements output of the
  `req-lunch-coordinator` run (2026-08-02), curated: Slack open/cutoff
  notifications moved from out-of-scope into scope (the interview had not
  elicited them; the brief wants them). Hand-converted on 2026-09-30 to the
  feature-file layout (`skills/prd-contract`): the same content as a product
  page, four feature files and `product-wide.md`.
- `expense-tracker-requirements/` — the Expense Tracker PRD from the
  generated-app scopes design (its P6 spec bundle,
  `docs/design/draft/spikes/artifacts/p6-project/`), not a captured run: two
  actors, seven stories, and an own-rows-vs-every-row permission split, so the
  design section's security step has something to catalog. Hand-converted on
  2026-09-30 to the feature-file layout: stories 1–7 became F1.1–F1.3,
  F2.1–F2.3 and F3.1.
- `lunch-coordinator-design/` — design output of the `design-lunch-coordinator`
  run (2026-10-11, the design-loop lineup, pass band 83), frozen as produced:
  the requirements with the gap check's `*assumed*` lines, `lunch-api` +
  `lunch-webapp` (its prototype, no wireframes), the Slack dependency with its
  contract and assumptions, design.cell, domain model, security.json,
  decisions.md, one flow and one acceptance file per feature. That run wrote
  the Slack contract during the architecture, ahead of the lineup's
  Dependencies step; the files themselves are sound.
- `expense-tracker-design/` — design output of the `design-expense-tracker`
  run (2026-10-11, the design-loop lineup, pass band 95), frozen as produced:
  the requirements with the gap check's `*assumed*` lines, `expense-api` +
  `expense-webapp` (its prototype, no wireframes), each citing F1.1–F3.1,
  design.cell, domain model, security.json, decisions.md and one acceptance
  file per feature. The tasks scenario of the same name plans from it with a
  v1 scope naming all three features, and the address-comments scenario
  reviews it.
