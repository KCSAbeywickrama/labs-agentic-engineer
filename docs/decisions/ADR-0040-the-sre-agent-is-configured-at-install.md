# ADR-0040 — The SRE agent is configured at install

**Status:** Accepted · 2026-10-02
**Supersedes:** [ADR-0038](ADR-0038-an-organization-has-one-model-connection.md)'s
amendments of 2026-09-29 and 2026-10-01 (the SRE model connection)
**Related:** [`services/aep-api/design/sre-handoff.md`](../../services/aep-api/design/sre-handoff.md) ·
[`sre-handoff-security.md`](../developer-guide/sre-handoff-security.md)

## Context

The OpenChoreo SRE agent runs one Deployment per observability plane, with
one model and one static MCP `Authorization` header that its extensions
loader resolves once at start. It cannot be made org-specific: it cannot send
a different header per org.

AE nonetheless stored an org-scoped SRE model connection, minted a per-org
handoff token in `org_secrets`, and ran a reconciler that pushed both into
the agent's Secret and restarted and scaled it. A separate service,
`aep-mcp-server`, forwarded the agent's bearer to two REST operations, which
a gate on aep-api's public edge let through for that one bearer. Once the
model became an install-time value (ADR-0038's 2026-10-01 amendment), aep-api
was only relaying what `aectl sre install` had passed it, and every per-org
layer served exactly one org.

## Decision

**`aectl sre install` configures the SRE agent, and aep-api serves its
handoff directly.**

1. **The model is written by aectl.** The model, base URL and key are probed
   and then written into the agent's own Secret. aep-api neither stores nor
   pushes them. A re-run with a new key file rotates the key.
2. **One handoff key per installation.** aectl generates a random key and
   writes it into the agent's Secret and aep-api's (two copies, because a
   Secret cannot be read across namespaces). aep-api checks the agent's
   bearer against it for the one org `--org` names.
3. **aep-api is the MCP server.** The agent calls
   `/internal/v1/sre-handoff/mcp` on aep-api, which serves exactly the two
   tools (search and create issues) in process. There is no `aep-mcp-server`,
   and no exception on the public edge for the agent's bearer.
4. **The MCP plumbing is aep-api's own.** The single-response form of
   Streamable HTTP is a few JSON-RPC methods, already hand-written for the
   agents' discovery MCP; both surfaces share it (`platform/mcprpc`) rather
   than take on an MCP SDK dependency.

## Consequences

- Removed: the reconciler, its Kubernetes client, the SRE model connection
  service and table (dropped by migration `phase23`), the per-org token, the
  push Role, the REST handoff gate, the `SREAgent` model-connection capability
  and `aep-mcp-server` with its image and chart templates.
- An org's own OpenAI-compatible model connection no longer doubles as the
  SRE agent's model; the agent has its own, set at install.
- Without a model the agent waits at 0 replicas, as before; `aectl` now sets
  that, not aep-api.
- Real multi-org support has to come from the SRE agent upstream: one header
  can authenticate one org.

## Alternatives rejected

- **Keep the per-org machinery for later multi-org.** It cannot deliver
  multi-org while the agent carries one header, and it costs a reconciler, a
  table, a token store and a service now.
- **One key in OpenBao, synced to both namespaces.** One source of truth, but
  an OpenBao write from aectl and a sync delay, for a key aectl already holds
  when it writes the agent's Secret.
- **An MCP SDK in aep-api.** A new dependency for four JSON-RPC methods the
  repository already implements.
