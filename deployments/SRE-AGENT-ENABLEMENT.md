# Enabling the SRE (RCA) Agent in the Agentic Engineer's OpenChoreo

The OpenChoreo **SRE / RCA agent** is wired into the AE setup so a fresh
`bash scripts/setup.sh` brings it up automatically — **no manual OAuth-client
registration, no gated steps**. This doc records what was wired in and the one
prerequisite you must supply (the patched image + Anthropic key).

> Reference (chart v1.0.1-hotfix.1): https://openchoreo.dev/docs/v1.0.x/ai/rca-agent/

## Why a patched image (Anthropic)

The stock `ghcr.io/openchoreo/sre-agent` image (incl. `:latest-dev`) uses
LangChain's `ProviderStrategy` for structured output, which **Anthropic rejects
with many tools** ("grammar too large"). The fix switches to `ToolStrategy` for
`anthropic:` models (`openchoreo/agents/sre-agent/src/agent/agent.py`, plus the
`langchain-anthropic` dependency) and is baked into the local image
`openchoreo-sre-agent:anthropic-patched`.

⚠️ The fix is currently **staged/uncommitted** in the `openchoreo` repo and **not
upstream** — verified by inspecting `:latest-dev`, which still imports only
`ProviderStrategy`. So the patched image must be **built from that working tree**.
(If you use an **OpenAI** model instead — `rca.llm.modelName: openai:gpt-4o` — the
stock image works and you can drop the image override.)

## Prerequisite you supply

1. **Build the patched image** (once; a k3d rebuild re-imports it automatically via
   step 1b of `setup-observability.sh`):
   ```bash
   docker build -t openchoreo-sre-agent:anthropic-patched <openchoreo-repo>/agents/sre-agent
   ```
2. **Anthropic key in `deployments/.env`**: `ANTHROPIC_API_KEY=...` (already used by the
   platform; `setup-observability.sh` reads it into `rca-agent-secret`).

## What was wired in (already committed to this repo)

| # | File | Change |
|---|---|---|
| 1 | `single-cluster/values-thunder.yaml` | Added `openchoreo-rca-agent` row to `CONFIDENTIAL_APPS`. The Thunder **bootstrap job** registers this OAuth client automatically during `setup-openchoreo.sh` — this is what removes the manual/gated registration. |
| 2 | `scripts/setup-observability.sh` — obs-plane values | `rca.enabled=true` + patched image (`openchoreo-sre-agent:anthropic-patched`, `pullPolicy: IfNotPresent`), `llm.modelName: anthropic:claude-sonnet-4-6`, `secretName: rca-agent-secret`, `oauth.clientId: openchoreo-rca-agent`, in-cluster `openchoreoApiUrl`, and a CPU/mem bump (`limits cpu:1/mem:2Gi`) so trace-heavy analyses don't trip the liveness probe (`exit 137` → report stuck `pending`). |
| 3 | `scripts/setup-observability.sh` — step 1b | Imports the patched image into k3d (if present in local docker) and creates `rca-agent-secret` (`RCA_LLM_API_KEY` from `.env`'s `ANTHROPIC_API_KEY`, `OAUTH_CLIENT_SECRET=openchoreo-rca-agent-secret`). |
| 4 | `scripts/setup-observability.sh` — `ClusterObservabilityPlane` CR | Added `rcaAgentURL` so RCA reports surface in the portal. |

The **`rca-agent` ClusterAuthzRole + `rca-agent-binding`** (authorizes
`sub=openchoreo-rca-agent` on the OC API) ship with the OC control-plane chart
installed by `setup-openchoreo.sh` — nothing extra needed.

## Fresh bring-up (the intended path)

```bash
# 0. Prereqs
docker build -t openchoreo-sre-agent:anthropic-patched <openchoreo-repo>/agents/sre-agent
# ensure ANTHROPIC_API_KEY is set in deployments/.env

# 1. Provision the platform (cluster + planes + Thunder + observability + AEP config).
cd deployments && bash scripts/setup.sh

# 2. Start the AE app (docker-compose: console, aep-api, agents-service, …).
bash scripts/start.sh
```
Order matters and is already correct: `setup-openchoreo.sh` (step 3) installs
Thunder + runs the bootstrap job (registers `openchoreo-rca-agent`) **before**
`setup-observability.sh` (step 4) deploys the agent, so its OAuth2 startup test
passes on first boot. `start.sh` is independent — it builds/starts the compose
stack and can be run any time after `setup.sh`.

## Verify

```bash
# RCA agent (in-cluster):
kubectl get deploy ai-rca-agent -n openchoreo-observability-plane          # 1/1 Available
kubectl logs deploy/ai-rca-agent -n openchoreo-observability-plane \
  | grep -iE "OAuth2 connection successful|MCP connection successful"       # both should appear

# AE app (docker-compose):
docker compose ps                                                          # all services Up
curl -s http://localhost:9090/healthz                                      # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8090             # 200 (console)
```
Console: http://localhost:8090 · login `admin` / `admin`.

> Note: `start.sh` may print `⚠️ repair-secrets did not complete cleanly` — this
> stage is best-effort (per-org OpenBao secret repair) and does **not** block
> startup. Only matters if a coding-agent dispatch later hangs in
> `CreateContainerConfigError`.

## Trigger an RCA

Attach an alert rule (the `observability-alert-rule` trait or a direct
`ObservabilityAlertRule`) to a component with `actions.incident.enabled: true` +
`actions.incident.triggerAiRca: true`. When it fires, the Observer POSTs to
`ai-rca-agent:8080/api/v1alpha1/rca-agent/analyze` and a report is produced.

## Retrofitting an already-running cluster (verified runbook)

If the cluster is **already up** (Thunder DB exists), editing `values-thunder.yaml`
alone won't register the client — `setup-k3d.sh` reuses the existing cluster and
`setup-openchoreo.sh` skips Thunder ("⏭️ Already installed"), so the bootstrap job
never re-runs. The lightest reliable fix is to reset **only Thunder** so its
bootstrap re-registers every client (including `openchoreo-rca-agent`) against a
fresh DB. This is the exact sequence used on 2026-07-01 and confirmed working:

```bash
# 1. Reset Thunder (drops the SQLite DB so the bootstrap re-registers all clients).
#    Destructive to the IdP only; the AE app should be stopped first.
helm uninstall thunder -n thunder
kubectl delete pvc thunder-database-pvc -n thunder
kubectl -n thunder wait --for=delete pod --all --timeout=120s

# 2. Reinstall Thunder + re-run the bootstrap (registers openchoreo-rca-agent + all
#    other clients from values-thunder.yaml). Also reconciles CP/DP/WF (no-ops).
cd deployments && bash scripts/setup-openchoreo.sh
#    Confirm: kubectl logs -n thunder job/thunder-setup | grep openchoreo-rca-agent
#    → "✓ App 'openchoreo-rca-agent' configured"

# 3. (Re)deploy the RCA agent: imports the patched image, creates rca-agent-secret,
#    enables rca, sets rcaAgentURL.
bash scripts/setup-observability.sh

# 4. Force a fresh RCA pod. If the agent was already crash-looping, the helm spec is
#    unchanged so the pod won't roll on its own — and it stays stuck on a long
#    CrashLoopBackOff timer. Restart it explicitly.
kubectl rollout restart deploy/ai-rca-agent -n openchoreo-observability-plane
```

> Registering an OAuth client or wiping the Thunder DB are credentialed/destructive
> operations the coding agent is **not** permitted to perform autonomously — run
> steps 1 (and the client reg, which here happens *inside* the cluster via step 2's
> bootstrap job) yourself. Alternatively, `k3d cluster delete openchoreo` + `setup.sh`
> gives the same result from a clean slate.

## Operational gotchas (learned in testing)

- **`latest-dev` + Anthropic fails at analysis time** (not startup): startup only
  runs a trivial LLM connection test, so the pod goes `1/1`, but the first real RCA
  errors with grammar-too-large. Use the patched image or an OpenAI model.
- **Recommend-only.** The agent recommends fixes; "Apply Fix" (a ReleaseBinding
  change) is a human action in the portal. Not self-healing.
- **Quick Fixes reflect observed config, not code.** If a service hardcodes a value
  and ignores its env var, the agent may recommend changing that env var — a no-op.
- **Env-render lag:** a `container.env` change may not restart the pod; bump the
  image tag to force a clean re-render.
- **Verify OpenSearch via** `kubectl port-forward svc/opensearch 9201:9200`.
