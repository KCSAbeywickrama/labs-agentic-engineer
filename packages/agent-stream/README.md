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
| `TurnRequest`, `Toolset`, `Skill`, `*Input`, `OpResult`, `Change` | the turn-request body (incl. `toolset`) + SSE payload shapes |
| `FileBundle`, `applyToolCall`, `toChange`, `isFileMutationTool` | the fold: reconstruct file state from the streamed tool-calls |
| `checkComponentDesign`, `componentDesignSchema`, `COMPONENT_DESIGN_JSON_RE` | the component `design.json` write-gate (travels with `FileBundle`) |
| `PLAN_TASK`/`UPDATE_TASK`, `PlanTaskInput`/`UpdateTaskInput`, `*Result`, `TaskContextFile` | the plan-turn tool contract (tasks-github-native §9.3) |
| `planTaskInputSchema`, `updateTaskInputSchema` | the plan-tool Zod inputs (the agents service tool `inputSchema`s + the JSON-schema source) |
| `parseKnownComponents`, `parseTaskContextFile` | the read-only plan context convention (`specs/design/components/…` + `tasks/<n>.md`) |
| `componentDesignJsonSchema()`, `planTaskJsonSchema()`, `updateTaskJsonSchema()` | the schemas as JSON Schema, for the Go BFF |
| `streamTurn(baseUrl, id, body, { headers })` | the reference SSE reader (transport-only; caller supplies auth + key headers) |

## Published JSON Schema

The Zod schemas are published as JSON Schema so the Go BFF validates against the
same definitions the agents service uses — one schema, not two hand-kept copies.
The checked-in artifacts live under `packages/contracts/schemas/`:
`component-design.schema.json` (design.json save-gate), `plan-task.schema.json`
and `update-task.schema.json` (the plan tool inputs the BFF plan tap vendors).

Regenerate them after changing a schema:

```
pnpm --filter @aep/agent-stream gen
```

`turbo build` runs `gen` first, and `test/json-schema.test.ts` fails if any
checked-in artifact drifts — so they can't go stale silently. The one contextual
rule the design.json gate adds (`name` must equal the component directory) is not
expressible in a standalone JSON Schema; both sides apply it separately.
