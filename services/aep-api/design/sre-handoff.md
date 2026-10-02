# SRE handoff: the OpenChoreo SRE agent files issues through aep-api

The OpenChoreo SRE (RCA) agent runs one Deployment per observability plane,
with one model and one static MCP header. When an alert fires and its RCA
recommends a code change, the agent's remediation stage hands the incident to
AE by calling two MCP tools aep-api serves. aep-api stores nothing about the
agent: its model and the key it authenticates with are both set at install,
by `aectl sre install`.

## Install-time values, written by aectl

`aectl sre install --org <org>` (`tools/aectl/cmd/sre_model.go`):

- **The model.** `--llm-api-key-file`, `--llm-model` and `--llm-base-url`
  (https only) are probed against `<base URL>/models` before anything is
  written, then go straight into the agent's own Secret, `sre-agent-aep`, as
  `RCA_LLM_API_KEY`, `RCA_MODEL_NAME` (`openai:<model>`, which the stock
  image's `init_chat_model` needs) and `RCA_LLM_BASE_URL`. A re-run without
  the flags keeps the model the agent has; without any model, the agent waits
  at 0 replicas.
- **The handoff key.** 32 random bytes, hex-encoded, generated once and
  reused on every re-run unless `--rotate-handoff-token` is passed. It is
  written into the agent's Secret as `AEP_MCP_TOKEN` and into aep-api's
  Secret, `sre-handoff` (key `token`). Kubernetes Secrets cannot be read
  across namespaces, so the one key has two copies, both written by the same
  run.
- **The platform release.** `sreAgent.enabled`, `org`, `tokenSecret`,
  `tokenHash` and `mcpHostname`, through an in-process `aectl platform
  update`. `tokenHash` is the key's sha256, on aep-api's pod template, so a
  rotated key rolls aep-api, whose env is fixed at pod start.

Rotating the model key is a re-run with a new key file; the agent restarts on
it. There is no console or API surface for either value.

## The surface: two MCP tools in aep-api

`config.SREHandoffConfig` (`SRE_HANDOFF_ORG`, `SRE_HANDOFF_TOKEN`, both or
neither, and a key of at least 32 characters) turns on one mount:

`POST /internal/v1/sre-handoff/mcp` → `auth.SREHandoffVerifier` →
`sourcecontrol/issues.NewSREMCPHandler`.

- **Transport.** `platform/mcprpc`: MCP's Streamable HTTP in its
  single-response form (one JSON-RPC request, one `application/json` answer,
  no sessions, no SSE), shared with the agents' discovery MCP
  (`dependencies/mcpdiscovery`). A `GET` is the router's 405, which the
  transport allows.
- **Auth.** A constant-time compare of `Bearer <key>` against
  `SRE_HANDOFF_TOKEN`. A Thunder JWT is not possible: the agent's extensions
  loader resolves the MCP server's headers once at process start, so a token
  that expires would stop working mid pod-lifetime.
- **Tools.** `search_related_issues` and `create_issue` (the agent sees them
  as `ae_search_related_issues` and `ae_create_issue`). They call
  `sourcecontrol.IssueService` in process for the configured org, with the
  handoff's incident context bound (`sourcecontrol.WithIncidentContext`):
  that context is what lets `CreateIssue` accept `componentName` and
  `actionStatuses`, derive the dedupe key, and classify and adopt the issue.
  A REST create never carries it, so the public operations refuse those
  fields. `create_issue` adds the `bug` and `incident` labels; a search hit
  that is AE's own plan issue is marked `PlatformRecord: true` with a
  `ReadAs` note. Both answer the REST operations' wire shapes
  (`issueResultWire`, `issueInfoWire`).
- **Route.** The platform chart's `aep-api-sre-handoff` HTTPRoute exposes
  exactly this path, on the OpenChoreo control-plane gateway's https listener
  at `sreAgent.mcpHostname`: the agent's extensions loader sends its
  Authorization header only to https URLs.

The tool descriptions are the remediation agent's account of each tool, and
its skill (`deployments/sre-agent-extensions/remediation/skills/coding-agent-handoff`)
is written against them, so the two change together.

## The auto-RCA rule follows the handoff

The default "error → RCA" alert rule is attached to service components only
when the handoff is configured (`SREHandoffConfig.Enabled`): without it, an
alert would run an RCA nothing can hand back.

## One org per installation

The agent carries one static header, so it can authenticate as one org. An
installation's SRE handoff therefore serves the org named at install, and
real multi-org support would have to come from the agent upstream.

## History

Before this, aep-api stored an org-scoped SRE model connection
(`org_sre_model_connections`), minted a per-org handoff token in
`org_secrets`, and ran a reconciler that pushed both into the agent's Secret
and scaled it; a separate service, `aep-mcp-server`, forwarded the agent's
bearer to two REST operations. All of it served one org, since the agent
can carry one header. Migration `phase23_drop_sre_model_connections` drops
the table and the `sre-model/key`, `sre-model/seed-applied` and
`sre/handoff-token` rows; `aectl sre install` removes the push Role and the
`sre-model-seed` Secret it used to create.
