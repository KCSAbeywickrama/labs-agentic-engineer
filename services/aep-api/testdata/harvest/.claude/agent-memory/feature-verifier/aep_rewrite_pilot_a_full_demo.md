---
name: aep-rewrite-pilot-a-full-demo
description: Full ADR-0003 demo spine (create->requirements->design->tasks->dispatch->merge->auto-deploy) verified PASS on aep-rewrite/aep-api, 2026-07-02
metadata:
  type: project
---

Full end-to-end demo flow verified PASS on branch `aep-rewrite` after Pilot A
(aep-api test-migration) rebuild, 2026-07-02. Every step (login, GitHub/Anthropic
integration check, project create, requirements generate+publish, design
generate+publish, tasks generate, dispatch to remote coding agent, live-log
streaming, PR merge, webhook-driven build, and auto-deploy) passed with real
evidence (API responses + GitHub CLI cross-checks + a live curl to the deployed
"Hello, World!" endpoint). Total time from dispatch to deployed was ~9 minutes,
well under the 10-25 min budget given.

**Why this matters:** this is the reference trace for what "PASS" looks like
on this stack — useful to compare future runs against when something regresses.

**How to apply:** when re-verifying this flow, expect these entry points and
timings; if a step takes much longer or a status field disagrees with the
sub-resource endpoints, check reconciliation lag (see
[[aep_rewrite_status_lag_gotcha]]) before assuming a break.

Key facts:
- Prompt entry point for spec generation is on the project's **Overview** page
  ("What would you like to build?"), NOT on the Requirements tab (that tab
  only shows an empty state pointing back to "the prompt page").
- "Generate Tasks" then "Execute all" -> menu with "Implement via Remote
  Agents Platform" vs "Implement Locally" (uses the Platform plugin in your
  own coding agent session) — pick Remote Agents for the full spine.
- Task's Live Progress view (`/projects/<id>/tasks/<taskId>`) has a genuine
  live "Activity" panel (timestamped log lines: skill invocation, gh actions,
  bash commands) — this is not a static placeholder, it visibly streams.
- GitHub repos are created under `asdlc-repos` org as `<project-name><3-digit
  suffix>` e.g. `pilot-a-demo020`. GitHub Project board link:
  `https://github.com/orgs/asdlc-repos/projects/<n>`.
- Deployed dev endpoint pattern:
  `http://development-default.openchoreoapis.localhost:19080/<project>-<component>-http`.
- Webhook chain on merge is: `push` (feature branch) -> `pull_request opened`
  -> `push` (merge commit to default branch) -> `pull_request closed`, all
  logged as `webhook: accepted` in aep-api. GitHub issue auto-closes via the
  PR's `Closes #N` on merge — this reproduced cleanly (a predecessor codebase,
  see [[github-issue-side-effects-fail]] in the asdlc feature-verifier memory,
  had this broken; not reproduced here).
- Task's own `status` field transitions: `pending` -> (dispatch) `in_progress`
  -> (agent opens PR) `ready_for_review` -> (merge webhook) `building` ->
  (deploy webhook) `deployed`. `lifecycleStatus` stays `gh_issue_created`
  throughout — don't use it to detect the ready/building/deployed
  transitions, use `status`.
- Live progress API is `GET .../tasks/{id}/progress/agent`; returns
  `{lines:[{kind:"log"|"phase", ts, seq, summary|phase}], cursorMillis,
  final}`. Poll with `?since=<cursorMillis>` for incremental reads. Observed
  phase sequence: `workspace_provisioning` -> `workspace_ready` ->
  `agent_started`, then `kind:"log"` lines for skill loads and shell
  commands (e.g. `gh issue view ... --comments`). UI's live "Activity" panel
  timestamps matched this feed exactly, confirming it's not decorative.
- Known arm64/QEMU go-build flake (see top-level memory
  `aep-rewrite-legacy-port`) manifests concretely as the coding agent
  opening a **draft** PR titled `[build-failed] ...` even though the Go
  source itself is fine (stdlib-only hello-world service). Recovery is
  manual: a human reviews the diff, marks the PR ready for review (task
  flips to `ready_for_review` via webhook), then merges — the rest of the
  chain (building -> deployed) proceeds normally from there. Don't treat a
  `[build-failed]` draft PR alone as a verification failure; check whether
  the underlying diff is actually broken before flagging it.
- Minor UI bug (not yet fixed as of 2026-07-02): the "Execute all" dropdown's
  "Implement Locally" option description has a typo — "Use the **Platofrm**
  plugin in your own Coding Agent session" (should be "Platform").
