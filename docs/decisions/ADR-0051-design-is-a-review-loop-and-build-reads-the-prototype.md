# ADR-0051 — Design is a review loop, and Build reads the prototype

**Status:** Accepted · 2026-10-11
**Amends:** [ADR-0042](ADR-0042-a-prototype-is-react-on-a-fixed-kit-in-a-sandbox.md)
(the prototype is made inside Design and is what Build reads; its comments no
longer ride a `/prototype` turn),
[ADR-0025](ADR-0025-a-web-application-is-verified-before-it-is-committed.md)
(the mock walk's map is the prototype),
[ADR-0033](ADR-0033-screen-gates-derive-from-operations.md) points 4 and 7
(public screens; the `wireframes` skill),
[ADR-0040](ADR-0040-a-design-goes-out-of-date-per-feature.md) decision 3 (a
design run's basis is read where it ended),
[ADR-0050](ADR-0050-a-version-builds-as-one-issue-with-an-ordered-checklist.md)
(a web application's prototype is required at the build gate, not optional).
**Reverses:** the rejected alternative "Replace the wireframes with the
prototype" of "ADR-0034 — A web application is reviewed as a prototype after
design, alongside its wireframes", which exists only on the unmerged branch
`feat/813-prototype-stage` (on main, ADR-0034 is the revalidation ADR).
**Related:** [ADR-0052](ADR-0052-a-designs-review-state-is-a-file-in-the-spec-repo.md)
(where comments and checks live),
[ADR-0050](ADR-0050-a-version-builds-as-one-issue-with-an-ordered-checklist.md)
(one build issue per version; the coding run reads the prototype as its UI
contract),
[console ADR-0005](../../apps/console/design/decisions/ADR-0005-the-design-card-reviews-the-designs-files.md)
(the Design card).

## Context

Design drew each web application as `wireframes.dsl`, and Build coded its
screens from that file. The prototype came later and was optional (Make
prototype, `/prototype`). Only the reviewer saw it. So a web application had
two pictures that could disagree, and the one the user reviewed was not the
one Build read. Feedback reached the agent by two routes: prototype comments
as a typed `prototypeFeedback` batch on a prototype-only turn, and everything
else as chat. A design run also asked its questions as forms in the middle of
the run. The choices nobody asked about went to Build: across the codegen
cases, Build made 102 choices that nobody had shown the user, and about 85 of
them could have been settled at Design.

## Decision

**Design → Address comments → Build.** One Design run writes the whole design.
The user reviews its files and comments on them. One Address comments run
revises the files the comments touch. Build implements what was reviewed.

1. **One run, in generation order.** The run does these steps in order:
   1. the gap check;
   2. architecture: `design.cell`, each `design.json`, and each external
      dependency's definition;
   3. the data model;
   4. roles and permissions, each described in plain words with its limits;
   5. one artifact per component: a web application's prototype first, then
      each service's `openapi.yaml`, then each agent's `agent.afm.md`;
   6. a grants pass over the prototypes' flows;
   7. each dependency's contract and `assumptions.md`;
   8. flows, only when one is worth writing;
   9. the acceptance tests, last. Where a feature has screens, they are
      written from the prototype.

   A component of another kind has no artifact of its own. Worked examples
   for jobs are not built. The run reports each artifact in one chat line as
   it lands.
2. **The gap check closes holes before any artifact exists.** Each hole goes
   to one of four places:
   - one a product user would notice and the agent can decide: an `*assumed*`
     line in the feature's Decisions;
   - one only an engineer would notice: a technical decision in
     `specs/design/decisions.md` (one line, tagged with the artifact it shapes
     and the features it serves, `*assumed*` until the user confirms it);
   - a fact about an outside service: that dependency's `assumptions.md`;
   - one only the user can decide: an open question in the feature file.
3. **A design run asks no form.** Each question is stored where its answer
   goes: an open question in the feature file, or `question` on a review
   comment (ADR-0052). The run closes with the number of questions and the
   next step on the Design card, and the user answers them there.
4. **Address comments is a branch of the design skill** (`/address-comments`).
   It acts on every sent or reopened comment, and never on a draft. It starts
   at the earliest artifact any comment touches and regenerates downward in
   the same order, editing only what changes. A prototype comment and the
   contract change it needs land in the same run, and the acceptance tests
   come last. The agent replies to each comment in one line that names the
   revision. When a comment is ambiguous, the agent asks a question on it
   instead of guessing. The comments travel in the review file, not in the
   turn's line. The prototype-only `/prototype` feedback turn and the
   `prototypeFeedback` wire field are retired: a turn body that still carries
   the field is refused as an unknown field, and a stored turn that carried
   one still loads, as "Prototype feedback (N comments)". A prototype comment
   is **cosmetic** when its change touches no record or field, role or
   permission, API operation, flow step, validation rule or business rule (a
   label, copy, layout, ordering, an empty or error state): it stays inside the
   prototype. Any other is carried down from the earliest artifact it touches,
   and an ambiguous case counts as not cosmetic. `/prototype` stays as a
   command that only regenerates the prototypes, with edits that keep their
   ids; it leaves the review file as it is. The Design card has no button for
   it.
5. **Build reads the prototype; the wireframes retire.** A web application's
   prototype is the build's screen brief. The coding run reads it through the
   `prototype` skill's `references/implementing.md` (ADR-0050), and
   `mock-verification`, `thunder-authentication`, `security-design` and the
   codegen eval's planner read screens, flows, roles and display states from
   `prototype.json`. They use `prototype.tsx` only as a reference: the app
   never imports `@wso2/prototype-kit` and never copies the prototype's code.
   Its labels are copy, kept letter for letter, and the app has a Settings
   screen only when the prototype has one. The mock walk walks every prototype
   flow in scope by its id, from the state its first control needs; a flow it
   never reached is open, never done. Design no longer writes
   `wireframes.dsl`. The `wireframes` skill is deleted, and the org skill
   reconcile purges an org's clean copy of it. For a web application, the
   build gate requires the prototype, both files, and checks it as ADR-0050's
   gate does a present one: each file passes the save gate's rules, and every
   role it offers is a role of `security.json`.
6. **Projects designed with wireframes are not supported.** The gate neither
   reads nor accepts `wireframes.dsl`. It refuses such a project as having no
   prototype until the project is designed again. There is no fallback and no
   migration.
7. **Review items never block Build.** Unchecked files, drafts, open comments
   and unanswered questions are for the console to show. Neither the build
   gate nor the preflight refuses on them. A missing connection value does not
   block Build either: the deploy gate still owns it
   ([ADR-0023](ADR-0023-external-dependency-values-are-a-deploy-gate.md)). The
   refusals for an out-of-date feature and for an unresolved dependency are
   unchanged.
8. **The organization chooses the design system.** A design turn and
   `/prototype` inline the skill named in the `## UI design system` section of
   the organization skill (`orgDesignSystem`). They no longer hard-code
   `oxygen-ui-design-system`. An organization that names no design system
   gets none inlined.

## Consequences

- A web application has one picture. The prototype the reviewer used is the
  one Build implements. The app maps the kit's components onto the
  organization's design system, as the `prototype` skill's
  `references/implementing.md` says.
- Every Design run is longer, because it writes the prototype, and a web
  application without a prototype cannot be built.
- Revising a prototype is now part of normal work, so a prototype write is
  type-checked as well as rendered (`TYPE_ERROR`, ADR-0042 point 3). Address
  comments runs renamed a field with separate edits: the source transpiled
  without errors and drew `$NaN`.
- Each feature's design is judged where its run ended, so the run's own
  `*assumed*` lines and answered questions do not make the design out of date
  (ADR-0040, amendment 2026-10-11).
- The codegen eval cases carry prototypes instead of `wireframes.dsl`, and
  their checklists are planned from the prototypes.

## Alternatives considered

**Keep the wireframes beside the prototype** (the unmerged ADR-0034's
choice). The review would not cost a build prerequisite, but there would still
be two pictures that disagree. Build would implement the one the user never
used, and the silent choices would stay with Build.

**Lift the prototype into the app** (import the kit, or start from
`prototype.tsx`). The kit is a review sandbox with a mock store and no network.
The app needs the organization's design system, real API calls and sign-in.

**Accept `wireframes.dsl` at the gate until each project is designed again.**
It would keep a second screen brief alive in every Build skill for a
transition with no end date.

**Ask during the run.** A form in the middle of the run stops a long run for
an answer the run can do without. It also leaves the answer in the chat
instead of the file it belongs to.

**A separate "Work out how it's built" step after the business review.** It
was dropped. The technical files come before the screens because the
prototype is built on the data model and the roles, so one run writes them
all.
