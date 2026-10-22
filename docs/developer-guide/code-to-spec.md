# Developer guide — specs from an existing codebase

`code-to-spec` is a developer skill (`.agents/skills/code-to-spec/`) for
recreating an application that already exists as code on AEP. It reads the
codebase and writes the part of the `specs/` tree that `/start` and
`/interview` would otherwise elicit from a human; `/design` then runs
unchanged. It is not a platform flow: nothing in the console offers it, and
the design agent cannot run it.

## What it produces

```
specs/requirements/prd.md, product-wide.md, features/F<n>-<slug>.md   per the bundled prd-contract
specs/requirements/sources/<module>.md                                 one coverage file per module and document
specs/design/domain-model.md                                           one erDiagram from the code's types
specs/design/dependencies/<name>/{dependency.json, schema.graphql|openapi.yaml, assumptions.md}   one definition per upstream
<product>.aespecs                                                      the bundle the platform seeds the project from
registrations/<name>.md                                                the consumption instructions and context a definition cannot hold
.inventory/*.md                                                        working notes, not part of the spec
```

It deliberately writes nothing else under `specs/design/` but the dependency definitions. The cell, the
components, roles, flows, contracts and acceptance criteria are derived by
`/design` from the requirements with the org catalog and the write gates,
so the recreate gets the platform's architecture rather than a translation
of the legacy one. What the legacy code *is* — endpoints, integrations,
authorization tables — is recorded in the coverage files as context.
Behaviour that must survive the rewrite is a requirements line; a rule left
only in a coverage file does not reach the build.

## Installing and running it

The skill directory is self-contained: it carries the three platform contracts
it follows under `references/`, so it needs no checkout of this repository.
Copy it to where Claude Code looks for personal skills and run it from any
directory:

```bash
cp -R .agents/skills/code-to-spec ~/.claude/skills/code-to-spec
```

```
/code-to-spec /path/to/digiops-finance/apps/allocation
/code-to-spec /path/to/single-app-repo ~/work/my-app-specs
```

The product root is the directory that *is* the product: a repository, or
one app inside a monorepo. Output defaults to `<name>-specs/` under the
current directory, and the skill refuses to write inside the product's own
repository. Someone working in this repository can point the output at
`playground/.projects/<name>` instead, which git ignores here, and run
`pnpm play playground/.projects/<name> design` to see what `/design` makes of
it before it enters a real project.

Expect a long run: six inventories over the whole codebase first, then the
feature cut, then the files. Review the result against the bundled
`references/prd-contract.md` before handing it over, with particular
attention to the `*assumed*` lines and the Open Questions — those are the
skill's inferences and the facts only the owning team holds.

**Confidential codebases.** Derived specs describe internal business
processes. Keep them in gitignored or private locations and never commit them
to this repository as fixtures or examples. The skill copies configuration
key names only, never values; check its output all the same.

## Defining the upstreams

The first design settles a system the product calls only when a definition
of it already exists. So the skill writes one definition per upstream the
recreate keeps calling, under `specs/design/dependencies/<name>/`, in the
platform's own shape: the name, provider, description, config keys with
secret flags, a contract derived from the client code where the code supports
one (only the operations the product uses), and an `assumptions.md` saying
so. The `/recreate` flow (`skills/recreate`, ADR-0053) treats them as givens:
referenced by the components, never rewritten. Values are never written:
after the design, the Deploy page collects them per environment from whoever
holds them, and the deploy waits until they arrive. A short brief under
`registrations/` carries what a definition cannot, the consumption
instructions, for the moment the organization promotes the resource.

## Getting the tree into an AEP project

The skill packs the `specs/` tree as an `.aespecs` bundle
(`.agents/skills/code-to-spec/references/bundle-format.md`;
`services/aep-api/internal/platform/specbundle` is the reader). The create
dialog takes it beside the reference documents and sends it to `seed-project`
first: the platform validates and commits it in one commit, records the
provenance in the project descriptor, and never runs the `/start` kickoff on
the project. The design card then offers Recreate. The ordered steps, from the
create to the Deploy page's values, are in
`.agents/skills/code-to-spec/references/handoff.md`.

## Keeping the bundled contracts current

`references/prd-contract.md`, `references/domain-model-shape.md` and
`references/dependency-shape.md` are generated copies of
`skills/prd-contract/SKILL.md`, step 3 of `skills/design/SKILL.md` and the
dependency-definition section of `skills/architecture/SKILL.md`. When any of
the three platform skills changes, re-run

```bash
node .agents/skills/code-to-spec/scripts/sync-references.mjs
```

and commit the result. `make test` runs `scripts/sync-references.test.mjs`,
which fails while the copies are stale, and also fails if `SKILL.md` ever
names a path into this repository again, so the skill cannot quietly stop
being standalone.

## What this is not

- Not an import run on the platform. A source-repository input on project
  create and a run that clones it are later work, if the skill proves out.
- Not a change to `prd-contract`, `start` or `design`. The skill carries
  copies; the platform's skills stay the single source of the file shapes.
- Not an API client. It never seeds, registers or uploads anything, never
  holds a token and never reads a configuration value; the console does the
  upload with the person's own session, and registering is an org admin's act.
