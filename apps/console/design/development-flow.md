# Console development flow

The cycle every console feature goes through. The point: intent is captured
before code, decisions survive the session that made them, and the PRD stays
true to reality.

```
PRD.md ──(context)──▶ feature.md ──▶ /grill-me ──▶ decisions.md
                                                        │
        needs BE change? ──▶ GitHub issue (spec + handshake)
                                                        │
                                                        ▼
                                       PRD "In flight" entry added
                                                        │
                                                        ▼
  contract diff (OpenAPI) ──▶ make gen ──▶ MSW mocks ──▶ UI build
                                                        │
                                                        ▼
                              smoke vs real BFF ──▶ ship
                                                        │
                                                        ▼
                     PRD: in-flight entry ──▶ feature inventory
```

## Steps

1. **Start a feature.** Create `design/features/<NNN>-<slug>/` from
   `design/features/_template/`. Fill `feature.md`: problem, users, experience
   walkthrough, scope in/out, contract changes, open questions. Read `PRD.md`
   first — the feature must fit the existing product picture or explicitly
   change it.

2. **Grill it.** Run `/grill-me` on the feature doc. The interview attacks the
   experience, scope, and open questions until they hold up. Grilling is
   interactive — the user answers; sessions never default the answers.

3. **Record decisions.** Grilling outcomes go in the feature's `decisions.md`:
   what was decided, why, what was rejected. This is how future sessions
   understand the feature without replaying the debate. Decisions here are
   *intent*; post-ship final-state notes stay in `design/decisions/` ADRs per
   repo convention.

4. **BE handshake via GitHub issue.** If the feature needs new/changed
   `aep-api` endpoints (or existing BE behavior is insufficient), the session
   opens a GitHub issue (`gh issue create`) — **the issue body is the
   request**: proposed OpenAPI change, rationale, link to the feature dir.
   Both sides agree on the issue *before* build starts; the agreed spec lives
   in the issue. FE and BE then send **separate PRs that reference the
   issue** — FE lands the OpenAPI diff in `packages/contracts` + mocks + UI;
   BE implements the same contract on its own schedule. UI is never blocked
   on Go.

5. **Mark it in flight.** Add the feature to the PRD's **In flight** section
   (one line + link). Shipped sections of the PRD are never touched at this
   stage.

6. **Mock it.** Run `make gen`, then add MSW handlers + fixtures in
   `src/mocks/`, typed against the generated client types (contract drift
   fails typecheck, not demos). Cover empty and error scenarios from
   `decisions.md`, not just happy paths.

7. **Build the UI** against mock mode (`VITE_API_MODE=mock`). Follow
   `design-system.md` and `api-guidelines.md`. Playwright/UI tests run against
   mocks.

8. **Ship.** Smoke-verify against the real BFF. Then — required — update
   `PRD.md`: move the In-flight entry into the feature inventory, and amend
   Personas / IA / Non-goals if the feature changed them. A feature PR without
   this PRD update is incomplete.

9. **Post-ship notes.** If the implementation taught something worth an ADR
   (final state, not plans), add it to `design/decisions/` per the repo-wide
   convention.

## Rules of the flow

- No UI feature work without a `feature.md`. Bug fixes and polish are exempt.
- BE requests live **only** in GitHub issues — no request files. A future
  session tracing an endpoint's origin follows the issue link from the
  feature's `decisions.md` (record the issue number there).
- `decisions.md` is append-friendly: superseded decisions get struck through
  with a pointer to the new one, never deleted.
- Feature dirs are permanent — the PRD links to them; don't archive or delete.
- Numbering: `NNN` is a zero-padded sequence (`001-`, `002-`, …).
