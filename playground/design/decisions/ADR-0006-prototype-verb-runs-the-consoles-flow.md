# ADR-0006: The `prototype` verb runs the console's flow, review included

**Status:** Accepted (2026-10-11)

## Context

The prototype is a web-application's UI contract (root ADR-0042, amendment
2026-10-11): the design agent writes it, a reviewer comments on it in the
console, and the coding run builds against it. The playground had no verb for
it, so a change to the `prototype` skill or its review loop could be tried
only on a cluster.

Two production facts stood in the way:

- A review batch (`prototypeFeedback`) rides only a `/prototype` turn that runs
  in a Room. The design agent refuses it otherwise
  (`ae-design-agent/src/turns/start-turn.ts`): a revision applied to a
  throwaway bundle would read as done and be lost. The playground has no Room.
- The design agent draws each prototype write before it lands and refuses one
  whose screens fail to render. That render check runs only in the design
  agent. The playground folded a write on its `tool-call`, so a refused write
  still landed on disk.

## Decision

**`play <dir> prototype [component]` sends `/prototype [component]`, as the
console does.** The instruction, the flow's skill lineup and brief, the write
gate and the render check are the design agent's, unchanged. The verb is gated
on a design with a `web-application` (`prototypeGate`).

**`--preview` serves `@wso2/prototype-cli`'s preview** on
`@wso2/prototype-theme-oxygen`, the theme the console's review frame and the
render check draw with. Its Save feedback writes the batch to
`<component>/.prototype/feedback.json` (`@wso2/prototype-cli/feedback`).

**`--feedback` sends that batch as `prototypeFeedback`** on a `/prototype`
turn, as the console's Send to agent does, and deletes the file after the
send. A batch whose `prototypeHash` differs from the pair on disk is refused:
its element ids can name what a later revision removed.

**A roomless turn takes a batch when its caller saves the edits.** The design
agent's `TurnStarterDeps.callerSavesEdits` says so, and the playground boots the
agent with it set. The folder saves the turn, as the Room's committer does in
the pod. The pod never sets the flag, so production still refuses a batch
without a Room.

**A prototype write folds on its ok `tool-result`.** The playground holds a
write to a prototype path by its `toolCallId` and applies it only when its
result is `ok: true` (`engine/turn.ts`, `isPrototypePath` from
`@aep/agent-stream`). The agent makes these writes one at a time in call
order, so the folder stays in step with the agent's bundle. Other writes still
fold on their `tool-call`.

## Alternatives considered

**A folder-backed Room adapter**, so production's Room-only path runs
unchanged. Rejected: a second Room implementation to keep in step with
`ae-collab` for one verb. The flag is one boolean whose only effect is the
refusal it lifts.

**No review in the playground**, reviewing only on a cluster. Rejected: the
comment-and-revise loop is what tuning the `prototype` skill iterates on.

## Consequences

- `playground/AGENTS.md` lists both divergences (`callerSavesEdits`, the
  fold on `tool-result`) and the verb under Spec-side skills.
- The review page is the CLI's preview, not the console's review UI. The batch
  it saves has the shape the console sends, so the revision turn is the same.
- `evals/codegen` cases get their prototypes from this verb (evals ADR-0006).
