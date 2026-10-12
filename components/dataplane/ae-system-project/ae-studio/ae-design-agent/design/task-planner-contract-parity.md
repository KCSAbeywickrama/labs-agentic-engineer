# Task planner: the Plan turn's contract with aep-api

The task planner is not a route of its own: a Plan is a design-agent turn
(`kind: plan`) that `aep-api` starts through `ae-studio-tools` on the Turn
socket. The turn's lifecycle and the lock it shares with chat are in
[turn-runtime.md](turn-runtime.md); this note is what the planner and
`aep-api` each own.

## Wire surface

| Piece | Where |
|---|---|
| Turn socket contract and golden streams | `packages/contracts/sockets/ae-studio/turn/` |
| The plan tool and its input | `src/agents/main/tools/task-plan.ts` (`planBuild`), schema in `@aep/agent-stream` (`task-tools-schema.ts`) |
| Per-turn accumulator, the self-correctable errors | `src/agents/main/task-plan-accumulator.ts` (`BuildPlan`) |
| The stream's `task-op` lines | `src/edge/turn-socket.ts` (`taskOpOf`) |
| The consumer that writes the issue | `services/aep-api/internal/delivery/task/plan_tap.go` |

The planner's tool validates and accumulates; it never writes. Each ok
`planBuild` result becomes a `task-op` line with `op: build`, and `aep-api`'s
plan tap writes the version's one build issue from the last of them when the
turn completes. A refused call (`UNKNOWN_COMPONENT`, `UNKNOWN_ITEM`,
`MISSING_ITEM`, `DUPLICATE_ITEM`, `ITEM_ORDER`) returns to the model as a tool
result, which corrects itself in the same turn.

## What the planner owns and what the platform owns

The plan scope names what the version carries: its features with the carried
features each is built after, its product-wide items and its held-back stories.
The planner orders those items (Foundation, when it has one, first; a feature
after the ones it needs), names the components each touches, and writes a
short note per item. It cannot add or drop a feature.

The planner has no say over:

- the build's gate tasks and the validation task, which the platform mints
  elsewhere;
- the issue's title, labels, milestone and the lines that state the version's
  facts (version, product-wide items, held-back stories), set by the plan tap.

## The plan turn's prompt

`src/prompts/turn.ts` composes the turn from facts aep-api sends
(ADR-0003):

- `PLAN_INSTRUCTION` points at the `task-planning` skill and the spec paths,
  and asks for the checklist through `planBuild` from the Version scope.
- `scopeBlock` renders the scope as a `## Version scope (spec <tag>)` section:
  each carried feature with what it needs, the product-wide items the
  Foundation item builds, and the held-back stories. A scope with no features
  renders `WHOLE_SPEC_SCOPE`, whose one item is `spec`.
- The scope carries no stories and no coverage, and the turn gets no
  existing-Tasks section: a version has one build issue, and a same-tag
  rebuild does not plan.
- `taskPlanInstructions` (`src/agents/main/prompt.ts`) is the plan toolset's
  system prompt: what an item is, the `planBuild` input, and how to act on
  each refusal code.

`BuildPlan` is built from the snapshot's component directories and the same
scope, so the tool refuses what the prompt says the version does not carry.

## Who may start a Plan

Only `aep-api`, through `ae-studio-tools` `/internal/v1` (AE-only M2M), which
relays the request onto the Turn socket; on the socket the mount is the gate and
no request carries a token ([ADR-0046](../../../../../../docs/decisions/ADR-0046-ae-studio-checks-platform-idp-tokens-itself.md)).
The model is the org's connection from the pod env, like every other turn.
