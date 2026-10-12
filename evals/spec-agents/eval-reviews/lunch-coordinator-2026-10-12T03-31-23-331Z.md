# Eval review — design-section / lunch-coordinator

- Run: 2026-10-12T03:31:23.331Z
- Transcript: playground/.projects/spec-agent-evals/design-lunch-coordinator.transcript.md
- Raw trace: playground/.projects/spec-agent-evals/design-lunch-coordinator.trace.json

## design — REVIEW (83) · demoted by mustNot

Structural 100%:
- [x] domain-model.md exists
- [x] domain model is one valid erDiagram
- [x] every flow is one valid sequenceDiagram whose participants resolve
- [x] ≥1 component designed
- [x] every design.json valid
- [x] every dependency is a node the cell declares
- [x] design.cell compiles
- [x] openapi.yaml documents valid
- [x] ≥1 acceptance .feature, each with named scenarios that have steps
- [x] every web application has a prototype that passes the kit check
- [x] decisions.md: one tagged line per decision, naming its features
- [x] gap check only adds *assumed* lines and open questions to the requirements
- [x] artifacts written in lineup order (acceptance tests last)
- [x] no form question asked during design
- [x] the closing names the next step on the Design card
- [x] section completed

Rubric judge 67%:
- [x] (w2) A web frontend component and a backend/API component are both designed
  - design.cell defines lunch-webapp (web-application) and lunch-api (service); each has a design.json.
- [x] (w1) Sign-in is single sign-on through the platform identity provider (the organization's settled default), with the team's existing company accounts; no local accounts, passwords or credential store
  - Both components depend on user-auth (thunder-app); design.cell has 'Thunder Auth' identity-server; the webapp holds no credentials beyond OIDC client config; no local accounts or credential store. The added requirement line mentions company Google Workspace accounts, which is consistent with SSO.
- [x] (w1) The API models the order-round lifecycle including the cutoff lock
  - The Round has status open/closed, cutoffAt, closedAt. The API refuses adds and edits once the round is closed (400 'This round is closed'), has a close-early endpoint, and an automatic close at the cutoff (decisions.md scheduled check).
- [x] (w1) Slack is an external dependency with its own definition, and the design notifies the team's channel when a round opens and at the cutoff
  - dependency.json for slack-service with provider Slack, config and contract; lunch-api lists it as an external dependency; flows/open-and-notify.md posts on open and on close at the cutoff.
- [x] (w1) Consolidated/grouped order view with per-person totals is designed
  - The ConsolidatedOrder schema has groupedByItem and perPerson totals; the getConsolidatedOrder endpoint; the prototype's RoundDetail shows grouped items and per-person totals.
- [ ] (w2) The web app's prototype (prototype.json + prototype.tsx) draws opening a round (restaurant, cutoff), a teammate adding, editing and removing their own items before the cutoff, the round locked after the cutoff, and the opener's consolidated order grouped by menu item with per-person totals
  - The prototype covers opening a round (restaurant, cutoff) and adding, editing and removing own items on the open round. It shows the consolidated order grouped by item with per-person totals on the round detail screen for any teammate, not framed as the opener's view. There is no locked-after-cutoff state: no screen or state shows a round locked with add/edit disabled, and there is no state for a round locked after the cutoff. The closed round only appears in history/detail.
- [ ] (w1) specs/design/decisions.md holds only technical choices a product user would not notice (storage, paging, where a check runs), one line each, tagged with the artifact it shapes (architecture, data-model, security, flows) or a component's name, and naming the features it serves (or all); it restates no requirement line and lists no organization default (the stack, the sign-in provider) as a decision
  - decisions.md is one line per decision with tags, but entries are tagged with feature IDs (F1, F2) rather than feature names. It includes a [security] row that restates a requirement ('A teammate reaches their own item edits only on the item they created'), and the 50-per-page decision conflicts with the OpenAPI default of 20 per page. Several lines restate product behavior, such as one open round at a time.
- ⛔ mustNot violated: A requirements line the run added that widens the PRD's scope (a new feature, a new actor, or an integration the PRD does not have)
  - The added line 'Anyone who signs in with a company Google Workspace account is automatically a Teammate; there is no separate admin enrollment step' introduces a Google Workspace identity assumption and self-service enrolment not in the PRD. The other added lines (cutoff later than open time, quantity validation, Slack failure handling) are elaborations.

Inventions flagged (unscored — human call):
- Past rounds history screen and flow (flow.view-history) as a dedicated feature
- Early close of a round by its opener (close-early endpoint, rounds:close permission)
- Only one open round at a time constraint
- Google Workspace as the account source, and self-service enrolment in security.json
- Grand total and cost totals (money amounts, prices) in the consolidated order
- Round notes field
- Account and signed-out screens

## Human verdict

- [ ] Agree with the bands above
- [ ] Override: <section> should be <band> because …

Notes:

