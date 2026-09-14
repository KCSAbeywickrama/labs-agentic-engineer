# ADR-0032: The Development card reads as the flow — deployed, validated, promoted

- **Status:** Accepted
- **Date:** 2026-09-14 (the Deployments Try-it Flow design, turn 9, artboards
  9a–9c; feature
  [#775](https://github.com/wso2/labs-agentic-engineer/issues/775))
- **Amends:** [ADR-0027](./ADR-0027-deployments-is-an-environment-board.md) —
  decision 1 (the Development card's contents) and decision 6 (the
  Connections card under the ledger, and the Test users panel on the card).
  Decisions 2–5 stand: the ledger, the environment page, "a row is what the
  environment runs NOW", and no contract surface.

## Context

ADR-0027's Development card stated its facts as a pile: the running line,
the verdict banner, the promote button, the test users. Every fact was true
and the card still did not answer the question a reader has the moment a
build merges — *what do I do now, what is still happening, and what comes
next?* The Try-it flow design answers it by drawing the card as the path the
version is on: **deployed → validated → promoted**, top to bottom, with the
one action that matters at each step. It also surfaced a state the page had
no words for: a deployment **on hold** for a connection value, which today
only the Builds page names.

## Decisions

1. **The Development card is a vertical rail of three numbered steps.**
   *Deployed* holds the rollout sentence, the components and the
   connections as two grouped lists, and a primary **Try it now** that opens
   the environment page. *Validation* holds the shared verdict sentence
   (`verdict.ts`, the Validation tile's own words) and a status chip with the
   last known counts; nothing started reads *Runs automatically after
   deployment*. *Promote to Production* holds the promote button with its
   reason, and — once validation allows — one blocker line per connection
   still missing a production value, with Configure inline. A step's mark
   says where the version is: a check for done, a ring for the active step,
   grey for not yet. The rail replaces the banner-plus-button pile; the
   facts are the same facts.

2. **A deployment on hold is said on the Deployments page.** The newest run
   parked at the deploy gate (`MilestoneRunView.state = waiting`,
   `waitingReason = external-values`) is the one read that says a deployment
   is waiting on a value. When it does, the card's chip reads *Waiting for
   configuration*, step 1 reads *Deploy · On hold* with a notice naming the
   value and the component that depends on it (from the design-dependencies
   read the page already makes), Configure opens the development values
   dialog, Try it now is disabled, and steps 2 and 3 are inactive with a
   one-line reason each. Nothing new is fetched for it: the run story is
   `useBuildRuns` on the build version, which the validation evidence hook
   reads already.

3. **Connections live on the cards; the Connections card is retired.** Each
   environment lists its own connections — *Set*, *Provisioned*, *Missing*
   with Configure — beside the components they serve, so the thing that
   blocks a step sits on the step. Development's Configure re-collects dev
   values (the #395 surface, unchanged); Production's Configure opens the
   promote dialog, which is where production values are entered and where
   they stay — page state, because the contract has no promote surface
   (ADR-0027 decision 5 still holds). Promote is disabled until every value
   is set.

4. **Test users move to the environment page.** *Try it now* is captioned
   "Opens the deployment view: app, endpoints, test users", and the panel
   renders there, under the components. The card says where they are rather
   than holding them.

5. **What the design drew and this does not build.** A *Past deployments*
   row (no deployment record — ADR-0027 decision 4, unchanged), a validation
   ETA and a live progress bar (the card would read a second stream for a
   summary the Validation page already gives), per-service endpoint counts
   (a per-component contract read for a caption). Each is left out rather
   than faked.

## Consequences

- `EnvironmentCards` becomes the flow; `ConnectionsCard` is mounted by
  nothing and goes. `DeploymentDetailPage` mounts `ProjectSignInPanel` for
  development. `VerdictBanner` keeps its sentence and its link and moves
  inside step 2.
- The Builds page and the Deployments page now both say *on hold* from the
  same run row, so they cannot disagree about it.
- **No BE handshake.** The feature changes no contract.
