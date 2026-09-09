# The sample app

`src/` is Oxygen UI's own reference application, `samples/oxygen-ui-test-app`
from https://github.com/wso2/oxygen-ui, vendored here so it reaches every
coding run through the project mirror (the installed `@wso2/oxygen-ui` package
does not ship it — 0.13.1 ships only `.claude/*.md` and five small skills).

It is the **structure** a generated web app matches: the app shell in
`layouts/AppLayout.tsx`, the routes grouped under layouts in
`config/appRoutes.tsx`, and every page as `PageContent` > `PageTitle` > content.
`SKILL.md` says which files to read for which screen, and which parts the
platform overrides (`main.tsx`'s entry wiring, `mock-data/`).

Refresh: copy `samples/oxygen-ui-test-app/src` from the oxygen-ui release that
matches the `@wso2/oxygen-ui` version Setup installs, replace `src/` wholesale,
and re-check `references/app-structure.md`'s excerpts against it. Last taken
from the copy vendored under `apps/console/.claude/skills/oxygen-ui/sample`
(repo commit 2edc47eb, 2026-07-03).
