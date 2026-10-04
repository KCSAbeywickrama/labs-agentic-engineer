# What console-old has that this console does not

This console replaced the earlier one, kept in `apps/console-old` as source to
port from. This note is what that app still has and this one does not, where
it lives there, and what else in the platform leans on it. A row leaves this
note when its feature is ported; the folder goes when the note is empty.

Paths below are under `apps/console-old/src/`.

## What the agents and the platform depend on

These are not pages a user misses; something else emits or expects them, so
their absence is a dead end somewhere else.

| Gap | In console-old | Who depends on it |
|---|---|---|
| `aep://spec/<path>` links in agent text open the spec file. Here agent text is plain text, so they show as raw links. | `components/MarkdownView.tsx` (`SPEC_LINK_PREFIX`), `features/agent-chat/components/AgentChatPanel.tsx` | `skills/console`, `skills/architecture` and `skills/design` tell the design turn to emit them |
| A question option's `action` (`upload-interface`) does something. Here such options are plain answers. | `features/agent-chat/questionCards.ts`, `features/spec/components/SpecQuestionForm.tsx` | `skills/resolve-dependency` ("an option without it is a dead button") |
| `/settings/credentials` exists. aep-api's GitHub connect flow redirects there (`?connected=app`, `?error=`, `?candidates=`); here it falls to the not-found Page, and the Settings card (`/settings`) rotates a PAT but has no App connect. | `routes/settings.credentials.tsx` | `services/aep-api/internal/organization/org_github_controller.go` (`consoleCredentialsPath`) |
| Old deep links redirect: `/builds/<number>` → task, `/builds?tag=vN`, `/tasks/` → builds, `/marketplace` → `/resources`, spec `?generate=design` / `?view=architecture` / `?file=specs/…`, prototype `?screen=` / `?flow=`. | `routes/projects.$projectName.builds.$tag.tsx` and the other route files | links already in GitHub threads, comments and bookmarks |

## Pages and capabilities

| Area | In console-old | Here today |
|---|---|---|
| **Deploy**: promote (no platform operation; the Deploy Page shows it disabled), each environment's validation step and the deploy-hold state, the version block (milestone, merge commit), the test-user table with scopes and the Thunder Console link | `features/projects/components/EnvironmentFlow`, `PromoteDialog`, `DeploymentEnvironmentPage.tsx`, `TestUsersDialog`, `lib/deploymentFlow.ts` | the Deploy Page (`features/deploy/`): the board, Try it, the Configure card, history from the version ledger |
| **Settings, skills library**: search, view, create, edit, delete, enable, import, platform-update sync and review | `routes/settings.skills.tsx`, `features/settings/components/SkillsSection.tsx` and its dialogs | one sync during onboarding; the Settings card has GitHub, AI agents and Usage, no Skills |
| **Resources**: the org's platform resource types and external resources; register, edit, promote a project's resource to the org | `routes/resources*.tsx`, `features/marketplace/` | none |
| **Endpoints**: what other projects offer | `routes/endpoints.tsx`, `features/marketplace/components/EndpointsPage.tsx` | none |
| **Alerts**: SRE agent incident analyses, with a notification bell | `routes/alerts*.tsx`, `features/alerts/`, `layouts/NotificationBell.tsx` | none |
| **Issues**: a project's GitHub issues (incidents, coding-agent handoffs) with an unread badge | `routes/projects.$projectName.issues.tsx`, `features/issues/` | none |
| **Build detail**: the crew view (each agent's tree and timeline lanes), the External resources section (each dependency's values, edited in place), a build log per session, Copy build ID | `features/builds/components/RunCrew.tsx`, `CrewTimeline.tsx`, `ExternalResources.tsx` | the Build card: tasks with their status lines and logs, the coding agent's log as plain lines per session, component build logs, cancel and retry; a park or a blocked task links to the write target's Configure card |
| **Validation**: the ledger's state filter, the verdict summary tile with the validation issue's status line, cancel a validation run, View validation issue on GitHub | `features/validation/components/ValidationLedger.tsx`, `ValidationSummaryCard.tsx`, `ValidationMilestonePage.tsx` | the Validation ledger and card: every attempt, by feature, with its report and log; Fix and Revalidate |
| **Header**: project status badge, footer links | `layouts/AppLayout.tsx`, `layouts/ProjectStatusBadge.tsx` | the rail; the org's name in the user menu |

## Left out by decision

Not gaps: console-old has them and this console will not, so they do not keep
the folder alive.

| Area | In console-old | Why not here |
|---|---|---|
| **Security matrix editing** (grant patching) | `features/spec/components/SecurityPanel.tsx`, `features/spec/lib/patchGrants.ts` | the Design card shows the matrix read-only; a change goes through the design agent |
| **Org and project switchers** | `layouts/HeaderSwitchers.tsx` | the rail's Projects and the grid's search do the job |
