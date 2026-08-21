# Vendored skill

This skill is vendored from Microsoft's `playwright-core`, under the
Apache-2.0 license in `LICENSE`. Do not edit the body — refresh it from
the package when bumping `PLAYWRIGHT_VERSION` in
`runners/remote-worker/Dockerfile`, so the guidance tracks the CLI the
image actually runs:

```bash
npm pack playwright-core@<PLAYWRIGHT_VERSION>
tar xzf playwright-core-<version>.tgz
SRC=package/lib/tools/skills/playwright-cli          # was lib/tools/cli-client/skill before 1.62
cp "$SRC/SKILL.md" skills/playwright-cli/SKILL.md
rm -rf skills/playwright-cli/references              # NOT cp -R: upstream drops files
cp -R "$SRC/references" skills/playwright-cli/references
cp package/LICENSE skills/playwright-cli/LICENSE
tr -d '\r' < skills/playwright-cli/LICENSE > /tmp/l && mv /tmp/l skills/playwright-cli/LICENSE
```

Two traps in that recipe, both hit on the 1.61.1 → 1.62.1 refresh. The source
path moved, so a copy from the old one silently succeeds against nothing. And
`references/` must be REPLACED, not merged: 1.62 dropped
`spec-driven-testing.md`, which a `cp -R` would have left behind as a file
nothing links to.

The source used to be the `@playwright/cli` package's own `skills/`
directory. It moved because the image dropped that package: it pins
prerelease `playwright-core` and would bake a second chromium revision
(see `runners/remote-worker/design/decisions/ADR-0007`). `playwright-core`
ships the same skill and is the code the CLI actually executes, so the
skill and the binary can no longer drift apart. It is also the more
accurate provenance: its `LICENSE` credits both Microsoft and Google,
where `@playwright/cli`'s named Microsoft alone.

The `tr` is not cosmetic bookkeeping: upstream ships that `LICENSE` with
CRLF endings and it is the only such file in this repo. `core.autocrlf`
is `input`, so git would rewrite it on commit anyway — normalising here
keeps the working tree matching what is stored.

Refreshing from the pinned version is what keeps the guidance executable. The
copy vendored from `@playwright/cli` documented `playwright-cli screenshot
--hires` against a CLI that answered `Unknown option: --hires`, so an agent
following that line lost a turn. Sourcing from the same `playwright-core` the
image runs removes that class of drift by construction — the flag is back in
1.62.1, and now so is the CLI that accepts it.

Note the body says `playwright-cli` throughout, while the image runs
`playwright cli`. That is why the Dockerfile installs a `playwright-cli`
shim; do not "fix" the wording here to match.

**One local edit survives a refresh**: a `metadata.aep` block in the
`SKILL.md` frontmatter. `kind: platform` tells this repo's skill library
the skill is platform-owned and read-only — without it the library's
default kind (`org`) would seed it into every organization's skills repo
as an editable, deletable org skill. Re-add it after copying the upstream
file over.

AEP-specific authoring/healing discipline lives in the `aep-validation`
skill's `references/authoring.md` and `references/healing.md`, which
defer all CLI mechanics to this one.

## Why vendored (interim)

The platform has no third-party skill install channel for the runner
today. A session reads exactly one place: the project clone's
`.claude/skills/`, which is the BFF's mirror of the org library and not
somewhere a third-party installer may write — `playwright-cli install --skills`
targets `$HOME`, outside every source the runner admits. The dev flow
also bind-mounts the repo-root `skills/` library over the image, so a
build-time copy elsewhere would be masked. Building that channel for a
single skill isn't warranted. If more third-party skills accumulate, the
natural home is an import source on the org skills repo with
task-kind-based attachment — then this vendored copy can be dropped.
