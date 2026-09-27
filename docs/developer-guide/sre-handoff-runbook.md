# SRE-agent → coding-agent handoff

This flow wires an OpenChoreo observability alert into AE's normal issue-driven
coding-agent dispatch path.

```
observability alert
  → OpenChoreo SRE agent RCA/remediation
  → AE MCP: ae_search_related_issues + ae_create_issue
  → AE-owned GitHub issue classification/adoption
  → existing issue-to-coding-agent dispatch
  → PR, build, deploy, and human verification when required
```

AE owns the issue lifecycle after `ae_create_issue`. The SRE agent does not
dispatch the coding agent directly.

## Runtime pieces

- SRE image: `tharindulak/sre-agent:v1.0.1-hotfix.1-anthropic`.
- Extension root in the SRE pod: `/etc/openchoreo/sre-agent`.
- Remediation extension files:
  - `remediation/CONTEXT.md`
  - `remediation/mcp.json`
  - `remediation/skills/coding-agent-handoff/SKILL.md`
- Canonical skill source:
  `services/aep-mcp-server/skills/coding-agent-handoff/SKILL.md`.
- MCP endpoint: `aep-mcp-server` `/mcp`.
- MCP tools exposed to the SRE agent:
  - `ae_search_related_issues`
  - `ae_create_issue`

`ae_create_issue` is the only write the SRE agent makes. The request must carry
`actionStatuses`, ordered to match the RCA report's recommended actions, using
`"revised"`, `"suggested"`, or `null`.

## Credentials

The coding agent uses the org's Anthropic key, saved in the AE Console. The
SRE agent currently uses a separate, platform-level key (below). The removed
Docker Compose flow projected the Console's org key into the SRE agent instead;
the in-cluster flow has no equivalent yet.

The SRE hotfix image consumes the key from a file:

```text
RCA_LLM_API_KEY_FILE=/etc/rca-agent/anthropic/RCA_LLM_API_KEY
```

`aectl sre install` mounts the `rca-agent-anthropic-secret` Kubernetes secret
at `/etc/rca-agent/anthropic` and waits for the secret to sync before it wires
the handoff. The key value must
not be placed in the image, checked into config, or logged.

`aectl sre install` projects that secret from the `aep/anthropic-api-key`
OpenBao path. `make dev-env` seeds that path with the placeholder `none`, so
`deployments/scripts/setup-sre.sh` requires a real key on its first run and
stores it there:

```text
ANTHROPIC_API_KEY (setup-sre.sh, once)
  -> OpenBao aep/anthropic-api-key
  -> ExternalSecret openchoreo-observability-plane/rca-agent-anthropic-secret
  -> /etc/rca-agent/anthropic/RCA_LLM_API_KEY
```

This is a platform-level key, not the org key saved in the AE Console. To
rotate it, write a new value with
`aectl platform secret import --path aep/anthropic-api-key`; ESO refreshes
the SRE secret within its `refreshInterval` (1h).

## Prerequisites

1. A `make dev-env` cluster (or any `aectl platform install`) with the
   observability plane.
2. AEP and the SRE agent share one Thunder (`thunder.openchoreo.localhost:8080`).
3. The AEP org is connected to GitHub, with an Anthropic key in org settings
   for the coding agent.
4. The target project and components were **created through AEP** and
   deployed; the OC project slug equals the AEP project slug.

## Local setup

Bring the cluster up with the handoff wired:

```bash
WITH_SRE=1 ANTHROPIC_API_KEY=sk-ant-... make dev-env
```

On a cluster that is already up, run the SRE step alone:

```bash
ANTHROPIC_API_KEY=sk-ant-... bash deployments/scripts/setup-sre.sh
```

`setup-sre.sh` is idempotent and, in order:

1. stores the SRE agent's Anthropic key at `aep/anthropic-api-key` (later runs
   keep the stored key when `ANTHROPIC_API_KEY` is unset);
2. generates the handoff bearer at `aep/aep-mcp-token` once and keeps it;
3. runs `aectl platform update --set sreHandoff.enabled=true` against the
   local chart and waits for `aep-api` and `aep-mcp-server` to roll out;
4. applies the `observability-alert-rule` ClusterTrait, which
   `aectl platform install` does not; and
5. runs `aectl sre install` (next section).

`aectl sre install` pins the observability plane chart to the version the SRE
image was built against (`--obs-plane-version`, default `1.0.1-hotfix.1`),
while `setup-env-for-aectl.sh` installs the plane at its OpenChoreo version.
That is why `make dev-env` runs the SRE step last.

## Kubernetes setup with aectl

After `aectl platform install`, install the SRE integration:

```bash
cd tools/aectl
go run . sre install
```

The command reconciles the observability namespace, ExternalSecrets, charts,
SRE extension ConfigMap, and SRE deployment mounts. It reads the extension
assets from an AE repository checkout: the one containing the working
directory, or the one passed as `--assets-root <checkout>`. It resolves them
before changing the cluster. It
renders the MCP URL below into `remediation/mcp.json` in the
`sre-agent-extensions` ConfigMap (the extension loader validates that URL
before it expands env vars), and patches the SRE deployment with:

- `EXTENSIONS_DIR=/etc/openchoreo/sre-agent`
- `RCA_LLM_API_KEY_FILE=/etc/rca-agent/anthropic/RCA_LLM_API_KEY`
- `AEP_MCP_URL=http://aep-mcp-server.<aep-namespace>.svc.cluster.local:3400/mcp`

The SRE pod gets no MCP credential. Authentication comes from the platform
chart: install it with `sreHandoff.enabled=true` (after seeding
`aep/aep-mcp-token` in OpenBao) so `aep-mcp-server` applies the shared handoff
bearer and only the SRE agent pods in the observability namespace
(`sreHandoff.callerNamespace` and `sreHandoff.callerPodLabels`) can reach it.
See `sre-handoff-security.md`.

Focused check:

```bash
cd tools/aectl
go test ./cmd -run 'SRE|Extensions'
```

## Issue outcomes

AE classifies and acts on the issue server-side:

- `code_level` / `mixed`: AE adopts the issue into the normal task funnel and
  dispatches the coding agent when the issue is armed.
- `config_level` / `none`: AE records the issue without dispatching code work.
- `provision` kind: acts as a dispatch brake.
- Low-confidence coding-agent result: the issue remains open/disarmed and the
  Console surfaces `unverified_fix` for human review.
- `not_planned`: the coding agent closes the issue when no code fix is possible
  or warranted; recurrence stops for that signature and the Console surfaces
  `no_change_verdict`.
- Recurrence attempt 4 or later: AE reopens/updates the issue and surfaces
  `escalated` for loud human attention.

Related incident alerts are deduplicated by the server-owned incident key and
the observability alert suppression window. Search results are context only;
the create response decides dedupe, suppression, recurrence, adoption, and
dispatch.

## Console surfaces

- Alert detail shows the SRE stage progression and any linked GitHub issue.
- Project → Issues lists the server-provided issue state, labels, URL, and
  attention reason.
- The notification bell includes SRE attention items for alert-linked issues
  with `unverified_fix`, `no_change_verdict`, or `escalated`.

## Troubleshooting findings

### `ae_create_issue` was called, but no GitHub issue appeared

History: on the local cluster on 2026-09-19 the SRE remediation agent called
`ae_create_issue`, but `aep-api` had no way to accept the forwarded MCP bearer
on the issue routes, so it rejected the request as a malformed Thunder JWT.
That gap is closed: `aep-api` now verifies the forwarded bearer with the scoped
SRE handoff verifier described in
[sre-handoff-security.md](sre-handoff-security.md). It accepts the bearer only
on `GET`/`POST /api/v1/projects/{projectName}/issues`, binds the configured org
and the server-owned incident context, and leaves every other route on Thunder
JWT verification.

If the same symptom appears now, check in this order:

1. `aep-api` logs `JWT validation failed: token is malformed` for the issue
   route. The handoff verifier is disabled or the bearer does not match, so the
   request fell through to Thunder JWT verification. Confirm `aep-api` has both
   `SRE_HANDOFF_TOKEN` and `SRE_HANDOFF_ORG` set (the verifier is off when
   either is empty; on Kubernetes, `sreHandoff.enabled` is `false` by default),
   and that `SRE_HANDOFF_TOKEN` holds the same value as `aep-mcp-server`'s
   `AEP_MCP_TOKEN`. Compare the values without printing them.
2. The create returns `400` with `trusted incident identity and component are
   required`. The request authenticated as a normal user JWT instead of the
   handoff bearer, or the SRE agent sent no component name.
3. The create returns `409`. The component's incident identity matches only
   closed issues whose closure reason cannot recur (for example `duplicate`).
   AE files nothing until a human reopens the matching issue or closes it as
   `completed` or `not_planned`.
4. The create returns `200` with `deduped` or `suppressed`. This is expected:
   an open issue already tracks the incident, or a human closed it as
   `not_planned`. See [Issue outcomes](#issue-outcomes).

### Alert rule is ready, but SRE never runs

Check that the observability workloads are running:

```bash
kubectl -n openchoreo-observability-plane get deploy,sts,ds
```

If `opensearch-master`, `logs-adapter-opensearch`, `fluent-bit`, or the SRE
agent is not ready, alerts are not evaluated and no RCA request reaches the
SRE agent.

If SRE receives the RCA request but immediately fails with
`Anthropic authentication failed`, the projected key is missing or still the
`none` placeholder:

```bash
kubectl -n openchoreo-observability-plane get externalsecret rca-agent-anthropic-secret
ANTHROPIC_API_KEY=sk-ant-... bash deployments/scripts/setup-sre.sh
```
