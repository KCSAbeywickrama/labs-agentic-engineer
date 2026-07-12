# Worked example — risk register webapp wireframes

A complete `wireframes.dsl` for a three-screen desktop flow. Note the rhythm:
every screen repeats the same `navbar` + `sidebar` (consistent chrome); content
sits right of the sidebar (`x ≥ 280`) and below the navbar (`y ≥ 80`); rows of
cards share a `y` and width; the primary action is the one colored `button`
(`primary`), and status is carried by `badge`s, not prose.

```
// Risk register — three screens, desktop 1280x800

screen RiskDashboard "Managers monitor open risk and act on what's overdue"
  navbar "RiskHub"
  sidebar "Overview | My Risks | All Registers | Audits | Settings"
  heading "Risk Overview" 280,80
  card "Open risks: 24" 280,130 300x110
  card "Overdue actions: 6" 600,130 300x110
  card "High severity: 3" 920,130 300x110
  heading "Recent activity" 280,272
  tabs "All | Mine | Watching" 280,312 480x36
  table "Risk | Owner | Severity | Status | Updated" 280,360 940x220
    row "Unpatched edge servers | Platform team | High | Open | 2h ago"
    row "Stale access keys | Security | Medium | In review | 1d ago"
    row "Vendor SOC2 lapse | Compliance | High | Overdue | 3d ago"
  button "New risk" 1080,80 140x40 primary -> NewRisk

screen NewRisk "An owner logs a new risk into a register"
  navbar "RiskHub"
  sidebar "Overview | My Risks | All Registers | Audits | Settings"
  breadcrumb "Risks / New risk" 280,80
  heading "New Risk" 280,108
  text "Title" 280,158
  input "e.g. Unpatched edge servers" 280,180 640x36
  text "Description" 280,232
  textarea "What is the risk and why does it matter?" 280,254 640x96
  text "Register" 280,372
  select "Infrastructure" 280,394 300x36
  text "Owner" 620,372
  select "Platform team" 620,394 300x36
  text "Impact" 280,450
  select "High" 280,472 300x36
  text "Likelihood" 620,450
  select "Likely" 620,472 300x36
  checkbox "Notify owner on create" 280,532 300x20 active
  button "Cancel" 600,584 140x40
  button "Create risk" 760,584 160x40 primary -> RiskDashboard

screen RiskDetail "The owner tracks remediation for one risk"
  navbar "RiskHub"
  sidebar "Overview | My Risks | All Registers | Audits | Settings"
  breadcrumb "Risks / Unpatched edge servers" 280,80
  heading "Unpatched edge servers" 280,108
  badge "High" 640,114 70x26 danger
  badge "Open" 720,114 70x26 info
  text "Owner: Platform team — Updated 2h ago" 280,152
  avatar "Priya Rao" 280,184 40x40
  text "Priya Rao, Platform team" 332,196
  heading "Remediation" 280,248
  progress "60%" 280,288 640x12 info
  text "6 of 10 actions complete" 280,308
  table "Action | Assignee | Due | Status" 280,344 940x180
    row "Patch kernel CVE-2026-1 | A. Chen | Fri | Done"
    row "Rotate edge certs | M. Diaz | Mon | In progress"
    row "Close inbound 8443 | Platform | Tue | To do"
  button "Update status" 1060,576 160x40 primary
```

Checklist before finishing a wireframe file:

- Every screen from the requirements has a `screen` block; no extras, no
  duplicate takes on the same screen. Where a role changes the view, there's a
  screen per role, named and described for it.
- Every screen has a one-line description saying what it's for.
- Chrome (`navbar`, `sidebar`) is identical across screens of the same app.
- Content stays inside the screen, right of the sidebar, below the navbar;
  rows of cards/inputs share a `y` and width; nothing overlaps.
- Labels are content-bearing ("Open risks: 24", "Platform team", "Overdue"),
  never placeholders like "text" or "label".
- The right primitive does each job — `badge` for status, `tabs` for section
  switching, `avatar` for people, `progress` for completion, `table` + `row`
  for real data.
- Color is rare and meaningful: one `primary` action per screen, plus the odd
  status `badge`. If more than ~3 things are colored, pull some back to gray.
- Navigation is on the control that triggers it: the button/link that leads to
  another screen ends with `-> ScreenName`, and every `-> ScreenName` target
  matches a real `screen`. Leave room to the right of a navigating button.
