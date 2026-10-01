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

- SRE image: the **stock, unmodified** upstream image, pinned by digest —
  `ghcr.io/openchoreo/sre-agent:v1.3.0@sha256:25e5e6c423d049460f4a60d95497747c2a99b02713faf8523a38ef8e6a85c599`
  (`tools/aectl/cmd/sre.go`). No AE-forked patch.
- Extension root in the SRE pod: `/opt/aep/sre-agent-extensions`
  (`EXTENSIONS_DIR`).
- Remediation extension files:
  - `remediation/CONTEXT.md`
  - `remediation/mcp.json`
  - `remediation/skills/coding-agent-handoff/SKILL.md`
- Canonical skill source:
  `services/aep-mcp-server/skills/coding-agent-handoff/SKILL.md`.
- MCP endpoint: `aep-mcp-server` `/mcp`, reached over **https** through the
  OpenChoreo control-plane gateway (`AEP_MCP_URL`,
  `https://<sreAgent.mcpHostname>[:port]/mcp`).
- MCP tools exposed to the SRE agent:
  - `ae_search_related_issues`
  - `ae_create_issue`

`ae_create_issue` is the only write the SRE agent makes. The request must carry
`actionStatuses`, ordered to match the RCA report's recommended actions, using
`"revised"`, `"suggested"`, or `null`.

## Credentials

The stock agent speaks **OpenAI-compatible chat completions only** — it
cannot call Anthropic's Messages API. An org's model connection may be
Anthropic-format, so AE resolves what the agent runs on rather than always
reusing the org's default connection:

1. The org's **SRE model connection** — OpenAI-compatible, Bearer, its own
   key — if one is stored. There is no console or `/config` surface for it:
   it is set, and rotated, only by `aectl sre install`'s install-time seed
   (`--llm-api-key-file`/`--llm-model`; see [Seed the SRE model at
   install](#seed-the-sre-model-at-install)).
2. Else the org's own model connection, if it carries the `SREAgent`
   capability (any `openai-compatible` connection).
3. Else the agent has no model, and aep-api scales its Deployment to 0.

See
[`services/aep-api/design/sre-model-connection.md`](../../services/aep-api/design/sre-model-connection.md)
for the full resolution and push mechanics. aep-api's reconciler pushes the
resolved connection's model, key, base URL and a minted MCP token into the
AE-owned Secret `sre-agent-aep` in the observability-plane namespace, on a
save, and on a 60-second tick. `aectl sre install --org <org>` is what wires
*which* org's connection a given plane serves (`SRE_AGENT_ORG` /
`SRE_AGENT_NAMESPACE` / `SRE_AGENT_DEPLOYMENT` / `SRE_AGENT_SECRET` on
aep-api, set via the platform chart's `sreAgent.*` values).

The key value must not be placed in the image, checked into config, or
logged.

## Prerequisites

1. A `make dev-env` cluster (or any `aectl platform install`) with OC ≥ 1.2.5
   and the observability plane.
2. AEP and the SRE agent share one Thunder (`thunder.openchoreo.localhost:8080`).
3. The AEP org is connected to GitHub. For the SRE agent to have a model, it
   needs either a seeded SRE model connection or an OpenAI-compatible org
   model connection (see Credentials above); the coding agent uses the org's
   main model connection regardless of format.
4. The target project and components were **created through AEP** and
   deployed; the OC project slug equals the AEP project slug.

## Local setup

`make dev-env` installs the observability plane (OpenSearch, Fluent Bit and
the logs adapter) and then the SRE agent on it. To save memory, skip Agent
Manager, which the SRE handoff does not use:

```bash
WITH_AGENT_MANAGER=0 make dev-env
```

| Variable | Default | Effect |
|---|---|---|
| `WITH_OBSERVABILITY` | `1` | `0` skips the observability plane and the SRE agent with it. |
| `WITH_SRE` | `1` | `0` keeps the plane but skips the SRE agent. |
| `WITH_AGENT_MANAGER` | `1` | `0` skips Agent Manager. |

Then give the SRE agent a model: seed an SRE model connection at install time
(`--llm-api-key-file`/`--llm-model`, below) or connect an OpenAI-compatible
org model connection. AE pushes it in on its own reconcile tick; to force it
immediately, re-run the SRE step:

```bash
bash deployments/scripts/setup-sre.sh
```

`setup-sre.sh` is idempotent and, in order:

1. applies the `observability-alert-rule` ClusterTrait, which
   `aectl platform install` does not; and
2. runs `aectl sre install --org <org> ...` (next section).

## Kubernetes setup with aectl

After `aectl platform install`, install the SRE integration:

```bash
cd tools/aectl
go run . sre install --org <org> --platform-chart deployments/helm-charts/platform
```

`--org` is required — it is the org whose resolved SRE model connection this
plane's agent runs on, and doubles as the SRE handoff's trusted org.
`--platform-chart` (or `--platform-version`) is also required — it pins the
platform-chart release this command upgrades in-process (`sreAgent.*`
values), so a re-run can never silently drift the platform release to
whatever is latest.

The command requires OC ≥ 1.2.5 (`--skip-oc-version-check` to bypass) and
picks its plane mode from the cluster:

- **A plane is installed**: it upgrades that release at its own chart
  version with `--reuse-values`, setting the `rca` block (`rca.enabled=true`,
  the stock image, `rca.extraEnvs`). It warns when no `fluent-bit` DaemonSet
  exists, since log alerts then never fire.
- **No plane is installed**: it installs the plane and logs charts itself at
  `--obs-plane-version` (default `1.2.5`) and `--obs-logs-version`, with
  their secrets, route and `ClusterObservabilityPlane`.

Either way it also completes the control plane's
[`rca-agent` role](../../deployments/helm-charts/design/sre-agent-install.md#rca-agent-role).

See
[`deployments/helm-charts/design/sre-agent-install.md`](../../deployments/helm-charts/design/sre-agent-install.md)
for the full step-by-step (AE-owned Secret, push Role, Helm post-renderer,
CA bundle, https route).

Focused check:

```bash
cd tools/aectl
go test ./cmd -run 'SRE|Extensions'
```

## Seed the SRE model at install

`aectl sre install` seeds the org's SRE model connection at install time —
the only way to set or rotate it. Write the key to a `0600` file, pass it and
the model to the install command, and delete the file afterwards — the key
is only ever read from a file, never taken as a flag value or logged.

```bash
umask 077
echo -n "$OPEN_API_KEY" > /tmp/sre-llm-key

cd tools/aectl
go run . sre install --org <org> --platform-chart deployments/helm-charts/platform \
    --llm-api-key-file /tmp/sre-llm-key --llm-model gpt-5.4

rm /tmp/sre-llm-key
```

`make dev-env` forwards the same seed through env vars, so `setup-sre.sh`
passes it to `aectl sre install` on your behalf:

```bash
SRE_LLM_API_KEY_FILE=/tmp/sre-llm-key SRE_LLM_MODEL=gpt-5.4 WITH_AGENT_MANAGER=0 make dev-env
```

`--llm-base-url` (`SRE_LLM_BASE_URL`) defaults to `https://api.openai.com/v1`
and rarely needs setting.

Verify without ever printing the key itself:

```bash
kubectl -n wso2-aep get secret sre-model-seed -o jsonpath='{.data.apiKey}' | base64 -d | wc -c
kubectl -n wso2-aep get secret sre-model-seed -o jsonpath='{.data.model}' | base64 -d; echo
kubectl -n openchoreo-observability-plane get secret sre-agent-aep -o jsonpath='{.data.RCA_LLM_API_KEY}' | base64 -d | wc -c
```

Rules the seed follows (`organization.SreModelConnectionService.ApplySeed`,
[`sre-model-connection.md`](../../services/aep-api/design/sre-model-connection.md)):
the seed is the **only** way to set or rotate the SRE model connection — there
is no console or API save for it.

- **The seed is authoritative.** A seed hash that differs from the last one
  tried (tracked in `org_secrets`) is probed and, on success, **replaces**
  whatever SRE model connection is currently stored, even if one is already
  stored.
- **The same `--llm-*` values are a no-op.** Re-running `aectl sre install`
  with an unchanged seed skips both the probe and the write. A changed value
  (a new model, a rotated key) is tried again, and also rolls aep-api (a
  pod-template annotation stamped with the seed's hash), so the new value is
  actually read.
- **No `--llm-*` flags leaves the stored connection alone.** Re-running
  `aectl sre install` (or `setup-sre.sh`) without a key file never wipes a
  connection an earlier install seeded.
- **A refused seed is logged once and not retried.** A validation or probe
  failure is logged as `sre_model.seed_refused`, leaves the stored connection
  (if any) untouched, and is marked tried; nothing retries it until the
  seed's values change again.
- **Rotating the key**: re-run the install command with a new key file —
  `aectl sre install --org <org> --platform-chart ... --llm-api-key-file
  <new-key-file> --llm-model <model>` — the changed hash is probed and
  replaces the stored connection on success.

The key lives in the Secret `sre-model-seed` in `wso2-aep` until you delete
it. That is safe once the seed has applied (`kubectl -n wso2-aep get secret
sre-model-seed` no longer being read by anything on the next reconcile):

```bash
kubectl -n wso2-aep delete secret sre-model-seed
```

## Migration from the patched agent

Earlier revisions of this plane ran an AE-patched image
(`tharindulak/sre-agent:v1.0.1-hotfix.1-anthropic`) with a static handoff
bearer and an Anthropic-only key file. Moving to the stock v1.3.0 agent needs
no OpenChoreo upgrade: it runs on the 1.2.5 plane AE already uses. It is
still a two-step change, not an in-place config change:

1. **Enable the control-plane gateway's `https` listener,** which the
   handoff to aep-mcp-server uses (`make dev-env` enables it).
2. **Re-run `aectl sre install --org <org> --platform-chart ...`.** This
   replaces the patched image with the stock one, wires the AE-owned Secret
   and push Role, mounts the extensions and CA bundle through the post-
   renderer, adds the `rca-agent` role actions, and switches the handoff to
   the minted per-org token over https.

What this changes, and what it does not carry over:

- **The patched agent is replaced outright** — there is no side-by-side
  running of both images.
- **The sqlite RCA report history on the old pod's volume is not
  migrated.** AE's own GitHub issues (filed by `ae_create_issue`) are the
  durable record of what the agent found; nothing reads the old sqlite file
  after the cutover.
- **The old `AE_*` keys vanish from `rca-agent-config`** on the Helm
  upgrade — they were part of the patch that added them, and that patch no
  longer applies. The stock agent's model, key, base URL and MCP endpoint
  now arrive as plain env vars from `sre-agent-aep`, not a ConfigMap patch.
- The static `SRE_HANDOFF_TOKEN`/`SRE_HANDOFF_ORG` env, the
  `AEP_MCP_DEFAULT_BEARER` shared secret, and the chart's old `sreHandoff.*`
  values block are gone; the handoff bearer is now the per-org token
  aep-api mints and aep-mcp-server forwards unchanged (see
  [`sre-handoff-security.md`](sre-handoff-security.md)).

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

`aep-api` verifies the forwarded bearer with the scoped SRE handoff verifier
described in [sre-handoff-security.md](sre-handoff-security.md). It accepts
the bearer only on `GET`/`POST /api/v1/projects/{projectName}/issues`, binds
the configured org and the server-owned incident context, and leaves every
other route on Thunder JWT verification.

If the symptom appears, check in this order:

1. `aep-api` logs `JWT validation failed: token is malformed` for the issue
   route. The handoff verifier is disabled or the bearer does not match, so
   the request fell through to Thunder JWT verification. Confirm `aep-api`
   has all four `SRE_AGENT_ORG` / `SRE_AGENT_NAMESPACE` /
   `SRE_AGENT_DEPLOYMENT` / `SRE_AGENT_SECRET` set (the push, and with it the
   handoff verifier, is off unless every one is; on Kubernetes,
   `sreAgent.enabled` is `false` by default) — the handoff verifier checks
   the bearer against the per-org token aep-api itself minted and stored,
   not a static shared secret, so there is nothing to compare by hand.
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

If the SRE agent's replicas are `0`, aep-api has resolved no model for it
(see [Credentials](#credentials)): seed an SRE model connection
(`--llm-api-key-file`/`--llm-model`) or connect an OpenAI-compatible org
model connection, wait for the next 60-second reconcile tick (or re-run
`bash deployments/scripts/setup-sre.sh` to force it), and check:

```bash
kubectl -n openchoreo-observability-plane get secret sre-agent-aep -o jsonpath='{.data.RCA_MODEL_NAME}' | base64 -d
kubectl -n openchoreo-observability-plane get deploy sre-agent -o jsonpath='{.spec.replicas}'
```

If SRE receives the RCA request but fails to authenticate to its model
provider, check the pushed Secret's `RCA_LLM_BASE_URL`/`RCA_MODEL_NAME`
against what was seeded or connected; if they don't match, the reconciler
has not yet converged, or the connection's host changed without a fresh key.
