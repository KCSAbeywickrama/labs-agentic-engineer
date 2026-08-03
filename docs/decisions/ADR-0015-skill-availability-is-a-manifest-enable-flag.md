# ADR-0015 — Skill availability is a per-skill enable flag in the manifest, not a tech-stack axis

An org should not have its agents reading guidance for technologies it does not
use. The requirement arrived as a console setting: an admin declares the org's
**tech stack** — backend Go or Node, frontend React or Angular — and only the
matching skills reach the agents.

Modelled literally that is a fourth axis on a skill (alongside ownership kind,
manifest origin, and audience — ADR-0013): a `stack` tag, plus an org-level list
of enabled stacks, plus a rule matching one against the other. Three problems
surfaced.

The vocabulary does not hold together. `go` and `node` are languages; `react`
and `angular` are frameworks. A component's `language` for a React web app is
plausibly `typescript`, so matching a skill's stack against the existing
`language` field fails for exactly the frontend case the requirement cares
about — the tags would have to be opaque, with something else mapping a
component to its tag.

A name is not a stack. Some coding skills belong to no stack at all —
`thunder-authentication` and `api-management` apply whichever language is in
use — so a rule keyed on names or on a single stack tag has to special-case
"applies to everything". Org-authored skills (`acme-payments-conventions`) match
nothing at all.

Most decisively, **the org's skills repo already is the enabled set.** Skills
live in the org's own `org-skills` repo, and the reconcile model makes org-kind
defaults opt-in on ongoing sync — an absent default is deliberately not
resurrected. An org that does not use Node simply has no `node` skill, and it
reaches neither the catalog nor the runner. A stack list would be a second
source of truth over that, able to disagree with what is actually present.

## Decision

**Availability is a per-skill `enabled` flag, stored in `skills-manifest.json`.
There is no stack axis.**

- The admin curates availability on the existing Settings → Skills list, one
  toggle per skill. "We are a Go shop, not Node" is: disable `node`.
- **Disabling is non-destructive.** The skill stays in the repo, so adopting the
  technology later is a toggle rather than a re-import — unlike deletion, which
  was the only curation verb available before.
- `enabled` lives on the manifest entry beside `origin` and `baseHash`, **not in
  SKILL.md frontmatter**. Frontmatter is part of the content hash: writing
  `enabled: false` into the file would change the skill's `contentSHA` and make
  every disabled skill read as a divergence from the platform baseline,
  surfacing the "platform update — review your changes" state for what is purely
  an availability setting. The manifest is platform-managed, written atomically
  with skill files, and deliberately outside the hash.
- **Absent means enabled**, so nothing changes for existing orgs.
- The flag gates what the agents see — excluded from the design agent's catalog,
  and excluded from the copies written into a project repo.
- A skill that is disabled but still pinned by a component **is still copied**,
  with a console warning. The disable is an org-level default; a component
  declaring it needs that skill is more specific evidence, and a settings toggle
  should not break a build that was designed against it.

Disabled skills continue to be reconciled and continue to receive platform
updates. Disabled means "do not serve", not "do not track" — otherwise
re-enabling a skill would silently resurrect a stale copy.

## Consequences

- **Curation is per skill, not per stack.** With twelve skills that is
  comfortable. As the library grows — or once orgs author many of their own —
  the admin will want to think in technologies rather than files. Stack tags
  become worth adding at that point, and they compose: declaring a stack would
  set the enable flags, with the per-skill toggle remaining the exception
  mechanism. Nothing here is wasted then.
- Manifest entries exist only for platform-seeded and imported skills — absence
  means org-authored. So this gives disable for **platform-provided defaults**,
  which is the case that needs it; an org-authored skill is managed by deleting
  it, since the org owns it and there is no baseline to preserve.
- "Tech stack" survives as a **UI framing**, not a data model. If it later needs
  to constrain what the platform *builds* — the design agent may not propose a
  Node service at a Go shop — that is governance, a separate feature with its
  own design, and it should own the skill filtering rather than be bolted onto
  it.

## Rejected alternatives

- **`stack` tags on skills + an org enabled-stacks list.** A fourth axis with a
  vocabulary that mixes languages and frameworks, needing a component-to-tag
  mapping and a special case for stack-agnostic skills.
- **Admin maps stacks to skills in platform config.** Keeps skill files clean
  but adds a mapping table to maintain, and still disagrees with repo contents.
- **A "tech stack" skill listing which skills apply.** Puts platform
  configuration inside a content artifact: unenforceable at any seam, invisible
  to code, and a second source of truth that drifts.
