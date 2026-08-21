# ADR-0006 — The runner proves endpoint reachability, and pins the endpoints for curl

**Status:** Accepted

## Context

A validation run is dispatched at deployed-green and told where the system is by
the platform: `fetchValidationContext` writes the deployed endpoint URLs to
`/tmp/validation-context.json` before the agent starts. The `aep-validation`
skill then told the agent to probe each URL with `curl -sf -o /dev/null <url>`
before authoring anything, and to comment on the issue and exit failure if one
did not answer.

On a local plane those URLs are `*.openchoreoapis.localhost`, and that probe
cannot work. **curl (≥7.77) and Chromium both implement RFC 6761:** they resolve
`localhost` and every `*.localhost` name to loopback *themselves*, consulting
neither DNS nor `/etc/hosts`. Inside the runner pod loopback is the pod, so both
get connection refused however healthy the deployment is — curl exit **7**
("failed to connect"), not exit 6 ("couldn't resolve"). Node is unaffected;
`dns.lookup` returns the real address.

Nothing was misconfigured. The CoreDNS rewrite installed by
`deployments/scripts/utils.sh` maps `*.openchoreoapis.localhost` to the
data-plane gateway Service and answers correctly — it simply never gets asked.

The skill had already been taught this. A paragraph explaining RFC 6761 and
giving a `--resolve` recipe was added on 2026-08-06, in a commit titled *"stop
rediscovering the .localhost resolver trap each run"*, and a validation run
preloads the whole `SKILL.md` into the system prompt before its first token
(`alwaysOnSkills` → `requireWorkflowBodies`). It did not hold. The skill's
headline instruction was still the plain `curl` command, with the correction in
the bullet below it, so the p26-bare-minimum-hello run of 2026-08-18 ran the
broken form as its first action, then spent ~30 seconds and five tool calls
inspecting `/etc/hosts`, `/etc/nsswitch.conf`, `ss -tlnp` and `sudo tee` before
reaching the guidance it already had.

The cost is not the wasted tokens. The same skill made an unreachable endpoint a
reportable failure, so a run that took exit 7 at face value would have posted a
false failure against a healthy deployment. Whether validation passed depended on
the agent choosing to investigate rather than believe its own probe.

This is the second time this exact shape has failed. The endpoint *fetch* used to
be a `curl` in the skill too, with prose telling the agent to stop if it 404'd;
the agent did not stop, and ADR-era reasoning moved it into
`validation_context.ts` as a fatal preflight. The probe is the same class of fact
and failed the same way.

## Decision

**1. Reachability is a platform fact, proved in runner code.** `probeEndpoints`
runs in `oneshot.ts` immediately after the context fetch and before
`runClaudeQuery`. An endpoint that does not answer fails the run with
`endpoint_unreachable` before `agent_started`, so it costs no agent tokens and is
reported as a platform fault rather than a validation verdict.

**2. Any HTTP answer counts as reachable; only a transport failure does not.**
Status is deliberately not evidence. An endpoint behind the `api-configuration`
trait legitimately answers 401, an API root legitimately answers 404, and a
gateway holding no matching HTTPRoute also answers 404 — indistinguishably from
the app's own. Treating a status as a verdict would manufacture failures against
healthy deployments, which is the fault being removed. Redirects are not
followed: a login redirect points at the IdP on the *control* plane, a different
hop with its own resolution story, and chasing it would turn an endpoint that
answered into a false negative.

**3. The URL stays truthful; the environment is fixed instead.** The runner
writes a `resolve = <host>:<port>:<address>` entry per `.localhost` endpoint into
curl's own config file (`$CURL_HOME/.curlrc`, `endpoint_access.ts`), so a plain
`curl <url>` works with the real hostname, through the real gateway, carrying the
real Host header. The address comes from DNS per run — the CoreDNS rewrite is the
discovery channel — never from configuration, because a baked-in IP passes once
and then silently points at nothing after a cluster rebuild.

The override is written **once per client**, because no single mechanism reaches
them all. `.curlrc` is a curl file and no browser reads it; the browser
`playwright test` launches is configured by `playwright.config.template.ts` in
the project's own repo. That left playwright-cli — the browser the agent
*explores* with, before any spec exists — reading neither, and still dialling
loopback. So the runner also writes `--host-resolver-rules` into a
playwright-cli config and names it in `$PLAYWRIGHT_MCP_CONFIG`
(`endpoint_access.ts`) — covering the endpoints this run resolved and the IdP a
login redirect leaves for, on which see Consequences. Two details are
load-bearing: the file carries
`launchOptions.args` and nothing else, because naming `browser.browserName`
there leaves `channel` undefined and re-enables the Chromium sandbox that cannot
start unprivileged (ADR-0007); and the variable is set from the file's
existence, because playwright-cli's daemon exits on a config path that does not
resolve — so a coding run, and a cloud validation run, must not see it at all.
An absolute path in the env rather than the CLI's own default
`.playwright/cli.config.json`, which resolves against the CWD: an exploring
agent moves between the repo root and `tests/e2e`, and a CWD-relative config
would apply to some of its commands and not the rest.

Rewriting the URL in the validation context was the alternative, and is worse in
two distinct ways. An IP in the URL sends `Host: <ip>`, matches no HTTPRoute, and
turns every criterion into a 404 that is not the app's fault. A Service-DNS URL
(`http://<svc>.<dp-namespace>.svc…`) resolves natively but goes *around* the
gateway, dropping the `api-configuration` trait's end-user auth, CORS and path
rewrites — indistinguishable on a static webapp, but on an auth-gated API it
would let a criterion pass through a side door while the real user path is
broken. Validation is black-box verification of the deployed system, so the
system under test must not change to make a URL convenient.

**4. Nothing enters the API contract.** This is a local-plane-only condition —
cloud endpoints are real DNS names and RFC 6761 never fires — so
`curlResolveEntries` returns nothing there, no config is written, and the cloud
path is untouched. A permanent field on
`packages/contracts/api/internal/v1/openapi.yaml` would have been a local dev
workaround promoted into the production contract, and `services/aep-api` has no
Kubernetes client with which to learn the gateway address anyway.

**5. The skill stops instructing and stops explaining.** Both the probe step and
the ~20 lines of RFC 6761 guidance are deleted from `SKILL.md`, not reworded.
Rewording would have left a correct instruction beside a wrong one; deleting the
probe removes the trap, and pinning the endpoints removes the need to explain it.
The skill now states only that the endpoints are reachable as written and must be
used as given.

## Consequences

- A validation agent never probes endpoints and never sees exit 7. Its own ad-hoc
  `curl` calls during authoring and healing work unmodified.
- The browser the specs run in is unchanged: `playwright.config.template.ts`
  still applies `--host-resolver-rules`, resolving the gateway through `getent`.
  It is the project's file and stays the project's business; the runner supplies
  the same override only for the exploration browser, which owns no such config.
- **The IdP is mapped too, and it is the one wildcard.** A login redirect leaves
  the app's name family entirely, and the runner never learns the IdP's hostname
  — the validation context carries the app's endpoints and nothing else — so
  `MAP *.openchoreo.localhost` is the only handle available. Every other rule
  names a host this run actually resolved.
- **That rule cannot follow DNS, which is wrong here.** The CoreDNS rewrite maps
  `(openchoreo|openchoreoapis).localhost` alike onto the DATA-plane gateway,
  while `*.openchoreo.localhost` is served by the CONTROL-plane one. Measured
  from a pod: `thunder.openchoreo.localhost` resolves to the data-plane gateway
  and dials to a transport failure (curl exit 7), where the k3d bridge —
  `host.k3d.internal`, which publishes the control-plane gateway — answers 401.
  So the rule points at the bridge, resolved by name per run for the same reason
  the endpoint addresses are: a baked-in IP passes once and then goes stale.
- **An unresolvable bridge degrades rather than fails.** A cloud plane has no
  bridge to resolve, and an exploration hop the agent may never take is not
  worth failing a run over — the endpoint rules, which this preflight has
  actually proved, are written either way.
- A `.curlrc` write failure is fatal. Proceeding would start an agent holding a
  URL it cannot dial and no explanation of why — the state this ADR removes.
- `resolve` entries are scoped per `host:port`, so pinning endpoint hosts does not
  affect the run's other HTTP traffic (the test-credentials callback, `gh`, git).
- The `.curlrc` lives in the runner's home directory, outside the git work tree,
  so unlike `.aep/` there is no path by which it could be committed.

## How the curl half is verified

The unit tests own what this repo can assert: the `resolve = host:port:address`
syntax, the `0600` mode, the path, and the `.localhost`-only filter. That curl
*loads* `$CURL_HOME/.curlrc` and applies `resolve` is third-party behaviour, and
CI has no Docker step and never builds `aep-runner:dev` — so it is checked by
hand against the image, and re-checked whenever the writer changes:

```sh
# 1. The mechanism, in the runner image (curl 7.88.1):
docker run --rm --entrypoint sh aep-runner:dev -c '
  mkdir -p /tmp/h
  printf "resolve = probe.openchoreoapis.localhost:80:10.99.99.99\n" > /tmp/h/.curlrc
  CURL_HOME=/tmp/h curl -sv -m 2 -o /dev/null http://probe.openchoreoapis.localhost/ 2>&1 |
    grep -iE "added|trying"'
# expect: "Added …:80:10.99.99.99 to DNS cache" then "Trying 10.99.99.99:80"
# (without the config: "Trying 127.0.0.1:80" — RFC 6761)

# 2. End to end, from a pod, against a real deployed endpoint:
#      without a .curlrc  → curl exits 7
#      with one pinning the gateway ClusterIP → HTTP 200
```

