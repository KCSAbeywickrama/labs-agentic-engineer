# Worked example — risk register webapp wireframes

A complete `wireframes.dsl` for a three-screen desktop flow. Note the rhythm:
every screen repeats the same `navbar` + `sidebar` (consistent chrome); blocks
stack in reading order; `row` groups things side by side; the primary action is
the one `primary` button per screen; status is carried by `badge`s, not prose.
No coordinates anywhere — the compiler computes every position.

```
// Risk register — three screens, desktop

screen RiskDashboard "Managers monitor open risk and act on what's overdue"
  navbar "RiskHub"
  sidebar "Overview | My Risks | All Registers | Audits | Settings"
  row
    heading "Risk Overview"
    right
    button "New risk" primary -> NewRisk
  row
    card "Open risks | 24 | across 6 registers"
    card "Overdue actions | 6 | need follow-up"
    card "High severity | 3 | review this week"
  heading "Recent activity"
  tabs "All | Mine | Watching"
  table "Risk | Owner | Severity | Status | Updated" -> RiskDetail
    row "Unpatched edge servers | Platform team | High | Open | 2h ago"
    row "Stale access keys | Security | Medium | In review | 1d ago"
    row "Vendor SOC2 lapse | Compliance | High | Overdue | 3d ago"

screen NewRisk "An owner logs a new risk into a register"
  navbar "RiskHub"
  sidebar "Overview | My Risks | All Registers | Audits | Settings"
  breadcrumb "Risks / New risk"
  heading "New Risk"
  input "Title — e.g. Unpatched edge servers"
  textarea "What is the risk and why does it matter?"
  row
    select "Register: Infrastructure"
    select "Owner: Platform team"
  row
    select "Impact: High"
    select "Likelihood: Likely"
  checkbox "Notify owner on create" active
  row
    right
    button "Cancel"
    button "Create risk" primary -> RiskDashboard

screen RiskDetail "The owner tracks remediation for one risk"
  navbar "RiskHub"
  sidebar "Overview | My Risks | All Registers | Audits | Settings"
  breadcrumb "Risks / Unpatched edge servers"
  row
    heading "Unpatched edge servers"
    badge "High" danger
    badge "Open" info
  text "Owner: Platform team — Updated 2h ago"
  split 60/40
    left
      heading "Remediation"
      progress "60%" info
      text "6 of 10 actions complete"
      table "Action | Assignee | Due | Status"
        row "Patch kernel CVE-2026-1 | A. Chen | Fri | Done"
        row "Rotate edge certs | M. Diaz | Mon | In progress"
        row "Close inbound 8443 | Platform | Tue | To do"
      row
        right
        button "Update status" primary
    right
      card "Discussion"
        text "K. Smith · 2d: when does the cert rotation land?"
        text "M. Diaz · 1d: Monday, after the freeze."
        textarea "Add a comment…"
        button "Post" primary
      heading "Activity"
      text "2h ago — A. Chen closed CVE-2026-1"
      text "1d ago — M. Diaz started cert rotation"
```

Checklist before finishing a wireframe file:

- Every screen from the requirements has a `screen` block; no extras, no
  duplicate takes on the same screen. Where a role changes the view, there's a
  screen per role, named and described for it.
- Every screen has a one-line description saying what it's for.
- Chrome (`navbar`, `sidebar`) is identical across screens of the same app.
- Labels are content-bearing ("Open risks | 24 | across 6 registers",
  "Platform team", "Overdue"), never placeholders like "text" or "label".
- The right primitive does each job — `badge` for status, `tabs` for section
  switching, `avatar` for people, `progress` for completion, `table` + `row`
  for real data.
- Color is rare and meaningful: one `primary` action per screen, plus the odd
  status `badge`.
- Navigation is on the control that triggers it: the button/link/table that
  leads to another screen ends with `-> ScreenName`, and every target matches
  a real `screen`.
- NO coordinates and no manual sizes unless an element truly needs one — the
  layout comes from stacking, `row`, and `split`.
