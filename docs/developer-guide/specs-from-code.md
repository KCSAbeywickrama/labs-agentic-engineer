# Developer guide — specs from an existing codebase

`specs-from-code` is a developer skill (`.agents/skills/specs-from-code/`) for
recreating an application that already exists as code on AEP. It reads the
codebase and writes the part of the `specs/` tree that `/start` and
`/interview` would otherwise elicit from a human; `/design` then runs
unchanged. It is not a platform flow: nothing in the console offers it, and
the design agent cannot run it.

## What it produces

```
specs/requirements/prd.md, product-wide.md, features/F<n>-<slug>.md   per skills/prd-contract
specs/requirements/sources/<module>.md                                 one coverage file per module and document
specs/design/domain-model.md                                           one erDiagram from the code's types
.inventory/*.md                                                        working notes, not part of the spec
```

It deliberately writes nothing else under `specs/design/`. The cell, the
components, roles, flows, contracts and acceptance criteria are derived by
`/design` from the requirements with the org catalog and the write gates,
so the recreate gets the platform's architecture rather than a translation
of the legacy one. What the legacy code *is* — endpoints, integrations,
authorization tables — is recorded in the coverage files as context.
Behaviour that must survive the rewrite is a requirements line; a rule left
only in a coverage file does not reach the build.

## Running it

Open Claude Code with this repository as the working directory, so the skill
and the contracts it reads are on disk, and point it at the product:

```
/specs-from-code /path/to/digiops-finance/apps/allocation
/specs-from-code /path/to/single-app-repo playground/.projects/my-app
```

The product root is the directory that *is* the product: a repository, or
one app inside a monorepo. Output defaults to
`playground/.projects/<name>/`, which git ignores. The skill never writes into
the product's own repository.

Expect a long run: six inventories over the whole codebase first, then the
feature cut, then the files. Review the result against `skills/prd-contract`
before handing it over, with particular attention to the `*assumed*` lines
and the Open Questions — those are the skill's inferences and the facts only
the owning team holds.

**Confidential codebases.** Derived specs describe internal business
processes. Keep them in gitignored or private locations and never commit them
to this repository as fixtures or examples. The skill copies configuration
key names only, never values; check its output all the same.

## Getting the tree into an AEP project

Creating a project fires `/start` on the server, and while a spec tab is open
the room's live document wins over git for the files it holds. The order
below avoids both:

1. **Create the project** in the console with the product's name and a
   one-line idea. Let the kickoff interview run; answer or dismiss it.
2. **Wait for the flush.** The room commits about a minute after the last
   edit; the spec view shows the kickoff's `prd.md` committed.
3. **Close every spec tab** for the project, in every browser, so the room
   unloads.
4. **Push the generated files** to the project repository's default branch:
   replace `specs/requirements/` and add `specs/design/domain-model.md`.
   Leave `specs/.agentic-engineer.toml` and `.claude/` as the platform wrote
   them.
5. **Reopen the spec view.** The room reseeds from git and shows the
   generated requirements. A tab left open at step 3 would have reverted the
   push on its next flush.
   Expect one more commit from the room a couple of minutes later: it writes
   the files back in its own markdown escaping, so `[tag]` becomes `\[tag\]`
   and the diff is one line out for one line in. Nothing is lost; the
   platform's reader unescapes it. A diff that deletes feature files is the
   revert to watch for.
6. **Settle the assumed lines and answer the open questions** in the console,
   or leave them — they hold nothing up.
7. **Run `/design`.** It converges the domain model, derives the cell and
   components, and mints the acceptance criteria. From here the project is an
   ordinary AEP project.

## Trying `/design` locally first

The playground runs the real design flow against a local project directory
with the working-tree skills, which is the quickest way to see what `/design`
makes of the output before it enters a real project:

```bash
pnpm play playground/.projects/<name> design
```

## What this is not

- Not an import run on the platform. A source-repository input on project
  create and a run that clones it are later work, if the skill proves out.
- Not a change to `prd-contract`, `start` or `design`. The skill reads them;
  the platform's contracts stay the single source of the file shapes.
