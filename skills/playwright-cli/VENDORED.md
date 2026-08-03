# Vendored skill

This skill is vendored from Microsoft's `@playwright/cli` npm package,
version `0.1.15` (the `skills/playwright-cli/` directory it ships for
agent installation), under the Apache-2.0 license in `LICENSE`. Do not
edit the body — refresh it from the package when bumping
`PLAYWRIGHT_CLI_VERSION` in `runners/remote-worker/Dockerfile`:

```bash
npm pack @playwright/cli@<version>
tar xzf playwright-cli-<version>.tgz
cp -R package/skills/playwright-cli/* skills/playwright-cli/
cp package/LICENSE skills/playwright-cli/LICENSE
```

**One local edit survives a refresh**: a `metadata.aep.kind: platform`
block in the `SKILL.md` frontmatter. It is what tells this repo's skill
library that the skill is platform-owned and read-only — without it the
library's default kind (`org`) would seed it into every organization's
skills repo as an editable, deletable org skill. Re-add it after
copying the upstream file over.

AEP-specific authoring/healing discipline lives in the `aep-validation`
skill's `references/authoring.md` and `references/healing.md`, which
defer all CLI mechanics to this one.

## Why vendored (interim)

The platform has no third-party skill/plugin install channel for the
runner today: the SDK session only loads the programmatic plugins (the
assembled base plugin + the per-task skills plugin), `settingSources: []`
deliberately ignores `.claude/skills/` (where `playwright-cli install
--skills` writes), and the dev flow bind-mounts the repo-root `skills/`
library over the image so a build-time copy elsewhere would be masked.
Building that channel for a single skill isn't warranted. If more
third-party skills accumulate, the natural home is an import source on
the org skills repo with task-kind-based attachment — then this vendored
copy can be dropped.
