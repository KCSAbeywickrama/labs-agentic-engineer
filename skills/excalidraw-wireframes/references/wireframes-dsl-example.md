# Worked example — expense claim webapp wireframes

A complete `wireframes.dsl` for a three-screen employee flow. Note the
rhythm: heading at 16,16; full-width inputs `328x36` stacked with 12px gaps;
list rows as `328x48` rects; the screen's primary action as the bottom-most
button (the compiler attaches the flow marker to it).

```
// Employee expense claims — three screens

screen ClaimList
  text "My Claims" 16,16
  rect "search claims" 16,52 328x36
  rect "Claim: Team offsite — $420 — Approved" 16,100 328x48
  rect "Claim: Client dinner — $180 — Pending" 16,156 328x48
  rect "Claim: Taxi — $32 — Rejected" 16,212 328x48
  button "New claim" 16,480 328x44

screen NewClaim
  text "New Claim" 16,16
  rect "title" 16,52 328x36
  rect "description" 16,100 328x64
  rect "amount" 16,176 156x36
  rect "currency" 188,176 156x36
  rect "receipt upload" 16,224 328x64
  button "Cancel" 16,480 156x44
  button "Submit" 188,480 156x44

screen ClaimDetail
  text "Claim Detail" 16,16
  text "Team offsite — $420" 16,52
  ellipse "status" 300,52 24x24
  rect "line items" 16,92 328x160
  rect "history / audit trail" 16,264 328x120
  button "Back to list" 16,480 328x44

flow
  ClaimList -> NewClaim
  NewClaim -> ClaimList
  ClaimList -> ClaimDetail
  ClaimDetail -> ClaimList
```

Checklist before finishing a wireframe file:

- Every screen from the requirements has a `screen` block; no extras.
- Every element within `0,0`–`360,540`; no overlaps.
- Every screen is reachable in `flow` (no orphan screens), and names in
  `flow` exactly match the `screen` names.
- Labels are content-bearing ("Claim: Taxi — $32 — Rejected"), not
  placeholders ("rect 1") — the wireframe is a communication artifact.
