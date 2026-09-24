# ADR-0015 — OpenCode is the second adapter, and it enforces the port with its own mechanisms

**Status:** Accepted

## Context

ADR-0012 shipped the runtime port with one adapter and refused `opencode` by name
until three spikes were recorded: pre-dispatch tool/permission parity, whether
the stream declares an agent's id, depth and parent, and how usage is reported
for cost stamping. Each unanswered one failed silently — an unenforced guard, an
inferred tree, a blanked cost. Its 2026-09-22 amendment then took the loop's one
Claude coupling out (`RuntimeSession.classify`), so a second runtime could flow
through `run_loop.ts` without faking the first one's messages.

The spikes ran on 2026-09-22 against OpenCode 1.18.32 through
`@opencode-ai/sdk@1.18.32`, on the host and once as a pod on the local cluster.
Their recordings are this package's fixtures (`test/fixtures/opencode-*.jsonl`,
README there). All three answers are yes, with corrections, and the corrections
are most of this ADR: OpenCode's failure mode is silence, and three of its
mechanisms degrade a run without an error anywhere on the wire.

## Decision

`runtime/opencode/` implements the port. The registry builds it for
`AEP_AGENT_RUNTIME=opencode`. It drives OpenCode's headless SERVER through the
SDK's typed client, not `opencode run --format json`: the CLI's JSON mode drops
child attribution, permissions and the todo list, and exits on the root's first
idle — the early-settle bug run_loop.ts exists to prevent.

### What it enforces, and with which mechanism

| Policy clause | Mechanism |
|---|---|
| `workspace` | the server's cwd and the client's `directory` |
| `env` | the server's environment, which its tools inherit — plus `OPENCODE_DISABLE_PROJECT_CONFIG`, `_AUTOUPDATE`, `_MODELS_FETCH`, `_LSP_DOWNLOAD` (`childEnvironment`) |
| `model` | config `model`, `small_model` and the one `general` subagent, `anthropic/`-spelled; usage reported back in the platform's spelling |
| `write` | the **aep-guard plugin**'s `tool.execute.before` on `edit`/`write`/`apply_patch`, the only enforcer: `external_directory: allow`, because that permission gates every tool's paths outside the project, reads included (below) |
| `webSearch`, `webFetch` | the same plugin, fed the run's staged-secret values through a 0600 file |
| `deniedCapabilities` | permission denies from `runtime/opencode/tools.ts` (`question`; the other four classes have no OpenCode tool), `share: "disabled"` |
| `skills.allow` | `permission.skill`, an allowlist written `"*": "deny"` FIRST |
| `skills.preloadBodies` | an instructions file named in `instructions`, glossary last, kept to the LEAD by the plugin (below) |
| `skills.dir` | discovered natively from `.claude/skills/` |
| `mcp` | a `remote` MCP entry behind the SAME loopback auth proxy Claude Code uses (`lib/mcp_auth_proxy.ts`), `oauth: false` |
| `observe` | called by the translator when a call's part first leaves `pending` — after the fact (below) — with the call normalised to the port's `ObservedCall` |
| `debug`, `logDir` | `--log-level=DEBUG --print-logs` into `<logDir>/opencode.stderr`, the config beside it as `opencode.config.json`; on every run, the plugin's `session-context.jsonl` |

### One skills directory for both runtimes

The project's skills stay in `.claude/skills/`, the one directory both runtimes
read natively: OpenCode scans `.claude/skills/` and `.agents/skills/`, Claude
Code only `.claude/skills/` and offers no setting to add another path
(`additionalDirectories` still looks for `.claude/skills` inside the added
directory). A neutral `.agents/skills/` would need a committed symlink in every
generated repo for Claude Code to keep its skills, so it is not used. The image
keeps `~/.claude` and `~/.agents` empty, because OpenCode also scans both under
the home directory.

The guard plugin is authored in `src/runtime/opencode/plugin/` and BUNDLED from
the same modules the Claude Code hooks are built from (`authoredPathDenial`,
`allowsWriteOutsideProject`, `webSearchDenial`, `webFetchDenial`), so the rule
and the sentence the agent reads cannot drift between runtimes. A closure cannot
cross into the plugin's process, so the egress rules are rebuilt there from the
values the runner's predicates were built from — `stagedSecretValues` over the
same env — handed over in a file, never in the config (an env var any child
reads). That file and the plugin's ready marker live in a private temp
directory, not in `logDir`: in a pod `logDir` is inside the clone the agent
commits from.

### The appendix reaches the lead only

On Claude Code the appendix is the `claude_code` preset's `append`, which is the
main thread's system prompt: a subagent gets its task prompt and discovers
skills itself. OpenCode 1.18.32 adds every `instructions` file to EVERY
session's system prompt (`session/prompt.ts`, the main loop's
`instruction.system()`), so without a correction each builder would read the
lead's whole workflow and fan-out glossary on every call. An agent's `prompt`
cannot carry it instead: it REPLACES the provider base prompt rather than adding
to it (`session/llm/request.ts`, `agent.prompt ? [agent.prompt] :
SystemPrompt.provider(model)`). A prompt's per-message `system` is not enough
either: auto-compaction's continue message does not copy it
(`session/compaction.ts`), so the lead would lose it at its first compaction.

So the file stays the carrier, and the guard plugin removes its block from the
system prompt of every session whose agent is not `aep`, in
`experimental.chat.system.transform` — the last hook before the provider call
(`llm/request.ts`). That hook is told the session, not the agent; the agent
comes from `chat.message`, which fires when a session's user message is created
and before its first model call, and a session not seen there is treated as a
subagent (`plugin/context.ts`). The block is matched by its content, as
`Instructions from: <path>\n<content>`. Proven with no model call by
`test/fixtures/probes/opencode-probe-appendix.mts`: a `subtask` part spawns a
`general` child without the model deciding to, and a second plugin dumps each
system prompt after the guard's transform — the lead's has the appendix, the
child's has OpenCode's base prompt, the environment and the skill catalog and
not the appendix; with the guard replaced by a no-op plugin the child's has it
too. A bump of `OPENCODE_VERSION` re-runs that probe with the startup checks.

The plugin also records, per session, the agent, whether the appendix was in
its first model call, and each `skill` tool call, into
`<logDir>/session-context.jsonl` (`lib/run_context.ts`; the Claude adapter writes
the same shape from `SubagentStart` and `PreToolUse` on `Skill`).

### Silent failures, asserted at start

Before the prompt is sent (so a refusal costs no model call), `bootOpencode`
proves three things and fails the run with an `error` notice otherwise
(`startup.ts`):

1. **The guard loaded.** A plugin that is not a package directory with a
   `package.json` naming its entry is skipped without a log line (S1, S1b). The
   plugin writes a marker at init; no marker, no run.
2. **The workflow's tools are visible and `question` is not.** A tool is hidden
   when the LAST rule matching its permission is a `*` deny, so an allowlist
   written allows-first hides the whole tool (S1 lost `task` and `skill` that
   way). `/experimental/tool` lists what the registry offers BEFORE permissions,
   so the check applies OpenCode's own rule (`Permission.disabled`, ported) to
   the `aep` agent's merged rule set from `GET /agent`. The port is of
   1.18.32's rule: bumping `OPENCODE_VERSION` (and `@opencode-ai/sdk`) means
   re-checking `hiddenTools` against the new source, because a drifted rule
   passes the check while the tool is hidden.
3. **Fan-out is foreground.** The `task` tool's schema must not carry
   `background` — its presence means `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS`
   leaked into the pod.

All three were checked against the real binary with no model call: on the host
and inside the built image (the boot passes; a missing plugin and a leaked flag
each refuse, with their sentence).

### Fan-out is foreground-only on OpenCode

The platform does not set the experimental background flag (product owner,
2026-09-22). A wave is dispatched as parallel `task` calls in one message; they
run concurrently and each returns its builder's report, and the lead is held
until the slowest returns. Every OpenCode agent is `agent_started {background:
false}` — stated, not omitted. The OpenCode glossary entry
(`lib/tool_glossary.ts`) says so in the lead's own terms, so the skill's prose
("dispatch in the background … keep working while they build") needs no edit.
The cost is ADR-0014's idle lead, accepted, and revisited when
the feature leaves experimental. The close rule below would not survive that
mode unchanged: replaying S2c shows it closing before the lead's wrap-up turn.

### The stream's end is decided by a rule, not by the bus

OpenCode's bus is the whole server's and does not end. The session's stream ends
when the ROOT session is idle (`session.idle`, not the `session.status` half of
the pair — the classifier ends the turn on the former), no other session is
busy, and no permission is waiting. With foreground fan-out the root cannot
idle before its children, so the rule is a guard rather than the settle itself;
it stays because a rule that holds only by timing is not a rule. `endInput` is a
no-op (the prompt goes out with `promptAsync`); `stopTask` is `session.abort`
on a child session id.

### What the loop is told

The classifier (`classify.ts`) maps the bus onto the port's classes the way the
Claude one maps the SDK's: `session.status {retry}` is a retry, a permission ask
is a `permission_denied` stall signal (the runtime rejects every ask; server mode
has no one to answer and an unanswered ask is a hang), `message.part.delta` and
`session.status {busy}` are model waits (each also a rate-limited
`heartbeat {waitingOn: model}`), the root's idle is a turn end, a child's creation and idle are task
bookkeeping. Two port changes came with it:

- **`MessageClass` gained `noise`.** The bus carries keep-alives, plugin and
  catalog announcements, and file-watcher echoes; as `activity` they would call
  `watchdog.observe([])`, which resets the idle clock, and a stalled run would
  look busy for as long as the server stayed up. Recorded, never translated.
- **`ApiRetryInfo.maxRetries` is nullable.** OpenCode's retry status carries the
  attempt and the next attempt's time, not a ceiling, and printing one would
  state a bound nobody enforces. Its free-text message is reduced to a closed
  word before it reaches the line.

Two facts the bus does not carry are the ADAPTER's own messages on its stream:
`aep.skills` (the skills `GET /skill` says the server discovered, for the loop's
preload check — OpenCode has no `init`) and `aep.tick` (a ten-second clock,
because OpenCode sends nothing while a tool runs; the translator turns it into a
rate-limited `heartbeat {waitingOn: tool}` for each call still running).

### Translation

Agent id = session id; parent = `Session.parentID`; label and role from the
spawning `task` part's input; the part goes running ~400 ms BEFORE the child's
`session.created`, so a spawn is keyed by `metadata.sessionId` and
`agent_started` goes out when the second half arrives. Reports are the child's
last assistant text. Line counts come from successful `write`/`edit` inputs,
because every session summary on the wire is zero. A shell call that ran to a
non-zero exit is `completed` on the bus and `ok: false` on the feed, with its
exit code. The plugin's refusal carries a marker in the tool's error text, which
is the only place the runner sees it; the translator turns it into the same
`workspace_guard` notice the Claude hook raises (`policy.write.onDenied`).
Usage is summed per model across EVERY session, cumulatively, with
`outputTokens = output + reasoning` (the provider bills reasoning as output; S1c
only prices to its reported cost that way).

### The validation status line is posted after the fact

ADR-0012 pinned that `observe.toolUse` is awaited, so the validation status line
lands before the silence it explains. The bus reports a call that has already
started, and the plugin has no `gh` context, so on OpenCode the watcher is called
when the part first leaves `pending` — typically under a second in — and is not
awaited (product owner, 2026-09-22). The weaker ordering is this runtime's.

### The image is a second target of the same Dockerfile

`FROM runner AS runner-opencode` adds `opencode-ai@${OPENCODE_VERSION}` (pinned,
version asserted by running it), the plugin built to
`/app/runtime/opencode/aep-guard`, and a pre-warmed home: the build boots an
instance as `aep` against a throwaway directory (a bare `serve` only fetches the
model list, S5) and asserts `models.json`, `bin/rg` and the
`@opencode-ai/plugin` dependency are on disk, so a pod starts without npm, GitHub
or models.dev. The file ends in a bare `FROM runner`, so every build path that
names no target still gets the Claude Code image; `build-runner.sh` builds,
imports and pins both tags (`aep-runner:dev`, `aep-runner-opencode:dev`), and
`FORCE=1` rebuilds both.

### One model serves every call, on both runtimes

`RuntimePolicy.model` (`AEP_AGENT_MODEL`) is the only model a run uses: the
lead, every subagent and the runtime's own helper calls. On OpenCode it is
`model`, `small_model` (set explicitly, so titles and summaries never fall to
OpenCode's own pick, which the org's key may not reach and the platform may not
price) and the one `general` subagent. On Claude Code every alias
(`ANTHROPIC_DEFAULT_SONNET_MODEL`, `_HAIKU_`, `_OPUS_`, `_FABLE_`) and
`CLAUDE_CODE_SUBAGENT_MODEL` are pinned to it (`modelPinEnv`), so the CLI's
helper calls, which resolve through the `haiku` alias, and any alias a fan-out
call names land on the same model. The glossary resolves the skill's "the fast
model" and "the default one" to that one model.

## Consequences

- The org's `agents` setting selects the runtime; the dispatcher stamps
  `AEP_AGENT_RUNTIME` and picks the image for it (`aep-runner:dev` or
  `aep-runner-opencode:dev`). The playground runs either with
  `AEP_AGENT_RUNTIME=opencode pnpm play <dir> code`.
- OpenCode needs `ANTHROPIC_API_KEY`; a Claude subscription token is refused at
  start. The platform never hands it one: dispatch mounts the org's subscription
  only on Claude Code (aep-api ADR-0036).
- `external_directory` is `allow`, and the guard plugin is the platform's only
  write gate on OpenCode, as `lib/workspace_guard.ts` is on Claude Code. In
  1.18.32 that one permission is asked (`tool/external-directory.ts`) by `read`,
  `glob`, `grep` and `lsp` as well as `edit`/`write`/`apply_patch`, and by
  `bash` for a path argument of `cd`/`cat`/`cp`/`rm`/… or a `workdir` outside
  the project (`tool/shell.ts`); it has no read/write split. It was first set to
  `deny` as a backstop behind the guard, and a live validation run was refused
  reading `/tmp/validation-context.json`, the context file the platform writes
  for it: `deny` was wider than the platform rule (reads are not gated; writes
  may land in the temp dir and any `~/.` directory). The guard's own denials were
  never pre-empted: `tool.execute.before` runs before a tool asks any path
  permission, so the agent reads the guard's sentence. A pattern map could not
  restore parity: it would gate reads the same way, and be a second copy of the
  rule to drift. `allow` also keeps OpenCode's own default (`"*": "ask"` plus a
  whitelist) from raising an ask, which a server run rejects as a denial.
- **The watchers read a runtime-neutral call.** `RuntimeObservers.toolUse` takes
  an `ObservedCall` (`shell {command}` | `write {path, content}` | `edit {path}` |
  `other {tool}`, `runtime/port.ts`) instead of a runtime's tool name and input,
  and each adapter's `tools.ts` supplies the `observedCall` that spells its own
  tools into it. A watcher reads only that call: matching one runtime's names
  (`Bash`, `Write`, `file_path`) would match nothing on the other, silently. The
  validation watchers that first read it were retired upstream with the move to
  acceptance scenarios, so the seam has no production caller today;
  `runtime/opencode/observe.test.ts` drives one session through the OpenCode
  translator and asserts the observer receives the same calls and outcomes as
  the same session through Claude Code's normaliser. This
  supersedes ADR-0012's "`observe(toolName,
  toolInput, toolUseId)`".
- The adapter contract test (`runtime/contract.test.ts`) holds both adapters to
  the same run-event shape on the closest recorded pair (a 3 + 1 fan-out). The
  design's one scripted session with a denied write and a commit, recorded from
  both runtimes, is the fixture still owed; those rows are pinned per adapter.
