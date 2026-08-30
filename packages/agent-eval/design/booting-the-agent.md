# Booting the agent under evaluation

## A child process, where the spec says "in-process"

The design spec (`docs/superpowers/specs/2026-08-23-agent-evaluation-design.md`)
says to **boot the agent in-process** with a real model and an in-memory
conversation store. `bootAgent` boots it as a locally spawned **child process**
instead, on an ephemeral port.

The contrast the spec is drawing is with evaluating a **deployed** agent, which
it rejects because every fix would then cost a rebuild and a redeploy. A local
child satisfies that choice — a retry costs seconds, and nothing is deployed —
while the alternative does not survive contact with the component contract: a
generated agent calls `listen()` at module load and owns its own process
lifecycle, so importing it into the harness's process would fight that design,
and an agent crash would take the evaluation down with it. A child also keeps
the agent's real HTTP contract in the loop, which is the thing under test.

The port is ephemeral rather than the contract's fixed 9090 because a fix loop
boots the agent again and again; a fixed port makes the second boot fail on an
address the first still holds. The port arrives as `PORT`.

## Readiness is the agent's own verdict, and it is bounded

`bootAgent` waits for `GET /healthz` to answer `200 {ok:true}` and gives up at a
bound, quoting the `missing` list and the `store` state it last saw. Two
failures that must never be confused with a bad score:

- an agent that never became ready is a **harness or wiring** failure, not an
  agent that behaved badly, so it raises rather than running scenarios;
- a boot that waited forever would turn a misconfigured agent into a stuck
  build, so the wait is bounded and a dead child is detected immediately rather
  than waited out.

`MEMORY_DB_*` is deliberately never set. The spec requires memory to be
exercised without Postgres, so the agent must serve the run from its own
in-memory store; if it cannot, `/healthz` says `store:"initialising"` and the
boot fails saying exactly that.

## Where the stubs run

The tool stubs are started by the **provider**, inside the promptfoo child
process, not by the CLI. The CLI decides *what* to stub (from the agent
document's `x-aep.tools.openapi[]`) and passes it in the emitted provider
config; it cannot serve them itself, because it runs promptfoo with a
synchronous spawn that blocks its own event loop for the whole run.

Stubs and agent are started and torn down per **scenario**: it costs a process
start against work dominated by model calls, and it buys both conversation
isolation between scenarios and the guarantee that no child outlives the
scenario that needed it.

## What travels where

The provider's `config` block is JSON on disk, under the build's output
directory. It carries the App Path and the tool contracts — never a credential.
The org's Anthropic key reaches the agent as `MODEL_API_KEY` through the
environment only, and reaches the judge as promptfoo's own `ANTHROPIC_API_KEY`.
One credential, two names, no file.
