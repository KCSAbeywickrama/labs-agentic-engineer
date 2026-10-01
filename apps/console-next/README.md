# @aep/console-next

The agentic-first console, replacing `apps/console`. Dev-only until
switch-over; see `AGENTS.md`.

## Run

```sh
pnpm --filter @aep/console-next gen   # API types + route tree
VITE_API_MODE=mock pnpm --filter @aep/console-next dev   # http://localhost:8091, no backend needed
```

Mock mode serves the API from MSW and signs in as a fixed dev user. Against a
real aep-api, drop `VITE_API_MODE`: the dev server proxies `/aep-api-service`
to `API_PROXY_TARGET` (default `http://localhost:9090`), and sign-in goes to
Thunder as `aep-console-client`. `VITE_AUTH_MODE=thunder` keeps MSW for the API
but signs in for real.

Against a `make dev-env` cluster:

```sh
API_PROXY_TARGET=http://console.ae.localhost:8080/aep-api-service \
COLLAB_PROXY_TARGET=ws://console.ae.localhost:8080 \
VITE_THUNDER_URL=http://thunder.openchoreo.localhost:8080 \
pnpm --filter @aep/console-next dev
```

The spec is the collab room: the app opens it at `/collab` on its own origin,
and the dev server forwards that to `COLLAB_PROXY_TARGET` (the in-cluster
console forwards its `/collab` to the collab server, so pointing at it works).

aectl registers only the in-cluster console's `/callback` on
`aep-console-client`, so sign-in from :8091 needs `http://localhost:8091` and
`http://localhost:8091/callback` added to that client's redirect URIs in the
cluster's Thunder, by hand. This is deliberate while the app is dev-only; a
rerun of aectl's Thunder setup resets the list.

Mock mode starts as an unconfigured org, so the onboarding wizard shows. Run
`localStorage.setItem("aep:mock:settings", "connected")` in devtools and reload
for a configured org; a connection saved in the wizard persists under
`aep:mock:connection:v2`, so remove that key to see the wizard again.

A build runs for about 25 seconds; Acme Expenses' first build fails one scenario (F2.4) so Fix has something to fix — `localStorage.setItem("aep:mock:build-result", "pass")` makes it pass.

Port 8091 is fixed (`strictPort`): the OIDC redirect URI names it, so the
server fails to start rather than move to another port.

## Test

```sh
pnpm --filter @aep/console-next test
```
