# Task log stream — one SSE endpoint for a Task's status + timeline

**Status: BUILT** (backend + console-legacy; automated gates green, live e2e
pending). Companion to `temporal-devflow-orchestration.md` (the build flow) and
the tasks-github-native model (Task = GitHub issue + machine block;
executions-only DB).

### As built — deviations from the design below

The shipped implementation follows this design with four deliberate refinements,
each forced by an existing constraint:

1. **Frame type is a payload field, not an SSE `event:` name.** The console's
   shared SSE parser (`@aep/agent-stream` `parseSseStream`, reused verbatim)
   keeps only `data:` lines and drops `event:`/`id:`. So a frame is
   `data: {"type":"task"|"execution"|"line"|"done", …}` — self-describing, like
   the agents turn stream — rather than `event: task`. The `id: <n>` line is a
   per-connection frame counter (SSE-spec hygiene), not consumed by the client.
2. **Resume is client-side dedup, not a server cursor.** There is no
   `?sinceSeq=`/`Last-Event-ID` server input. On (re)connect the server re-emits
   current state; the client upserts task/execution by id and dedups lines by
   `executionId+seq+ts+kind+content`. This keeps the server stateless (no frame
   buffer) at the cost of re-sending a bounded snapshot on reconnect.
3. **Op id `stream-task-log`** (renamed from `get-execution-progress`), same
   path, modelled `text/event-stream` in the hand contract. Registered in Go via
   `huma.StreamResponse` + `humakit.SSEBody` (the `stream-turn` mechanics).
4. **Two-rate live loop, not one tick.** A fast line tick (2s, DB + cluster
   proxy / OC — never GitHub) streams logs; the GitHub-backed task snapshot
   re-derives only on a hub notify + a slow 8s safety tick, so an open page does
   not poll GitHub every 2s. Notifier hooks are wired at the PR webhook
   (opened/merged/rejected), the JobWatcher (coding fail), and the ExecWatcher
   (build success/deploy/fail); the funnel's admit path relies on the tick.

Backend: `internal/feature/execution/{task_stream.go,task_stream_hub.go}`,
`ProgressService.GetProgress` reused for per-execution lines, the cursor-poll
handler deleted. Console-legacy: `hooks/useTaskStream.ts` +
`components/tasks/TaskTimeline.tsx`; `useExecutionProgress`/`useCursorPolling`
deleted. `BuildStatus.tasks[]` re-sourced from the lineage-tag read + given
`issueNumber` (durable across archived runs).

## Context

A Task (GitHub issue) accumulates **executions** — attempts of different kinds
(`coding`, `build`, `deploy`, retries) — under the single-tag build flow, where
`POST /projects/{p}/build` is the **only** thing that plans and executes tasks.

Today the read side of that story is fragmented:

- `GET /tasks/{n}/log` assembles the feed **per kind at read time**: a running
  coding execution live-tails the `ca-…` pod through the cluster-gateway proxy,
  a terminal one reads the `coding_agent_logs` snapshot, a build execution
  synthesizes steps from the OpenChoreo WorkflowRun, a deploy has nothing.
- The task detail page runs **three pollers** (task re-fetch, execution log
  cursor poll, plus the board's build poll one page up), each with its own
  cadence and lifecycle.
- Per-task state exists in **two shapes**: `TaskView.derivedStatus` (GitHub
  facts ⋈ executions) and the workflow's `BuildStatus.tasks[]` — which joins by
  *title*, so the console cannot link a build-status row to its issue, and
  which evaporates once the Temporal run is archived (the row fallback carries
  no tasks).
- The FE must manage **execution identity** (pick an id from
  `executionHistory`) just to read logs.

## Decision

Refactor `GET /projects/{p}/tasks/{issueNumber}/log` into **one SSE stream**
that carries the Task's *entire* live state: status, executions, and a unified
timeline across all attempts. No separate `/events` endpoint — SSE event names
multiplex the kinds on one connection. The plain `GET /tasks/{n}` JSON snapshot
stays (instant first paint; non-streaming clients); everything live rides the
stream.

Principle: **GitHub owns what a Task *is*; the platform owns what *happened to
it* — and "what happened" is one ordered stream, not four bespoke read paths.**

## API design

### Surface (contract)

```
GET  /projects/{p}/tasks                     → TaskView[]           unchanged (the board poll)
GET  /projects/{p}/tasks/{issueNumber}       → TaskDetail           unchanged (snapshot)
GET  /projects/{p}/tasks/{issueNumber}/log   → text/event-stream    REWORKED (this design)
POST /projects/{p}/build                     → { tag }              unchanged (the only executor)
GET  /projects/{p}/build/{tag}               → BuildStatus          tasks[] KEPT + given identity (see below)
```

**`GET /build/{tag}` is the tag-scoped task list.** It is not a duplicate of
the board — it is the *alternative* to `GET /tasks`, filtered through one spec
version, and stays a cheap poll. Two changes make it fit that role:

- **Identity, not title-join**: `BuildStatusTask` gains `issueNumber` —
  `{ issueNumber, title, status }` — so the console links every row to its
  issue (and to this stream). The title-join hack dies by *fixing* the shape,
  not by removing it.
- **Durable sourcing**: today `tasks[]` comes from the live Temporal query and
  vanishes when the run is archived. Every planned issue is already stamped
  with its lineage tag (`v<N>` in the machine block), so the durable source is
  the task read filtered by lineage tag — the same live GitHub ⋈ executions
  read behind `GET /tasks`, scoped to the build. The workflow query then only
  refines in-flight status (`status`, `workflow_status`); a completed or
  archived build still answers with its full task list.

**`GET /tasks` stays.** It is the project-wide board poll (all versions,
current state) and remains the console board's source; `GET /build/{tag}` is
its version-scoped sibling, not its replacement. The two coexist — the board
reads `/tasks`, a version view reads `/build/{tag}` — and cross-version lineage
lives on the issue's tag stamps regardless.

`plan-tasks` / `execute-task` / `hold` stay served as ops levers (manual retry,
hold) but remain **out of the contract** — the build flow is the executor.

### The stream

```
GET /projects/{p}/tasks/{issueNumber}/log
    Last-Event-ID: <seq>   (or ?sinceSeq=) resume cursor — the ONLY input
Accept: text/event-stream
```

There are deliberately **no server-side filters** (`?executionId=`, `?kind=`).
Under the build-driven flow the console never originates an execution
identity — it only learns ids *from* this stream — so a filter would re-add
the exact coupling this design removes, and force a reconnect per click in
the history browser. Every line carries its attribution; filtering and
grouping are client-side over data the page already holds. (The interim
cursor-poll endpoint kept `?executionId=` because a per-execution poll cannot
serve history any other way; the unified stream obsoletes it.)

Frame vocabulary (`id:` carries a per-task monotonically increasing `seq`):

```
event: task        data: TaskView              on connect, then on every change
event: execution   data: ExecutionView         one per attempt on connect, then on change
event: line        data: TimelineEvent         a timeline entry (see below)
event: done        data: {"derivedStatus":…}   task settled → server closes the stream
: heartbeat                                    comment every ~15s (proxy keep-alive)
```

`TimelineEvent` = today's `ProgressEvent` (kind: `phase | tool_use |
git_commit | git_push | gh_action | build_step | log | result`, seq, ts,
kind-specific fields) **plus attribution**:

```json
{ "executionId": "e7", "executionKind": "coding", "kind": "tool_use",
  "seq": 143, "ts": "…", "tool": "Edit", "summary": "internal/api/server.go" }
```

Connect semantics: `task` snapshot → `execution` snapshot per attempt →
replay of `line`s after the resume cursor → live. A terminal Task streams its
full history then `done` and closes — historical tasks cost one short-lived
request, never a poll loop. Reconnects are idempotent: the client upserts
`task`/`execution` by id and appends `line`s by seq.

Answering the design fork this replaces: *kind as query param vs payload field
vs SSE event kind* — two of the three, each where it belongs. **Payload
field** for attribution (`executionId`/`executionKind` on every line) and
**SSE event name** for the frame type; the query-param option is rejected
(see above — the stream's only query input is the resume cursor). History
browsing becomes a client-side group-by over one feed, never an identity the
FE must manage.

### Contract modelling

OpenAPI 3.1 models the op with `content: text/event-stream` whose schema is
one `TaskStreamEvent` frame — an open object discriminated by the SSE event
name, same style as the agents turn stream. The old `ProgressResponse` cursor
polling op is retired with it.

## Backend design

New `TaskStream` service in `internal/feature/execution` (the platform half of
the Task split — it never imports `feature/task`):

- **Snapshot**: task view + execution rows via the existing reads (ports, as
  today).
- **Line sources** (the current per-kind logic, moved behind one interface):
  - coding, running → **one shared pod-log tailer per execution** (not per
    client) via the cluster-gateway proxy; lines fan out to subscribers.
  - coding, terminal → `coding_agent_logs` snapshot replay.
  - build, running → OC WorkflowRun step poll (server-side, one per running
    build execution), diffed into `build_step` lines.
  - workflow moments with no execution (task skipped: dependency failed) →
    synthesized `line` of kind `result` from the parent workflow signal.
- **Change notifications**: an in-process broker keyed by `(repo, issue)`. The
  writers that already know about changes — the GitHub webhook handlers,
  `JobWatcher`/`ExecWatcher`, the funnel — get a nil-safe `TaskNotifier` hook
  at the composition root (exactly the devflow-signaler pattern). On notify,
  the stream re-derives `task`/`execution` events and pushes deltas.
- **Resume**: `seq` is deterministic per source (line index for pod
  logs/snapshots, step index for builds), offset per execution — a reconnect
  re-derives and skips ≤ cursor.
- **Fallback safety**: a slow 15–30s re-derive tick while the task is live, so
  a missed notification degrades to latency, not wrongness (same posture as
  the devflow signal-miss poll).

**Explicitly not (yet) in scope — durable event table.** A `task_events`
append-only table would make replay uniform and survive multi-replica BFFs,
but today aep-api runs single-replica, coding history is already durable via
the snapshot, and build steps re-derive from the WorkflowRun. The broker +
re-derive design above needs **no schema change**. The table is the known
evolution when: (a) the BFF scales out (broker → LISTEN/NOTIFY), or (b) we
want non-coding history to outlive OC run retention.

## Console-legacy design

- One `useTaskStream(projectId, issueNumber)` hook (SSE reader on the
  agent-stream parser utilities, with automatic reconnect + `Last-Event-ID`)
  reduces frames into `{ task, executions[], lines[] }`. It replaces
  `useExecutionProgress`, `useCursorPolling` on this page, and the detail
  page's task re-poll — three pollers → one connection.
- `TaskActivityFeed` renders the unified timeline; the execution history
  browser becomes collapsible per-attempt groups over the same data (zero
  extra fetches). `selectedExecId` state dies.
- The board keeps **polling, never streaming**: one cheap query beats a
  connection per row. It polls `GET /tasks` (project-wide, current state), with
  `GET /build/{tag}` as the version-scoped view while a build runs. Both stay.
  Stream latency only pays on the detail page where logs are watched.

## Trade-offs

- **SSE through the console nginx proxy** — already proven by the agent turn
  streams (buffering disabled); the stream reuses that path.
- **Connection per open task page** — bounded by human tab counts; heartbeat
  comments keep intermediaries from reaping idle streams.
- **Single-replica assumption** for the in-proc broker — stated above, with
  the LISTEN/NOTIFY/table evolution when it breaks.
- **Status duplicated** between `GET /tasks/{n}` and the stream's `task`
  events — deliberate: snapshot for paint, stream for truth-over-time.

## Sequencing

1. Contract: rework the `/log` op to `text/event-stream` + `TaskStreamEvent`;
   add `issueNumber` to `BuildStatusTask`. (Both are ours to change;
   console-legacy is the only consumer.)
2. Backend: re-source `BuildStatus.tasks[]` from the lineage-tag read (durable
   for archived runs; workflow query refines in-flight status) — the identity
   fix and the title-join removal land together.
3. Backend: `TaskStream` service + broker + notifier hooks; line sources moved
   behind the interface (logic unchanged); delete the cursor-poll handler.
4. FE: `useTaskStream` + grouped timeline; delete the per-execution polling
   plumbing.
5. Later (triggered, not scheduled): `task_events` table when scale-out or
   retention demands it.

## Open questions

- Should the board's build poll also fold into a project-scoped stream once
  the detail-page pattern proves out? (Deferred — poll is fine there.)
- Retention of `coding_agent_logs` for superseded attempts (keep last N per
  task?).
