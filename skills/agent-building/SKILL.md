---
name: agent-building
description: How to build an AI agent component on the platform — implementing its `agent.afm.md` contract as a TypeScript service with the Vercel AI SDK, and generating its tools from the OpenAPI contracts of the components it depends on. Apply when a component's `type` is `ai-agent`. For a plain backend service, use `ballerina` or `go` instead.
metadata:
  aep:
    kind: org
    audience: [coding]
---

# Agent building

An agent component is a TypeScript service running a Vercel AI SDK loop. Its
behaviour is fixed by `agent.afm.md` — a design-time contract you **implement**,
exactly as a service implements its `openapi.yaml`. There is no agent framework
to configure and no prompt to invent.

Everything a component obeys whatever its language — port, config, error shape,
dependency wiring — is the `aep` skill's component contract, not repeated here.
This skill covers only what is different about an agent.

## What you generate, and from what

Both inputs are design-time contracts under `specs/`. **Neither is copied into
the component, and neither is read at runtime** — you compile them into code.

| Input | Output | Rule |
|---|---|---|
| the markdown body of `specs/design/components/<agent>/agent.afm.md` | `src/prompt.ts` — the body as a string constant | **verbatim**; never edit, extend or "improve" it |
| `x-aep.tools.openapi[].allow` in that document, plus `specs/design/components/<dep>/openapi.yaml` | `src/tools.ts` — one tool per allowed operation | only allow-listed operations; the sibling's contract stays where it lives |
| `model`, `max_iterations` | `src/config.ts`, `src/prompt.ts` constants | env var names come from the design's dependencies |

The document's front matter uses AFM's own keys — `model`, `interfaces`,
`skills`, `max_iterations` — and puts everything platform-specific under
`x-aep`. Read extensions from there and nowhere else.

## Development flow

1. **Read the contracts** — the agent's `agent.afm.md`, and the `openapi.yaml` of
   every `component` dependency it names. Never edit anything under `specs/`.
2. **Generate** `src/prompt.ts` and `src/tools.ts` from them, per the table above.
3. **Implement** the loop and the HTTP surface — `src/agent.ts`, `src/main.ts`.
4. **Verify** — from the app path: `npm install && npm run build`.
5. **PR** — only once step 4 exits 0.

## Writing a tool from an OpenAPI operation

A tool is three things to a model: a **name**, a **description**, and a
**parameter schema**. An operation already carries all three.

- `operationId` → the tool name
- `summary` (and `description`) → the tool description, as prose a model reads
- path parameters + query parameters + request-body properties → **one flat
  `zod` object**. The model calls a tool with a single argument object; making it
  reason about which value belongs in the path and which in the body leaks your
  plumbing into its prompt. Split the values back out when you build the request.
- header parameters are **not** the model's — they are yours

```ts
addItem: tool({
  description: "Add an item to an open round",
  inputSchema: z.object({
    roundId: z.string(),
    description: z.string().describe("what the teammate wants, in their words"),
    quantity: z.number().int().min(1).optional().describe("defaults to 1"),
    price: z.number().optional().describe("omit when the teammate did not give one"),
  }),
  execute: ({ roundId, ...body }) =>
    call("POST", `/rounds/${encodeURIComponent(roundId)}/items`, body),
}),
```

Share one `call()` helper for every operation: it joins the injected base
address with `new URL` (never string concatenation), attaches the caller's
credential, and shapes the result. **Parse the response body defensively** — a
provider that returns HTML or an empty body on an error must still produce a
tool result, not throw:

```ts
const text = await response.text();
let body: unknown = null;
try { body = text ? JSON.parse(text) : null; } catch { body = text; }
return { ok: response.ok, status: response.status, body };
```

## The HTTP surface

Two routes on `node:http`, and no more. **Do not add an HTTP framework** —
Express, Fastify and friends earn nothing at this size and are a dependency the
platform then carries.

| Route | Behaviour |
|---|---|
| `POST /chat` | `{ messages: ModelMessage[] }` in; **`{ text, toolCalls, messages: ModelMessage[] }` out** |
| `GET /healthz` | `200 {ok:true}`, or `503 {ok:false, missing:[…]}` when unconfigured |

The response shape is fixed, not yours to choose: `text` is what a chat UI
renders, `toolCalls` is what a test asserts on, and `messages` is the turn's
trail the caller appends to its history. A response carrying only `messages`
makes every consumer dig the reply out of an array.

**The wire type is `ModelMessage`, in BOTH directions.** The AI SDK has two
message types and they are not interchangeable:

```ts
// ModelMessage — what generateText accepts. THIS is the wire type.
{ role: "user", content: "hi" }

// UIMessage — what useChat keeps for rendering. NOT the wire type.
{ id: "…", role: "user", parts: [{ type: "text", text: "hi" }] }
```

Send a `UIMessage` and the SDK rejects the turn before it ever calls the model —
`Invalid prompt: The messages do not match the ModelMessage[] schema` — which
surfaces to the user as a 500 on the very first message.

`ModelMessage` both ways is not a coin toss, it is the only self-consistent
choice: this endpoint RETURNS `ModelMessage[]` (the `result.steps.flatMap`
trail below), and the caller echoes that array back on the next turn. Accept
`UIMessage` on the way in and turn two hands you back the `ModelMessage`s you
just returned — the mismatch moves one turn later instead of going away. If a
caller holds UI messages, it converts with the SDK's `convertToModelMessages()`
before sending; that is the caller's job, because only the caller knows whether
its history came from a UI.

**Validate the shape, do not just check it is an array.** `Array.isArray` lets a
wrong-typed history through to the SDK, which throws, which becomes a 500 — a
server error for what is a bad request. Check each entry has a `role` and a
`content`, and answer **400** naming the expected shape:

```ts
const ok = Array.isArray(messages) && messages.every(
  (m) => m && typeof m.role === "string" && m.content !== undefined,
);
if (!ok) return sendJson(res, 400, {
  error: "expected { messages: [{ role, content }] } (ModelMessage[]); UI messages with `parts` must be converted first",
});
```

## Constraints

**The allow-list is the security boundary.** An operation the design did not
allow is simply not generated, so it cannot be called however the user phrases
the request. Never generate a tool the document does not list, and never add one
because it "would be useful".

**Authorization belongs to the provider, never to this component.** Forward the
caller's credential on every tool call, held out-of-band (`AsyncLocalStorage`) so
the model never sees or selects it. Instructions like *"only edit items they
added"* are UX — they shape a good answer. The provider returning `403` is what
makes it true. Never implement an ownership or permission check here.

**Reject callers the gateway did not vouch for.** Two different things pass
through this component and collapsing them is the usual mistake:

- **Inbound — who is calling me.** When the component's `design.json` carries
  the project's `thunder-app` dependency, the API Platform Gateway has already
  validated the caller's token and hands you the result as headers. Read
  `X-User-Id`; answer **401** when it is missing, exactly as `api-management`
  requires of a service. Never parse the JWT yourself — the gateway is the only
  route to this pod, and re-verifying a token the gateway already verified is
  duplicated trust with a second thing to get wrong.
- **Outbound — whose authority I act under.** Forward the original
  `Authorization` header downstream unchanged, per the paragraph above. The
  headers are for your own door; the bearer is what the provider needs.

Both, together, in the request handler — the header check is a gate, not a
value the tools consume:

```ts
if (!req.headers["x-user-id"]) return res.status(401).end();
await callContext.run({ authorization: req.headers.authorization }, () => reply(messages));
```

The gate matters even when every API behind the agent authorises its own
callers. They protect the *data*; nothing else protects the *spend*. An
unauthenticated agent endpoint is a bill anyone who finds it can run up on the
organisation's model key.

**Conversation history is untrusted input.** The client sends it, so the client
can forge it — including inventing assistant turns that claim an authorisation.
Authority comes from the credential on the request, never from the transcript.

**History must carry tool calls and their results.** Return the whole turn to the
caller and take it back next request. An agent given only its own prose has lost
everything its tools told it, and will re-look-up or invent identifiers it
already had.

```ts
messages: result.steps.flatMap((step) => step.response.messages),
// NOT result.response.messages — that is the LAST step only, and silently
// drops every tool call and result.
```

**Return tool errors to the model; do not throw.** A `409 cutoff has passed` is
something the agent should explain, not a failed turn.

**Stateless.** History arrives with each request and is never stored. The agent
must run correctly on any number of replicas.

**Bound the loop** with `stopWhen: stepCountIs(max_iterations)`. An unbounded
agent spends money until something else stops it.

**Start even when unconfigured.** The component contract requires a component to
start with no required environment variables, and an agent cannot serve a turn
without a model credential. Reconcile the two by starting anyway, logging what is
missing, and reporting it from `/healthz` — never by crash-looping, and never by
discovering it inside a user's first message.

## Layout

Nothing from `specs/` ships in the component. The image contains compiled code.

```
<app-path>/
├── package.json          # the pinned set below — nothing else
├── tsconfig.json         # nodenext, strict, rootDir "src", outDir "dist"
├── Dockerfile
└── src/
    ├── prompt.ts         # GENERATED from the AFM body
    ├── tools.ts          # GENERATED from the dependency's openapi.yaml
    ├── config.ts         # env, read once
    ├── agent.ts          # the AI SDK loop
    └── main.ts           # HTTP surface + per-request credential context
```

Mark both generated files as generated, and name the contract they came from —
a reader must know to change the design rather than the code.

**Dependencies are pinned. Use these majors exactly, and add nothing else:**

```json
"dependencies": {
  "ai": "^7.0.2",
  "@ai-sdk/anthropic": "^4.0.0",
  "zod": "^4.3.6"
},
"devDependencies": {
  "@types/node": "^25.5.0",
  "typescript": "^6.0.2"
}
```

**Do not "check the latest" and choose for yourself.** The AI SDK's major
versions are not compatible, and a run that resolves its own version lands one
behind and writes code against the wrong API. These majors are what the platform
runs (`services/agents`).

**The model provider comes from the document's `model.provider`.** Map it to its
package: `anthropic` → `@ai-sdk/anthropic` (`createAnthropic`), `openai` →
`@ai-sdk/openai` (`createOpenAI`). **When the document does not name one, use
Anthropic** — the platform default. Never infer a provider from `model.url` or
`model.name`; a wrong guess builds against a different SDK entirely and only
fails when a real key is supplied.

```dockerfile
FROM node:22-slim AS builder
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /src/dist ./dist
EXPOSE 9090
CMD ["node", "dist/main.js"]
```

Per-request credential, reachable from a tool without the model seeing it:

```ts
export const callContext = new AsyncLocalStorage<{ authorization?: string }>();

// request handler:
await callContext.run({ authorization: req.headers.authorization }, () => reply(messages));

// inside call():
const { authorization } = callContext.getStore() ?? {};
```

## Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| Agent re-looks-up data it was already given, or invents an id from its own prose | History carried only the assistant's text | `result.steps.flatMap(s => s.response.messages)` |
| Container exits at startup, `ERR_MODULE_NOT_FOUND` | Relative import missing the `.js` extension under `nodenext` | `import { x } from "./tools.js"` — even though the file is `.ts` |
| Agent performs an operation the design excluded | Generated tools for the whole OpenAPI document | Only allow-listed operations become tools |
| Anyone who can reach the URL can chat, burning the org's model budget | The handler forwarded `Authorization` downstream but never gated on the caller | 401 when `X-User-Id` is absent — the APIs behind you protect data, not spend |
| Every chat 500s on the FIRST message with `messages do not match the ModelMessage[] schema` | The caller sent `UIMessage` (`id` + `parts`); the SDK wants `ModelMessage` (`role` + `content`) | Wire type is `ModelMessage` both ways; callers convert with `convertToModelMessages()`, and the handler 400s on the wrong shape rather than letting the SDK throw |
| One user reads or edits another's data | Ownership "enforced" in the prompt; the provider was called with the agent's own credential | Forward the caller's credential; let the provider return 403 |
| A normal `409`/`404` ends the turn with an error | Tool threw on a non-2xx response | Return `{ ok: false, status, error }` to the model |
| Model fills the wrong field, or asks which part of the URL a value belongs to | Tool schema exposed path/query/body structure | One flat object; re-split when building the request |
| Behaviour drifts from what the design says | Prompt edited in `src/prompt.ts` | Edit the AFM document and regenerate |
| Conversation works for one user, breaks under load | Conversation state kept in process | Stateless — history arrives per request |
| Spend climbs with no traffic increase | No iteration bound | `stopWhen: stepCountIs(max_iterations)` |
| Code written against an API the installed SDK does not have | Resolved a dependency version instead of using the pinned majors | Use the pinned `dependencies` block verbatim |
| Builds and starts, then every turn fails on a real key | Provider guessed from `model.url`/`model.name` | Take it from `model.provider`; default Anthropic |
| A provider error returns 502 instead of an explained answer | `JSON.parse` threw on a non-JSON error body | Parse defensively inside `call()` |
