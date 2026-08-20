# Component Test tab — design

**Status:** first cut shipped — the console carries a Test tab that chats with a
deployed ai-agent through the BFF's `invoke-component` relay. Supersedes nothing.
**Scope of this spec:** the Test tab, its aep-api proxy, and the first tester
(agent chat). The API tester is designed for but explicitly a second cut.

## Problem

Every time an `ai-agent` is built, the only way to exercise it is the generated
web app — or `curl` with a hand-obtained token. There is no place in the console
to talk to a deployed agent, and nothing to test a deployed `service` either. The
team wants a **Test** surface: pick a deployed component of this project, drive
it, see what comes back.

## Decisions (made in conversation)

| # | Decision | Why |
|---|---|---|
| D1 | The tester calls the component **as the signed-in console user**, forwarding their Thunder token. | The test path is byte-for-byte the production path: same gateway, same JWT policy, same `x-user-*` injection, same downstream authorisation. No new credential, no per-project test user, no auth bypass. Rejected: a per-project test identity (new infra, must work in cloud) and an in-cluster bypass (tests a path users never hit, and punches a hole in "an agent is a protected backend"). |
| D2 | A **Test tab** at `/projects/<name>/test`, beside Builds and Deployments — about *deployed things*, generic over component type. | The user's framing: "we could extend for api as well … a testing tab, so we can test out apis and as well as agents". Rejected: a "Try it" pane inside the read-only Agent Spec view (blurs design vs. deployed instance, no home when undeployed) and a panel on the Builds page (tied to one run's lifecycle). |
| D3 | The console **never calls a component directly**. All calls go through **one component-type-agnostic proxy route on aep-api**. | Two independent reasons, either sufficient. (a) CORS: the gateway's per-API policy allows exactly one origin — the project's own web app — so a browser fetch from the console is refused at preflight; verified on `hotel-booking-assistant-booking-agent`'s RestApi (`allowedOrigins: [<webapp origin>]`). (b) Cloud: the console and the gateway are on different domains anyway; the proxy is what makes this work identically locally and there. |
| D4 | The agent tester holds only the agent-issued `conversationId` plus its own rendered transcript, per the `/chat` contract. **No message array crosses the wire or is held by the caller.** | Fixed and pinned first (see below). The console must not repeat the generated web app's bug. |
| D5 | Agent chat ships first; the API tester is a **second cut** on the same proxy. | Chat is what is needed now. The operation-picker/param-form UI is real work; build it on a proven pipe. |
| D6 | Request/response only — **no streaming** in this cut. | Agents use `generateText` and return one JSON turn. If agents ever stream, the proxy grows an SSE mode then; nothing here precludes it. |

## Prerequisite — the `/chat` contract

Conversation memory is server-held: the agent keeps its own history, and the
caller holds only the `conversationId` it was issued plus its own rendered
transcript. No message array crosses the wire in either direction. The full
contract, its wire shape, and the reasoning behind it are pinned in
`2026-08-18-agent-server-memory-design.md` — this spec consumes that contract
rather than restating it.

The console tester below is written against this contract.

## Architecture

```
console (Test tab)
   │  POST /projects/{p}/components/{c}/invoke   (console session bearer)
   ▼
aep-api  ── resolves c's gateway URL ── forwards caller's bearer ──▶  API gateway
                                                                       │ jwt-auth (sig only), CORS, x-user-* injection
                                                                       ▼
                                                                    component pod
```

### The proxy route

```
POST /projects/{projectName}/components/{componentName}/invoke
  request:  { method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE", path: string,
              headers?: Record<string,string>, body?: string }
  response: { status: number, headers: Record<string,string>, body: string }
```

- **Contract-first**: edit `packages/contracts/api/v1/openapi.yaml`, run
  `make gen-api`, let strict-server compile errors drive the handler.
- **Target resolution**: the component's **gateway** URL, exactly what
  `runtimeconfig.componentExternalURL` already resolves for `env-config.js`
  (`ListDeployments` → first `EndpointURL`). Reuse that resolution — do not add a
  second one. Not the in-cluster address, ever (D1/D3).
- **Auth forwarding**: aep-api's JWT middleware projects the token into
  `auth.Claims`; the raw bearer is not in context but is still on the request.
  The handler forwards `r.Header.Get("Authorization")` verbatim. The gateway's
  policy for these components is `issuers: [], audiences: []` (signature only),
  so the console's own Thunder token is accepted; verified: the generated web
  app's token authenticated as the same user through the same policy.
- **Guardrails**: only components in the caller's project (404 otherwise);
  a component with no gateway URL (an `intranet` service, or not yet deployed)
  is `409 { reason: "not-reachable" }` — honest, and the UI states it plainly;
  request body capped (256 KiB) and response body capped (1 MiB, truncated with
  a flag) so a runaway component can't blow up the BFF; upstream timeout 60 s
  (an agent turn is a real model call). Only header pass-through is
  `Content-Type` and `Accept`; the caller cannot inject arbitrary headers
  upstream. `Authorization` is never taken from the request body.
- **Not a general egress**: the path is joined onto the resolved gateway URL and
  normalised; `..` and absolute URLs are rejected. The route cannot be used to
  reach anything but this project's own gateway-fronted components.

### Test tab (console)

- Route `apps/console/src/routes/projects.$projectName.test.tsx`, feature
  folder `apps/console/src/features/test/`.
- Left: the project's components with a **tester available**. First cut: every
  `ai-agent`. Each row shows deploy state (from `useComponentsDeployments`, the
  poller the Deployments board already uses) and, when not reachable, why.
- Right: the tester for the selected component.

### Agent chat tester (first cut)

- Local transcript state: `{ role: "user"|"assistant", text }[]` — what is
  rendered — plus the agent-issued `conversationId`, echoed on every send.
  Nothing else; history lives in the agent's store (see the agent server
  memory spec, 2026-08-18).
- Send: `invoke` with `method: POST, path: /chat, body: JSON
  { conversationId?, message }`. On 200: append `{assistant, res.text}` and
  keep `res.conversationId`. On 404: the conversation is gone or was never
  this user's — drop the id, tell the user, start fresh; do not retry the id.
- Also shows `toolCalls` per turn, collapsed — that is what the tester is *for*:
  seeing that the agent reached for `listHotels`, not just that it answered.
- Non-200 from the component: shown as-is (status + body), not swallowed,
  except the 404-on-conversation case above, which is handled specially. A
  `4xx` from the gateway (expired session) is shown with a re-sign-in hint.
- Visible cost notice: "This calls the live agent on the organisation's model
  key." Every turn spends real money as the caller.
- "New conversation" clears the transcript and drops the id.

### API tester (second cut — designed for, not built here)

Same route, `service` components: operation picker from the committed
`openapi.yaml` (already served by `GET …/components/{c}/openapi`), a param/body
form, `invoke` with the chosen method/path, response pane. Zero server change.

## Testing

- **aep-api**: handler unit tests for target resolution, project scoping (404),
  not-reachable (409), bearer forwarding, path normalisation rejects, body caps,
  timeout. One httptest upstream. This is a boundary the earlier session found
  untested everywhere else — do not mock the upstream call away.
- **console**: `features/test` component tests — transcript renders `text` and
  never a message array; the `conversationId` is echoed back verbatim on every
  send; a 404 drops the id and starts fresh; non-200 surfaces; unreachable
  state renders the reason. MSW handler for `invoke` in `src/mocks/handlers`.
- **Proof of real execution for the PR**: a screenshot of a `hi` → reply →
  `find me a hotel in Paris` turn showing the `listHotels` tool call, on
  `hotel-booking-assistant`.

## Out of scope

Streaming (D6). API tester (D5). Testing as another user (D1). Persisting test
conversations. Anything that reaches a component other than through its gateway.

## Docs to update when shipped

`apps/console/design/` note for the Test tab; `services/aep-api` domain README
for the invoke route (which domain owns it — `projects/`, alongside the
component reads); `docs/architecture.md` one line under console features.
