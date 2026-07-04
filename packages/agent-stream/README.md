# @aep/agent-stream

The single **client-side consumption surface** for the spec agent's turn stream.
The agents service produces the stream; the console, the evals, and the
playground fold it — all through **one** definition here, so fold semantics can't
diverge between implementations. The package has **zero server-side dependencies**
(no Express, no AI SDK), so it is safe to bundle into the browser.

## What's here

| Export | Purpose |
|---|---|
| `StreamPart`, `SSE_DONE`, `AGENT_SSE_EVENT_TYPES` | the raw wire frame + terminal sentinel |
| `TurnRequest`, `Skill`, `*Input`, `OpResult`, `Change` | the turn-request body + SSE payload shapes |
| `FileBundle`, `applyToolCall`, `toChange`, `isFileMutationTool` | the fold: reconstruct file state from the streamed tool-calls |
| `checkComponentDesign`, `componentDesignSchema`, `COMPONENT_DESIGN_JSON_RE` | the component `design.json` write-gate (travels with `FileBundle`) |
| `componentDesignJsonSchema()` | the same schema as JSON Schema, for the Go BFF save-gate |
| `streamTurn(baseUrl, id, body, { headers })` | the reference SSE reader (transport-only; caller supplies auth + key headers) |

## Published JSON Schema

`componentDesignSchema` is published as JSON Schema so the BFF validates
component `design.json` against the same definition the agent enforces at write
time (one schema, not two hand-kept copies). The checked-in artifact lives at
`packages/contracts/schemas/component-design.schema.json`.

Regenerate it after changing the schema:

```
pnpm --filter @aep/agent-stream gen
```

`turbo build` runs `gen` first, and `test/json-schema.test.ts` fails if the
checked-in artifact drifts — so it can't go stale silently. The one contextual
rule the agent adds (`name` must equal the component directory) is not
expressible in a standalone JSON Schema; both sides apply it separately.
