# Test tab

`/projects/<name>/test` — where a deployed component is driven by hand, so it
can be verified without the generated web app or a hand-obtained token.

## Shape

- Route: `src/routes/projects.$projectName.test.tsx`; feature folder
  `src/features/test/`.
- Left: the project's components that have a tester. First cut, that is every
  `ai-agent`. Deploy state comes from `useComponentsDeployments` — the same
  poller the Deployments board reads, not a second resolution.
- Right: the tester for the selected component (`AgentChatTester`).

## The call path

The console never calls a component directly: the gateway's per-API CORS policy
allows exactly one origin (the project's own web app), and in cloud the console
and the gateway are different domains anyway. Every call goes through aep-api's
component-agnostic relay:

```
POST /projects/{projectName}/components/{componentName}/invoke
```

`src/features/test/api/invoke.ts` is the only caller. It POSTs
`{ method: "POST", path: "/chat", contentType: "application/json", body }` and
reduces the answer to the cases the UI renders. The distinction that matters:
the invoke call answering **200 only means the relay happened** — the
component's own status is `InvokeResponse.status`, inside. So upstream
failures (the agent said 404/401/500) and invoke-level failures (aep-api
refused, the network died) are separate result variants, and only the latter
raises an error banner.

`409 not-reachable` is aep-api's answer for a component with no gateway URL
(not deployed, or an intranet-only service). It is stated plainly and the
input is disabled — there is nothing to retry against.

## The chat tester

Written against the server-held memory contract
([ADR-0020](../../../docs/decisions/ADR-0020-agent-conversation-memory-is-server-held-behind-a-store-shaped-contract.md)):
the tester holds its own rendered transcript plus the agent-issued
`conversationId`, and nothing else. **No message array is assembled here or
crosses the wire.** The id is echoed verbatim on every send; an upstream 404
means it is gone or was never this user's, so it is dropped rather than
retried and the next turn starts a fresh conversation.

Nothing is persisted — not even to `sessionStorage`. The console's tester is
deliberately ephemeral; persistence guidance belongs to the generated web app.

Send is disabled for the whole turn. The tester holds ONE `conversationId`, and
a second turn started before the first returns would race to overwrite it.

`toolCalls` render as a collapsed "n tool call(s)" disclosure per turn — seeing
that the agent reached for `listHotels`, rather than only that it answered, is
what the tester is for.

Every turn spends real money as the signed-in caller, so the page says so:
"This talks to the live agent on the organisation's model key."

## Mock mode

`src/mocks/handlers/project.ts` serves the invoke route: 409 for a component
with no Ready deployment carrying an endpoint URL, otherwise a canned `/chat`
turn that mints a conversation id and returns a `listHotels` tool call when the
message mentions a hotel. The `deployed` scenario's fixtures carry a
`booking-agent` component so the tab has something to talk to.

## Not here

Streaming, and the API tester for `service` components — both designed for on
this same route and this same relay, neither built in this cut.
