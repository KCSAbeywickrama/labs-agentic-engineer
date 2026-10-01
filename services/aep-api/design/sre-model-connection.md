# SRE model connection — set at install, aep-api-pushed

The OpenChoreo SRE (RCA) agent is one Deployment per plane, not dispatched
per-org like the coding agent. It still needs a model to call, and AE decides
which one and pushes it in — the agent never reads AE's database, and there is
no console surface for this connection at all: it is set, and rotated, only
through `aectl sre install`'s install-time seed (below).

## The connection: an org override, or the org's own connection

`SreModelConnectionService` (`internal/organization/sre_model_connection_service.go`)
and its row `OrgSreModelConnection` (`entity_org_sre_model_connection.go`,
table `org_sre_model_connections`) hold an **optional, org-scoped override**:
an OpenAI-compatible endpoint, a Bearer key, and a model. It follows the same
rules as the org's main [model connection](../../../docs/decisions/ADR-0038-an-organization-has-one-model-connection.md):
a save probes the host before persisting, a host change needs a fresh key, and
the key lives in `org_secrets` (`sre-model/key`), never in the row. The only
writer is `ApplySeed` (below) — `Check`/`Persist` are not reachable from any
HTTP route.

Resolving what the SRE agent actually runs on
(`organization.ResolveEffectiveSRE`) checks, in order:

1. **The SRE model connection**, if one is saved.
2. **The org's own model connection**, if it has the `SREAgent` capability
   (`modelconn.CapabilitiesOf`; true for any `openai-compatible` connection —
   the agent speaks that format, never Anthropic Messages).
3. **Unconfigured** — no model, agent scaled to zero (below).

## Delivery: aep-api pushes, the agent never asks

There is one push target, `internal/config.SREAgentConfig` — the org,
namespace, Deployment and Secret name of **the** SRE agent this AE deployment
owns — set by `SRE_AGENT_ORG` / `SRE_AGENT_NAMESPACE` / `SRE_AGENT_DEPLOYMENT`
/ `SRE_AGENT_SECRET`, all four or none, written by `aectl sre install --org`
through the platform Helm chart's `sreAgent.*` values.

`internal/sreagent.Reconciler` (built over `internal/clients/kubeobs`, the
plain-HTTP in-cluster apiserver client shared with `thunderapp` via
`internal/clients/kubeauth`) owns the push:

- **Ensure** mints a per-org handoff token (`internal/sreagent.Tokens`,
  `org_secrets` key `sre/handoff-token`) once, the same token the [SRE
  handoff](../../../docs/developer-guide/sre-handoff-security.md) verifier
  checks.
- **Desired state** is `ResolveEffectiveSRE`'s connection turned into the
  agent's four env values: `RCA_LLM_API_KEY`, `RCA_MODEL_NAME` (always
  `openai:<model>` — the stock image speaks OpenAI format only),
  `RCA_LLM_BASE_URL`, `AEP_MCP_TOKEN`.
- A hash of that desired state is compared against the pod-template
  annotation `aep.wso2.com/sre-llm-hash` on the Deployment. A mismatch pushes
  the four keys into the AE-owned Secret (`sre-agent-aep` by default — the
  name `aectl sre install` created empty, so a re-run of the installer never
  overwrites what the reconciler already pushed), bumps the annotation
  (forcing a rollout), and reconciles replicas: **0 when unconfigured**
  (nothing to run the agent on), **1 once a connection resolves**.
- Runs a 60-second tick, plus an immediate kick on every SRE model connection
  or org model connection save (`OnChange`), so a changed seed or a changed
  org connection reaches the cluster without waiting for the next tick.

aep-api needs a namespaced `Role` in the observability-plane namespace to do
any of this — `aep-api-sre-push` (get/update/patch on the named Secret,
get/patch on the named Deployment and its `/scale` subresource, list on
pods), bound to the `aep-api` ServiceAccount, applied by `aectl sre install`.
RBAC and OpenBao hardening beyond this narrow Role are out of scope here.

## Install-time seed — the only way to set or rotate it

`aectl sre install --llm-api-key-file/--llm-model` (Task A2) seeds the SRE
model connection at install time; re-running it with a new key file rotates
it. It writes the three values into a Secret named by the platform chart's
`sreAgent.seed.secretName` value in the AE namespace, which the deployment
template wires into `SRE_AGENT_SEED_API_KEY` / `SRE_AGENT_SEED_MODEL` /
`SRE_AGENT_SEED_BASE_URL` (`config.SREAgentSeed`, all optional
`secretKeyRef`s — a Secret missing a key never blocks the pod from starting).

`organization.SreModelConnectionService.ApplySeed`
(`internal/organization/sre_model_seed.go`) is the one place a seed becomes a
connection, and it is authoritative: it runs on the reconciler's own tick,
ahead of `ResolveEffectiveSRE`, keyed by a sha256 of the seed's three values
remembered under the `org_secrets` key `sre-model/seed-applied`:

- **Changed hash** (including the first seed ever tried): probed through
  `Check`, and on success **persisted, replacing whatever connection is
  currently stored** (`Persist(ctx, org, "aectl-seed", draft)`), then marked
  `"<hash>:applied"`.
- **Refused**: the probe or validation failed. Whatever connection was
  stored (if any) is left exactly as it was. Logged
  (`sre_model.seed_refused`, with the refusal's `SectionError` code) and
  marked `"<hash>:refused"` so it is not retried until the seed's values
  change again.
- **Same hash as last tried** (applied or refused): skipped, no re-probe.
- **No seed configured** (`config.SREAgentConfig.Seed.Present() == false`):
  `ApplySeed` is never called (`sreagent.Reconciler.WithSeeder` is only
  attached when a seed is present) — the stored connection, if any, is left
  untouched. Re-running `aectl sre install`/`setup-sre.sh` without
  `--llm-api-key-file` must not wipe a connection a previous install seeded.

Removal is `aectl sre uninstall`, unchanged — it tears down the observability
plane; it does not clear the stored connection row (there is nothing in AE's
own state left to reconcile against once the plane is gone).

## The sqlite report store is a single point of failure

The stock agent's RCA report history lives in sqlite on a `ReadWriteOnce`
PVC, so the Deployment's rollout strategy is `Recreate`: the old pod is
killed before the replacement starts. Every push that changes the hash —
including a bad one, such as a save that resolves to an unreachable host —
tears down the running agent first. There is no second pod to fall back to
while the replacement starts (or fails to), so a bad push is a brief outage
of RCA handling, not a graceful degradation. Nothing in this design adds a
second replica or an HA store; this is a fact to operate around, not a
defect to fix here.
