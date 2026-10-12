# ADR-0006: The `prototype` verb runs the console's flow, review included

**Status:** Accepted (2026-10-11)

## Context

The prototype is a web-application's UI contract (root ADR-0042, amendment
2026-10-11): the design agent writes it in the Design run, a reviewer comments
on it in the console, and the coding run builds against it. The review's
comments are drafts in `specs/design/review.json`, and Address comments sends
them (root ADR-0051, ADR-0052). The playground had no verb for any of it, so a
change to the `prototype` or `design` skill's review loop could be tried only
on a cluster.

Two production facts stood in the way:

- The console writes the review's drafts into the Room and sends the bare
  `/address-comments` line. The playground has no console and no Room.
- The design agent draws each prototype write before it lands and refuses one
  whose screens fail to render. That render check runs only in the design
  agent. The playground folded a write on its `tool-call`, so a refused write
  still landed on disk.

## Decision

**`play <dir> prototype [component]` sends `/prototype [component]`, as the
console's command line does.** The instruction, the flow's skill lineup and
brief, the write gate and the render check are the design agent's, unchanged.
The verb is gated on a design with a `web-application` (`prototypeGate`). It
only (re)generates the prototypes; it sends no comments.

**`--preview` serves `@wso2/prototype-cli`'s preview** on
`@wso2/prototype-theme-oxygen`, the theme the console's review frame and the
render check draw with. Its Save feedback writes the session's queue to
`<component>/.prototype/feedback.json` (`@wso2/prototype-cli/feedback`). The
playground folds each save, as it lands, into `specs/design/review.json`: one
`draft` comment per request on the prototype's manifest path, with the
request's screen, flow, role, state and elements as its `anchor`
(`engine/prototype.ts`, `engine/review-file.ts`). A save holds the session's
whole queue, so it replaces the drafts the session saved before. The folded
file is removed.

**`play <dir> address-comments` is the Overview's Address comments.** It marks
every waiting comment (a draft, or one reopened by an answer) `sent`, then
runs the bare `/address-comments` turn scoped to the design review, as the
console does. A turn that fails before the agent wrote the review file puts
the comments back as they were.

**A prototype write folds on its ok `tool-result`.** The playground holds a
write to a prototype path by its `toolCallId` and applies it only when its
result is `ok: true` (`engine/turn.ts`, `isPrototypePath` from
`@aep/agent-stream`). The agent makes these writes one at a time in call
order, so the folder stays in step with the agent's bundle. Other writes still
fold on their `tool-call`.

## Alternatives considered

**Send the saved batch on a `/prototype` turn** (`--feedback`, the typed
`prototypeFeedback`). Retired with the field (root ADR-0051): comments go
only through the review file, so a revision runs the design skill's
Addressing comments, which carries a change downstream from the earliest
artifact it touches.

**Make the CLI's preview write `review.json` itself.** Rejected: the preview
is the kit's generic tool and knows nothing of AEP's review file. The fold is
the playground's, beside the one console write it stands in for.

**No review in the playground**, reviewing only on a cluster. Rejected: the
comment-and-address loop is what tuning the `design` and `prototype` skills
iterates on.

## Consequences

- `playground/AGENTS.md` lists the divergences (the fold on `tool-result`, the
  preview in place of the console's review) and the verbs under Spec-side
  skills.
- The review page is the CLI's preview, not the console's review UI. The
  drafts it leaves have the shape the console writes, so Address comments is
  the same turn.
- `evals/codegen` cases get their prototypes from this verb (evals ADR-0006).
