# Console lexicon — the words the product says to a user

The console's user-facing vocabulary. Decided in
[#523](https://github.com/wso2/labs-agentic-engineer/issues/523).

**This is not `CONTEXT.md`.** The repo keeps two vocabularies and they are allowed to differ:

| | audience | governs |
|---|---|---|
| `CONTEXT.md`, `docs/glossary.md` | engineers | what terms *mean* in the domain — *spec bundle*, *milestone run*, *stage aggregate*, *committed truth* |
| **this file** | the product's users | what the console *says* — the words a newcomer reads |

The domain model already concedes the split: `CONTEXT.md`'s **Milestone run** entry warns
*"build (the console's 'build' is the click that starts a run, not the run)"*. This file is
where that difference gets written down instead of rediscovered.

**The rule, same as `design-system.md`:** a feature draws its words from here. Introducing a
user-facing term means amending this file in the same PR. A term absent from this file is not
yet a product word.

## Naming rules

1. **A section names the class; an artifact names the document.** An artifact label adds
   information, never echoes its header — `ACCEPTANCE CRITERIA › Acceptance criteria` fails
   this.
2. **Filenames are never labels.** The user reads a document tree, not a repo.
3. **Plural for things that accumulate over time, singular for the one a project has.**
   Builds, Deployments, Issues, Validations — Overview, Spec.
4. **No acronyms** the user has to expand.
5. **The product is "Agentic Engineer", never "AEP".** The acronym is an internal
   convenience; the app brands itself Agentic Engineer in its header, page title and
   onboarding, so every user-facing string does too.
6. **Don't name the system's behaviour** — name the user's situation. "Build refused" is the
   system describing itself; "Not ready to build yet" describes them.

## The spec workspace

`Spec` stays as the umbrella — the route, the nav item, the workspace title. It is the right
concept for *the agreed description of what we're building*.

| Section | Artifacts | Repo |
|---|---|---|
| `REQUIREMENTS` | **Product requirements** | `specs/requirements/prd.md` |
| `DESIGN` (not `DESIGNS` — one design, several files) | **Architecture** · **Design overview** · **Security** · then per-component | `specs/design/` |
| `VALIDATION` | **Acceptance criteria** | `specs/validation/validation-criteria.json` |

The repo paths **do not change**. They are the internal language, consumed by the agents, the
runner's validation cycle and aep-api; renaming them buys nothing a user can see and costs a
migration for every existing project. This table *is* the mapping — keep it, so nobody later
"fixes" the inconsistency in the wrong direction. It holds only while the user never sees a
path, which requires the agent to stop quoting them
([#530](https://github.com/wso2/labs-agentic-engineer/issues/530)).

Placeholder for an artifact class with nothing in it: **"Not created yet"**. Active wording is
reserved for when an agent is genuinely working — the old *"Being derived…"* claimed work that
was not happening.

## Starting a project

| | |
|---|---|
| Heading | **What do you want to build?** |
| Subtitle | *Describe it in your own words — rough is fine, or upload a product requirements document.* |
| Repository field helper | *Agentic Engineer creates this repository in your organization. Your specs and source code live here, and it stays yours.* |
| Name already taken | *That repository name already exists in `<org>` — pick another.* |
| While creating | **Creating your project…** |

The subtitle answers the only question a blank box raises — *how much detail?* — and stops
there. Narrating the rest of the journey up front is overwhelming, and the journey explains
itself as it happens. The upload clause depends on document upload shipping; drop it until then.

**"Creates this repository"** is deliberate on the field helper and deliberate *not* on the wait
label. Under the Repository name field the repo is the subject and the user needs to know one is
being made in their organization — the previous copy said it "holds" the specs, implying it
already existed. During the wait the user's object is the project, not its storage.

**One honest label, not a phase sequence.** `POST /projects` is a single call with no
phase signal in the contract, so changing text mid-wait would be fabricated progress. The
second phase has a better home: after [#522](https://github.com/wso2/labs-agentic-engineer/issues/522)
the user lands on the overview with the spec card reading *Writing requirements*, which is the
same information shown where it is actually true.

**Not disclosed:** the org's shared skills repo, provisioned on first project creation. It is
org-level, async and best-effort, and on a hosted deployment the platform team owns it — the
developer cannot act on it, so telling them is noise.

### Example prompts

Three, one click each. They are the fastest answer to "what does enough detail look like", so
they carry the persona: internal enterprise work, not consumer apps.

- **Expense approval** — *Employees submit expense claims, managers approve them, and finance exports approved claims to payroll.*
- **Employee onboarding** — *Track each new hire's onboarding tasks across IT, HR and facilities, with reminders for overdue items.*
- **Support triage agent** — *A support triage agent that reads incoming tickets, classifies them by urgency, and drafts replies for a human to approve.*

The third is deliberate: Agentic Engineer builds agents too, and the examples are where that
gets advertised.

## Starting a build

| | |
|---|---|
| Title | **Build v1** |
| Body | *This freezes your requirements and design as v1 and hands them to the coding agents. You can keep editing afterwards — it won't change what's being built.* |
| Scope list | **What gets built:** … |
| Confirm | **Start build** |
| Header button | **Build** |
| Its tooltip | *Freeze this design as v1 and start building* |

**Version** stays — an ordinary word, and the platform genuinely versions the spec.

Deliberately absent: **cut** (release-engineering argot), **git tag** (storage mechanism;
raises "do I need to know git?" at the worst moment), **milestone** (platform bookkeeping that
changes nothing about this decision — it stays discoverable on the Builds page), **stories in
scope** ("in scope" is the jargon; the list is right).

## State

| Situation | Says |
|---|---|
| Spec versioned, unchanged since | **`v1`** |
| Spec changed since its version | **`v1 · edited`** |
| No version yet | **`not built yet`** |
| Agent writing requirements | **Writing requirements** |
| Agent deriving design | **Designing…** |
| Collab server unreachable | **offline** |
| Build gate not satisfied | **Not ready to build yet** |

**published**, **draft** and the `v1+` diff suffix are retired — all three imply a
review-and-release model AEP does not have, and `+` is a convention the user was never taught.
`solo session` becomes `offline`: shorter, and it does not read like a focus feature.

## Questions

The word had two referents. It now has one.

- **Open questions** — recorded gaps in the PRD: numbered entries under `## Open Questions`
  not marked *deferred*. Keeps its name; it is accurate, standard, and the gate reads it. Now
  defined in `CONTEXT.md`.
- **Questions for you** — the agent's live request for input. Renamed away from the collision:
  the chat bubble says **"The agent needs your input (5)"**, the form is headed **"Questions
  for you"**. Nothing parses these, so they were the cheap side to move.

**defer** appears in a gate tooltip as something the user can do, but deferring means getting
the word "deferred" into a PRD entry and no affordance exists for that. Left to
[#527](https://github.com/wso2/labs-agentic-engineer/issues/527); do not invent one here.

## Navigation

All six sections stay visible and enabled from project creation
([#522](https://github.com/wso2/labs-agentic-engineer/issues/522)). `Validation` → **`Validations`**,
per the plural rule.

`Validations` (the runs) and `Acceptance criteria` (what they check) no longer share a word, so
the link between them is made explicit in the section's empty state
([#533](https://github.com/wso2/labs-agentic-engineer/issues/533)).
