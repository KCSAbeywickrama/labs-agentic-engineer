# ADR-0028 — The coding agent's runtime and model are an organization setting

**Status:** accepted · 2026-09-07
**Related:** ADR-0016 (the coding-agent key is an override, not a peer;
superseded by ADR-0034) · ADR-0034 (the coding credential is a subscription) ·
`runners/remote-worker/design/decisions/ADR-0012` (the runtime is a port) ·
ADR-0027 (run recordings are observability, not ledger)

## Context

Which coding-agent runtime a build runs on, and which model it bills, were both
facts of the platform: `model: "claude-sonnet-5"` was a literal in the runner,
and there was no notion of a runtime at all. The motivation for changing that is
other model providers — an organization that wants its builds on something other
than Claude Code, or on a cheaper model for routine work, has no way to say so.

Three things are already per-org here, which is what makes a fourth natural: the
Anthropic key (`llm`), the coding agent's optional override key (`codingLlm`,
ADR-0016), and the git provider. All three live on one `/config` document.

## Decision

**Runtime and model are one `codingAgent` section on the existing org-config
document, and the dispatcher copies them onto each cycle's Workload.**

- Contract: `AgentRuntime` (`claude-code` | `opencode`), `CodingAgentModel`, and
  `CodingAgentProjection` in `packages/contracts/api/v1/openapi.yaml`;
  `ConfigPatch.codingAgent` and `ConfigProjection.codingAgent`.
- Storage: `org_coding_agent_settings`, one row per org. **Its absence is the
  platform defaults** — the same shape ADR-0016 chose, and for the same reason: a
  "using the defaults" flag can disagree with the values beside it.
- Dispatch: `AEP_AGENT_RUNTIME` and `AEP_AGENT_MODEL` on the coding Job's env,
  beside the credential ref that ADR-0016 already puts there.
- Defaults: `claude-code` and `claude-sonnet-5` — today's behaviour exactly, so
  an organization that never opens the page sees no change at all.

**The credential is NOT part of this section.** It is already an org
coding-agent setting (`codingLlm`), and a second place to set it would be a
second answer to one question. The console groups the three into one card; the
API keeps them as the two sections they are.

### The setting is COPIED onto a run, not referenced by it

A change applies from the **next cycle**. A run in flight keeps the runtime and
model it was launched with, because a feed is read back long after the setting
may have moved and the two runtimes emit different agent ids, model names and
tool names. Re-reading mid-run would produce usage lines whose model names
disagree with the tokens they were billed for. This is the same reason
`RunEvent.runtime` is recorded on the event rather than looked up from the run.

### Only runtimes the platform can RUN are selectable

`opencode` is in the contract's enum because the design carries it and a client
should be able to render the choice. It is refused — with a reason naming what is
missing — at two layers: the API when an organization chooses it, and the runner
if a value somehow reaches a pod. **Never substituted.** Silently running the one
runtime we do have would bill an organization for a runtime it did not choose and
never tell it, and the org would go on believing it had switched.

### Only models the platform can PRICE are offered

`modelcost.SumCost` is all-or-nothing across a cycle's usage capture: a single
model with no `model_rates` row blanks the cost of the **whole cycle**, not just
its own share. So the `CodingAgentModel` enum is exactly the set with rate rows
(`claude-sonnet-5`, `claude-haiku-4-5`), and adding a model is a rate row and a
contract change in one commit, never one without the other.

This does not close the hazard, it only stops the SETTING from opening it: a
lead may still fan work out to a subagent on a model with no rate row, and the
tool glossary names one (`opus`). That is a pre-existing gap this decision
deliberately does not widen.

## Consequences

- `services/aep-api/internal/organization` gains a service, an entity and a
  repository; the `/config` orchestrator gains a section in every phase.
- The section is the first on that document that is not credential-shaped: no
  secret, no external probe, a projection that echoes what was written, and
  individually optional fields — an org tunes its model far more often than it
  moves runtime, and restating the runtime on every model change would let a
  stale read overwrite it.
- `codingAgent` is **never null on the wire**. Every org has an effective runtime
  and model, so the section carries the defaults until somebody chooses;
  `updatedBy` distinguishes "on the defaults" from "chose the defaults", and a
  reset DELETES the row so that distinction survives.
- Authorization is unchanged: any authenticated member of the org may change it,
  compensated by the section-level `orgconfig.patched` audit line — which now
  names `codingAgent` — and by `updated_by` on the row itself.

## Amendment 2026-09-22 — OpenCode is selectable; credential rule, image per runtime, one model

The platform ships a second runtime adapter (OpenCode, `runners/remote-worker`),
so every `AgentRuntime` value is selectable and the separate "supported" list,
with its "unavailable" refusal, is gone: a runtime enters the contract with its
adapter. The default runtime is still Claude Code; OpenCode is opt-in per org.

**OpenCode cannot present a Claude subscription** (it authenticates to
Anthropic with an API key only), so an OpenCode run always bills the org's API
key. How that is enforced is the 2026-09-24 amendment below.

**Image per runtime, one ComponentType.** The runtime picks the runner image
(`AGENT_RUNNER_IMAGE` for Claude Code, `AGENT_RUNNER_IMAGE_OPENCODE` for
OpenCode: two tags from one Dockerfile; Helm `codingAgentRunner.opencodeImage`,
compose default `aep-runner-opencode:dev`). Neither has a built-in default; an
OpenCode cycle with no OpenCode image fails its dispatch naming the variable.
The `job/coding-agent` ComponentType gains a `runtime` parameter (enum, default
`claude-code`) that renders as the `aep.wso2.com/runtime` label on the Job and
its pod; the dispatcher stamps the parameter and the same label on the Component
and Workload, so the cluster can select runs by runtime.

**The org's one model is the only model a run uses**, on both runtimes: the
lead, every subagent, and the runtime's own helper calls (OpenCode's titles and
summaries, Claude Code's `haiku`-alias calls). The org brings its own key and
that key decides which models it can reach, so the runner never falls back to a
second model the org did not choose; one model also keeps every slice inside
the all-or-nothing cost stamp.

## Amendment 2026-09-24 — one `agents` section, one model for every agent

Superseding ADR-0016 ([ADR-0034](ADR-0034-the-coding-credential-is-a-subscription.md))
reshapes this setting:

- **`agents` replaces `codingAgent` (and `codingLlm`).** `AgentModel` and
  `AgentsProjection` replace `CodingAgentModel` and `CodingAgentProjection`; the
  section also carries the Claude subscription (`subscription`, masked on read,
  three-state on write). Storage is `org_agent_settings` (renamed from
  `org_coding_agent_settings`); its absence is still the platform defaults.
- **One model for every agent.** The requirements, design and task-planning
  agents use the org's model too, not only the coding agent. They resolve it with
  the key at the start of every turn and send it in the turn body (`model`); the
  agents service builds the model per turn and falls back to `AGENT_MODEL` only
  when a caller sends none. A spec agent picks up a change from its next turn; a
  coding run still copies the model at dispatch and keeps it. Any offered model
  can be chosen, Haiku included; the reasoning-effort option is sent only to
  models that accept it (`services/agents/src/shared/model.ts`).
- **The credential rule is the subscription rule.** A subscription needs
  `claude-code` and a connected API key, judged on the state the patch leaves.
  Choosing `opencode`, disconnecting the key and resetting the section delete the
  stored token in the same transaction; `opencode` with a new token in one patch
  is refused (`agents_subscription_requires_claude_code`, on `body.agents`).
  The 2026-09-22 refusals (`coding_agent_runtime_credential_incompatible`,
  `coding_llm_incompatible_with_runtime`) are gone with the sections they named.
- **One save, one transaction.** `llm` and `agents` are written together under
  one per-org lock, secret bytes included (ADR-0034 point 4).
- Dispatch asks for the credential of the run's runtime: the subscription only
  on Claude Code, the API key otherwise, still failing closed.
