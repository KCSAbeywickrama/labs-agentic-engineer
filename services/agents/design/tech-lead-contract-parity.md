# Tech-lead contract parity (Task E3)

The tech-lead is a **structured-output** agent (not a file-mutation
conversation). It ships as `src/agents/techlead/{schema,validator,prompt,run,route}.ts`
and mounts two SSE routes in `createApp` so the cutover from `agents-legacy` is
a **URL swap** — aep-api keeps posting the same bodies and parsing the same
frames.

## Wire surface (must stay byte-identical)

| Path (POST) | Request (aep-api `client.go`) | Response frames (aep-api `task_stream.go`) |
|---|---|---|
| `/internal/v1/agents/tech-lead/plan` | `PlanRequestBody` = `TechLeadPlanInput` + optional `diff` | `data-plan-item` `{tempId,componentName,title,rationale,dependsOn}` · `data-plan-complete` · `error{scope:"plan",…}` · `[DONE]` |
| `/internal/v1/agents/tech-lead/detail` | `TechLeadDetailInput` | `data-task-body-delta` `{taskId,delta}` · `data-task-body-complete` `{taskId,body}` · `[DONE]` |

Both stream `text/event-stream` tagged `x-vercel-ai-ui-message-stream: v1`.
Pre-stream body-validation failures are a plain HTTP 400.

## The dependency-awareness / parity boundary (the crux)

`task_stream.go` reads **only** `dependsOn` off each plan item. The persisted
`DependsOnComponents / DependsOnExternalResources / DependsOnResources` and the
config-collection / resource-provisioning gate tasks are derived by aep-api
**directly from design.json** in `persistAndIssue` — **platform-authored, never
LLM-authored** (the client comment: "The LLM's `PlanItem.dependsOn` is
context-only"). So the agent expresses dependency-awareness two ways, without
touching the wire output shape:

1. **Build order** — a consumer's task lists its providers in `dependsOn`
   (component-kind deps → consumer ordered after provider).
2. **Resource gates** — a component with an external / platform-resource
   dependency names the value-collection / provisioning gate in that task's
   **rationale**. The planner is explicitly forbidden from emitting
   config-collection / resource-provisioning tasks (the platform authors those).

The `SlimDesignComponent.{externalResources,platformResources,orgServiceDependencies}`
fields that feed this awareness are **additive and optional** — the current
aep-api client sends only `{name,componentType,language,dependsOn}`, so the wire
round-trips unchanged; a later aep-api task can widen the client to populate
them (same additive posture as the architect `mcp` block). Until then the
planground/eval supply them from design.json's `dependencies[]`.

## Auth posture

This service has **no JWT verification** (the conversation route documents the
same: "behind the platform BFF, which authenticates; this service does not
re-authenticate"). `agents-legacy` gated these routes with `requireOrgId` +
`requireAnthropicKey`; per the migration plan we match the **current** posture
and do not invent auth. The per-org Anthropic key still arrives on
`X-Anthropic-Key` (aep-api always forwards it) → the route builds a per-request
model from it, falling back to the injected composition-root model for
dev/eval/playground/tests.

## Cutover checklist (open items)

- The additive slim-design dependency fields are unused by the live aep-api
  client today — widening `TechLeadSlimComponent` in `client.go` is a **future
  aep-api task** (the "still named DependsOn — a later task owns that contract"
  TODO). Until then, external/platform-resource gate rationale only appears when
  the caller populates those fields (playground/eval do).
- JWT verification for `/internal/v1/*` is not yet implemented in this service;
  when it lands, gate the tech-lead routes with it (parity with legacy's
  `requireOrgId` + `requireAnthropicKey`).
