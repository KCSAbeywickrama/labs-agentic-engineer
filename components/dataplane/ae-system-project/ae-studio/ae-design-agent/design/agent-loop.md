# Agent loop

The `@aep/ae-design-agent` main agent: an interactive, streaming spec editor. Tool-edit
rationale is [ADR-0001](./ADR-0001-anchored-file-edits.md); tool *semantics* live in
`src/agents/main/{bundle,tool}.ts` (the source of truth).

## Shape

A user sends a natural-language instruction; the agent **streams proposed changes**
token-by-token (markdown + YAML + OpenAPI). The agent writes its file edits into the
project's Room as a live peer (`src/collab/room-peer.ts`); the Room's committer is the
only writer to the repo ([root ADR-0045](../../../../../../docs/decisions/ADR-0045-design-work-runs-in-the-organizations-ae-studio.md)).

**A turn starts detached and is watched over a replayable stream.** Start, watch,
retention and the per-project lock: [turn-runtime.md](turn-runtime.md). A follow-up
re-enters as the *next* turn, so "awaiting-human" is the gap between two turns.

**One stream, symmetric consumers.** The turn's run produces the frames; the console
and the playground consume them: `toChange` projects each `tool-result` into a
reviewable change, and `applyToolCall` folds the streamed calls through the canonical
`FileBundle` ops (`@aep/agent-stream`) to reconstruct file state — no second matcher.

## Agents and the loop

Each agent is a `ToolLoopAgent` built by a factory, following the AI SDK's
building-agents guidance: `createMainAgent` (`src/agents/main/agent.ts`, the spec editor)
and `buildSubAgent` (`src/areas/sub-agent.ts`, the one generic sub-agent behind every
area chat, built from an area scope). A factory takes what the agent IS (its deps: tools,
instructions, or for a sub-agent the scope it builds them from) and `AgentRunSettings` (`src/agents/run-settings.ts`), what `runTurn` decided for
this turn: the model built from the org's connection, the step cap, the output ceiling,
retries, provider options, `instructionsWrap` (the system prompt, with the cache
breakpoint when caching is on) and `prepareStep` (the rolling breakpoint). Every agent
is assembled by one helper, `buildToolLoopAgent`, which stops at the step cap, on an
accepted question call (`questionStop`) or on an accepted hand-off call (`handOffStop`),
and leaves an absent option off entirely.

`runTurn` takes `agentFor(run)` rather than tools and instructions: it pushes the user
message, which is what fixes the turn prompt's index for the rolling breakpoint, then
calls `agentFor` once and streams the agent it returns. `runConversationTurn` picks the
factory: an area chat's turn (its `chat`: the area and its focus) gets `buildSubAgent`
over `scopeFor(area, focus)` — the Issues area's own chat `scopeFor("issues")`, an issue's
thread `scopeFor("issues", {kind: "issue", id})`; every other turn gets `createMainAgent`
over the tool set it assembles (files or task-plan, then MCP, register draft and web
search).

## Locked decisions

| Decision | Why |
|---|---|
| **Server-side `execute()`** (no execute-less tools) | rich `OpResult` self-correction must stay inside one `agent.stream()` call |
| **`runTurn` writes nothing** (`ai`-only imports) | file-applying is a consumer concern; one stream shape, no second code path |
| **`ModelMessage[]` persisted verbatim** (not `UIMessage[]`) | wire is raw `StreamPart`, loop is `ModelMessage`-native → zero-conversion resume |
| **Whole-aggregate save, last-write-wins** | history is append-only, so the saved array only grows |
| **Caller-supplied id + lazy create** | the caller owns its id namespace; resume is free |
| **Raw `StreamPart` on the wire** (no envelope) | FE+BE ship together; `tool-result` already carries everything `toChange` needs |
| **Snapshot read per turn from `AE_SNAPSHOTS_DIR`** (read-only; the Room's live files win for a Room turn, references always from the snapshot) | the agent writes no repo and no disk; the Room's committer saves ([root ADR-0045](../../../../../../docs/decisions/ADR-0045-design-work-runs-in-the-organizations-ae-studio.md)) |
| **Human-between-turns** (`stopWhen` only, no approval pause) | restart-safe, persistence-aligned, no long-lived per-human promises |
| **The model is built per turn from the org's connection** (`AE_MODEL_CONNECTION` + `ANTHROPIC_API_KEY` in the pod env, read once at boot; none → `no_default_key`; the playground and local dev fall back to Anthropic's own API on `AGENT_MODEL`) | the organization has one connection (format, URL, key, model) for every agent ([root ADR-0038](../../../../../../docs/decisions/ADR-0038-an-organization-has-one-model-connection.md)), and a change reaches the pod when `aep-api` converges the pod's env (capabilities computed there, `modelconn.CapabilitiesOf`); each turn builds the model from the connection (`createModel`, one branch per format). The service checks a model id's shape only; whether the host serves it is the host's answer. `AGENT_MODEL` is only the default for a caller that names none (the playground, local dev) |
| **OpenCode Go requests carry the conversation ID** (`x-opencode-session`) | Go uses a stable session header for routing and prompt caching. The provider seam adds it and an AEP user agent only for the OpenAI-compatible `https://opencode.ai/zen/go/v1` endpoint; other connections keep their existing headers. |
| **Per-call options follow the format** (`modelProviderOptions(conn)`, `maxOutputTokensFor`, `modelCacheBreakpoint`) | Anthropic format: `effort`, except on Haiku 4.5 / Sonnet 4.5, which answer it with a 400 (a quirk of those ids, so the deny-list applies on this format only). OpenAI-compatible: the same level as `reasoning_effort`. The per-step output cap is `AGENT_MAX_OUTPUT_TOKENS` lowered to the connection's `outputLimit`; cache markers ride only a connection with `capabilities.promptCache` |
| **Capabilities decide, never the provider string** (`web_search` by `capabilities.webSearch`, attachments by `nativePdf` / `imageInput`) | an Anthropic-format model on another host reports the same SDK provider and cannot run Anthropic's server tool. `anthropic-server-tool` registers it; `ollama-api` registers a platform-executed `web_search` over `@aep/web-search` on the connection's own host and key; `none` registers nothing. A PDF off Anthropic's own API becomes a `text/plain` part under the same file name; an image is sent unless `imageInput` is `no`. A part the model cannot read (a scanned PDF, an image on a text-only model) is refused with a 400 naming it when the user attached it to this message (`fitAttachments`), and left out and named in the prompt when it is a reference document (`fitReferences`, before the shared attachment budget is applied), which is re-read every turn and would otherwise fail every turn of a project whose org moved to such a model |
| **History is cleaned only for turns another connection wrote** (`historyFor(messages, journal, {fingerprint, imageInput})`, fingerprint `format@host` on the journal entry) | reasoning and provider-executed tool calls replay only to the host that wrote them (an OpenAI-compatible host 400s on a server `web_search` with no tool message). The model is not in the fingerprint: Anthropic's API accepts one Claude model's signed thinking replayed to another (checked `claude-haiku-4-5` ↔ `claude-sonnet-5`, both ways), so a model change on the same host keeps the history and its cache. The one model-dependent part is an image: on a connection whose `imageInput` is `no`, every stored image, from any turn, becomes a short text naming the file, since a model without vision 400s the whole request over one. Turns from the current connection replay byte for byte, so the cache holds; the filter is deterministic, so the cleaned prefix caches again from the second turn after a switch. A copy is never the append target: the turn's tail is carried onto the stored transcript |
| **Failures the service can name end on one coded `error` frame** (`provider_limit`, `output_truncated`) | a 429 past a 5-minute `retry-after`, or a 5-minute streak of 429s, stops the turn at once instead of sleeping on a spent plan (short waits retry, `maxRetries` 6, and each one streams a `provider-wait` status frame naming the host, which the next frame supersedes); every 429 writes one scrubbed `model_provider_429` log line. The pod records the code on the failed turn (reason `agent-error`, `TurnStatus.code`). A step cut off by the output limit inside a file write fails the turn naming the file, after the transcript is saved and before any manifest, so the Room never commits a draft missing it |
| **`ask_question` / `ask_questions` Option B** (placeholder `execute()`, stop on an *accepted* question call) | structured HITL on the `files` set (console ADR-0012): a fully-resolved transcript (no `MissingToolResultsError`), turn ends `awaiting-human` only when the placeholder resolved; a call the schema rejects does not stop the turn — the model reads the error and retries — and the answer returns as the next turn's plain message |
| **Tool results carry no file content** (`OpOk` drops `newContent`) | echoing the file makes input scale file×edits (violates ADR-0001), and it is the only stale-able carrier |
| **Append-only divergence note** (FE `filesChangedExternally`; no `reconcile`) | rewriting history breaks the prompt-cache prefix |
| **Rolling prompt-cache breakpoint** (moved onto the newest message each step via `prepareStep`; the turn-prompt marker stays put) | a breakpoint fixed at the turn prompt freezes the cache boundary where the turn *started*, so every assistant/tool message the loop appends is re-prefilled uncached on every remaining step — waste quadratic in step count (measured: 750K uncached vs 445K cached input on one 20-step generation, one 70KB `loadSkill` result re-sent 19 times). The pinned marker is what the *next* turn reads from |
| **A flow's whole skill lineup is inlined up front** (`FLOW_SUPPORTING_SKILLS`, on the per-turn prompt) | the flow already names the guidance it walks, so the model's first act was a `loadSkill` batch: one model step, and ~70KB arriving as a tool *result* — landing after the turn prompt's cache marker, re-prefilled per step instead of read. Inlined, the same bytes ride inside the marked prompt: cached from step 1 and again next turn. Conditional members stay in (which components exist is decided *during* the turn, so there is nothing to condition on at compose time). Never the system prompt, whose prefix must stay byte-stable |
| **The INSTRUCTED skill is always inlined** (every non-chat instruction opens "Load the `<skill>` skill and follow it") | naming a skill and then waiting to be asked for it spends a whole model step on a body we already hold — measured at 3.8s on `/start`, 3.6s on a plan turn. Covers org-authored flows too, since resolution runs through the `SkillSource`, not this repo. Guidance a flow is CERTAIN to read therefore belongs in a skill rather than a `references/` file: references are not inlinable (ADR-0002) |
| **A file write settles at its own call** ([ADR-0004](./ADR-0004-a-write-settles-at-its-own-call.md)) | the SDK queues a step's tool calls and runs them all at `model-call-end`, so a batched design turn's first file had no verdict until the last file's body finished streaming — four completed documents shown as pending for minutes. A bundle op is a pure function of the bundle and the args, and the args close at `tool-input-end`, so it runs there and its `tool-result` rides its own `tool-call`; the ledger memoises per `toolCallId`, so the SDK's later `execute()` re-reads that verdict instead of re-applying the op |
| **SSE event types in `packages/agent-stream/src/contracts/sse-events.ts`** | one shared definition for producer, console and playground, owned by `@aep/agent-stream`; `OpResult` / tool-input types re-exported from the domain Zod schemas (no parallel copy) |

## The `/design` and `/prototype` lineups

`FLOW_SUPPORTING_SKILLS` (`src/prompts/turn.ts`) names what each flow inlines.

- **`/design`** inlines `cell-design`, `architecture`, `security-design`,
  `prototype`, the organization's design system, `openapi-conventions`,
  `agent-building` and `acceptance-criteria`. It writes each web
  application's prototype in its own run, after the data model and the roles
  (root ADR-0051); it writes no wireframes.
- **`/prototype`** only regenerates the prototypes, with edits that keep their
  ids, and inlines `cell-design`, `security-design` and the design system. Its
  brief (`FLOW_BRIEFS.prototype`) names the inputs: `design.cell`, the records
  in `domain-model.md`, the roles in `security.json`, each web application's
  `design.json` and the stories and decisions of the feature files, and
  `product-wide.md`. No review comment rides it: comments go through
  `specs/design/review.json` and `/address-comments`.
- **`prototype` is a `[design, coding]` skill.** This agent writes the
  prototype from its body; the coding run builds against its
  `references/implementing.md`.

## Areas

An **area** is a main-panel page of the console whose chat has a sub-agent of its own, and
a **focus** narrows an area's chat to one entity. A project has a **chat**
(`src/conversations/chat.ts`) for its main (spec) chat, per area (`area=issues`) and per
focus the area declares (`area=issues&focus[kind]=issue&focus[id]=<n>`, one per open
issue). Each chat has its own current thread in the `ThreadBook` and its own turn slot on
the `TurnDesk`, keyed by its use case derived from the area and focus (`""`, `issues`,
`issue-<n>`), so an Issues turn never waits on the spec chat nor one issue's on another's.
The `/v1` reads that are not addressed by a conversation id (`conversations/current`,
`turns/active`) name the chat by query (`chatFromQuery`: an unknown area, a focus without
an area, a focus kind the area's profile does not declare or an id that is not a positive
integer is `400 invalid_chat`); a turn is sent to a thread, whose chat the book knows, so a
turn body names no chat. Only the main chat rotates. An area chat's turn runs the generic
sub-agent in place of the spec editor (`toolsetFor(turn)` only derives the main agent's
`files`/`task-plan`), and it stops on an accepted question call like every agent, so a
"File this issue?" card ends the turn awaiting the user.

**Area profiles.** What a sub-agent is, is data (`src/areas/profiles.ts`): an
`AreaProfile` (`id`, `label`, an optional hand-off sentence, a `base` scope and per focus
kind an overlay scope whose stated fields REPLACE the base's) and its `AreaScope`
(`tools`: an allow-list of registry names, `skills`: the platform chat skills inlined into
the prompt, `reportsBack`). The Issues base takes `ask_question`, `ask_questions`,
`classify_report`, `search_issues`, `create_issue` and the `issue-triage` skill, and
reports back an outcome note; its focus `issue` takes the question tools, `get_issue`,
`list_components`, `comment_issue`, `edit_issue`, `close_issue`, `reopen_issue`,
`hand_to_coding_agent` and `issue-work`, and reports back `on-close-summary` (which tells
nothing yet). `scopeFor` refuses a scope naming an unknown tool or a write without a
confirmation. `buildSubAgent` makes each named built-in from the tool registry
(`src/tools/registry.ts`) and takes each named MCP tool the chat's route listed; anything
else the route lists is dropped, and an MCP tool named like a built-in never stands in for
it. A skill loader (over the `chat` audience view, `src/areas/skills.ts`) joins only when
the library has chat skills the scope does not inline. Its prompt
(`src/areas/prompt.ts`) is assembled per turn: the generic core (role, how to ask, the
go-ahead discipline, the rules), the area block (project, area label, focus: "issue
#N"), the scope's skills inlined, the catalog of the other chat skills, the confirmation
table generated from the scope's writes, and the surface's narration policy. Adding an
area is a profile, its tools in the registry and its skills in `skills/` with `audience:
[chat]`, and one entry in `AREAS` (`@aep/agent-stream`: id, label, the command a
handed-off request arrives as; a new focus kind is one more `FocusKind` there). The main agent's one hand-off tool,
`hand_off({area, request})` (`src/agents/main/tools/hand-off.ts`), is built from the
profiles with a `handOff`: its `area` enum is their ids and its description their
sentences, so a hand-off target is a sentence in its profile, never code. The schema
refuses a request shaped as an answer; the console sends the request on as the area's
command (`/issue <request>`), never as an answer, and `handOffStop` ends the turn on an
accepted call. Only the Issues area receives a hand-off and only its chat leaves the main chat a branch
note; an area's sub-agent works on no spec, so its turn is a plain chat turn (a typed
`/design` is words for it, not a flow), it joins no Room, takes no spec scope (a `400`),
gets no web search and no eager skills, and its prompt is the user's message alone, with
no divergence note and no branch note. Its tools come over its chat's own MCP route on
the tools socket (`mcpRoute`: `/projects/{p}/issues/mcp`, `/projects/{p}/issues/{n}/mcp`),
which ae-studio-tools forwards to aep-api's surface for that project and issue; the model
never names either. The usage record of an area chat's turn carries its `area` and
`focus`, so aep-api's spec status reads past it.

**Branch notes.** A turn of a scope that reports back with an outcome note (the Issues
chat) carries its `outcome` (`src/areas/outcome.ts`: `Filed #N: <title>` when it filed, else its last reply, one line, at most 400
characters); the `ThreadBook` counts them per project (`noteOutcome`), and the main chat's
next browser turn takes them as the desk accepts it (`takeBranchNotes`, once: a start the
pod refuses leaves them, a main turn that fails does not hand them on) and opens its prompt with one quoted, labelled `Meanwhile in Issues (N turns): …`
line (`branchNotesNote`, the label from the area's profile).

An **issue's thread** (the Issues area focused on the issue) is the chat on one filed issue's card; its
sub-agent's prompt names its issue number. It exists only while the issue is
open: opening its thread and starting a turn on it first read the issue through its own
route's `get_issue` (`conversations/issue-state.ts`), and a closed issue is `409
issue_closed` (its thread is removed), an unknown one `404 issue_unknown`. Unknown is read
from the tool error's code (`_meta["aep/code"]`: `issue_not_found`, which a pull request's
number also is, or `repo_not_found`), never its words; any other failure is `503
tools_unavailable`. aep-api removes
the thread when it sees the issue closed or reopened (the issue agent's `close_issue`,
GitHub's `issues.closed`/`issues.reopened`) through ae-studio-tools and the Turn socket's
`DELETE /projects/{p}/issues/{n}/thread?before=`: only threads created before the event go,
so a reopened issue's fresh thread stays, and a thread whose turn is running goes when that
turn ends (`deferIssueRemoval`, run by the desk's `finishedTurnSink`), so the turn's own
save never brings it back. The start path finding the issue closed removes it the same way
(`turns/issue-thread-removal.ts` is the one removal both use). Its tools are the question tools and,
from the turn's MCP block, the issue's own tools by contract name (`get_issue`,
`list_components`, `comment_issue`, `edit_issue`, `close_issue`, `reopen_issue`,
`hand_to_coding_agent`); anything else the server lists is left out. The route names the
issue, so the tools act on it alone. Its turns carry no `outcome`.

Every write waits on one explicit answer. The tool registry (`src/tools/registry.ts`)
gives each write its `confirm`: the question, the option that goes ahead, the option that
does not, and the layout of its change — `create_issue`: "File this issue?" → "File it" /
"Change it"; "Post this comment?" → "Post it", "Apply this edit?" → "Apply it", "Close this
issue?" → "Close it", "Reopen this issue?" → "Reopen it", "Hand this to the coding
agent?" → "Hand it over", each with "Not now". The prompt's confirmation table is
generated from it, and `gateConfirmations` (`src/tools/gate.ts`) wraps every tool in the
set that has one: unless the turn's instruction is the single-answer serialization of
that tool's option to its question (a batched answer never qualifies), the tool refuses
with an error that tells the model what to ask. Once confirmed, the tool executes
at most once in the turn; any later call is refused, so injected text in an earlier tool
result, or a retry after a timeout that did file, cannot file twice, and a failed first
attempt is reported to the user rather than retried silently.

The engine is `src/agents/confirmation.ts` (`answeredWith`, `refusing`, `onceAsShown`):
the one tool the turn's single answer confirms runs once, every other write refuses with
an error naming its question, and read-only tools are never gated. The procedure (read the
issue first, draft each change, pick the component before a hand-off, relay "Deploy a
version first" as is; classify, search, draft and file a report) is the `issue-work` and
`issue-triage` skills'.

A gate binds the tool AND its arguments to the card the user answered, not only which
write runs. The agent puts the exact change in the confirm option's `description`, in one
canonical rendering per tool (`describeChange` over the registry's layout: the comment;
"Title: …" and/or "Body:\n…"; the reason; "Component: …"; nothing for a reopen; title,
kind and body for `create_issue`). An argument the rendering does not name is shown
too, so nothing reaches the tool unshown. In the answer turn `runConversationTurn` hands the
agent the card the user is answering, read from the history the service stored before the
turn (`answerableQuestion`), never the instruction or this turn's model output. It is the
card the console lets the user answer: the one question call (`ask_question`, or an
`ask_questions` batch of one question) accepted since the user's last message. Two cards
in that turn, a batch of several, an unreadable input, or a card from before the user's
last message is no card. The confirmed tool runs only when that card asked its own
question, exactly one of its options answers as the confirm label (a repeated label, "Post
it " or "Post it — later" make the card ambiguous) and is that label, and its description
equals the call's rendering (CRLF→LF, blank lines before and whitespace after dropped; a
first line's indentation counts). Otherwise the call is refused ("Not done: …"), which uses
up nothing, as the confirmed change is still the only one that can run. A change holding a
character the card cannot show faithfully (a control character other than a line break or
tab, a format character such as a bidi override or a zero-width space, a line separator, or
another default-ignorable character) is refused whatever the card says, naming the code
point. No card in the history (an answer typed by hand) refuses too. A note on the answer does not change what was confirmed: the
prompts have the agent ask again with the revised text.

The report classifier (`classify_report`, Jev) never blocks a turn. The pod holds no Jev
key: the tool calls aep-api's `classify_report` on the Issues chat's MCP route, and aep-api
asks Jev with the platform's one key (rate-limited per org, the report capped). The tool
decides the rest: below 0.8 confidence, or for a `question`, it asks the agent to clarify;
aep-api's `unknown` (no key on the install, Jev failing, the org past its rate), a tool
error, a malformed answer or the socket not answering all yield kind `unknown` with
`needsClarification`, and the agent asks the user which kind the report is.

## Prototype write gate

A turn's file tools are built with `gates.prototypeRender` (`buildFileToolSet`),
the render check in `src/prototype/render-check.ts`: `@wso2/prototype-kit/check`'s
`checkPrototypeFiles` on the Oxygen theme's `check-runtime.js`, resolved once at
import with the kit's `resolveTheme`. A write that leaves a whole prototype pair
(`prototype.tsx`, or `prototype.json` beside an existing source) goes through
`agent-stream`'s `writeWithRenderCheck`, which draws it in an isolated Node child
(permission model, 15 s limit) asynchronously: the event loop serves other
conversations meanwhile. The write ledger queues the turn's later writes behind
a pending verdict, and `tapWrites` holds later frames, so call order and wire
order are unchanged; the turn drains the tap before it ends. The image
therefore builds the kit and the theme (`dist` runtimes) and needs Node 22. The
static stages and the `INVALID_PROTOTYPE` code with its `findings` are in
`@aep/agent-stream` (its README, Write gates).

Each child runs with a 384 MiB heap cap (`RENDER_HEAP_MB` in the kit), and that
memory counts against the pod container's 1 Gi limit, so the pod runs one check
at a time (`MAX_RENDER_CHECKS`, [pod-memory-bounds.md](./pod-memory-bounds.md)).

Before the render, `checkPrototypeFiles` type-checks `prototype.tsx` in the pod's
own process (the kit's type stage, `TYPE_ERROR`). A write that leaves a renamed
field at one stale use is refused with `INVALID_PROTOTYPE` and the line to fix,
instead of landing a prototype that draws `$NaN`. Address comments runs make
exactly that edit. The compiler and its declarations stay resident after the
first check (pod-memory-bounds.md).

## The design lineup and the org's design system

`/design` and `/address-comments` resolve to the `design` skill (the second as
a `COMMAND_FLOWS` branch with its own brief), so both inline the same lineup,
byte for byte, and share the cached prefix. A design turn and a `/prototype`
turn need the organization's design system, and the lineup holds a place for it
(`DESIGN_SYSTEM` in `FLOW_SUPPORTING_SKILLS`). `eagerSkillsFor` fills that place
with the skill named on the first line of the `## UI design system` section of
the `organization` skill (`orgDesignSystem`). When the organization names none,
nothing is inlined there. No design system skill is hard-coded.
