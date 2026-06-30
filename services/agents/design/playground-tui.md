# Playground TUI

A dev-only terminal chat over the main spec agent's SSE endpoint. A **thread** is
a folder under `chat_playground/<name>/` whose name is also the conversation id;
chatting at it edits the thread's files across turns. Usage: see
[`../playground/README.md`](../playground/README.md).

## Why it's a pure client

`@aep/agents` **writes no files** — a turn is one `POST /conversations/:id/turns`
with the full `files` snapshot inlined; the server streams `StreamPart` frames and
discards its working copy. So the TUI owns the disk: each turn it reads the folder
→ POSTs → folds the streamed `tool-call`s back through a `FileBundle` → writes the
folder. No new agent/server code; it reuses `streamTurn`, `applyToolCall`,
`FileBundle`, and `loadRepoSkills`.

## Shape

- **In-process** — boots the Express app on an ephemeral port (eval-harness
  pattern) and drives it over real HTTP. History is in-memory (dies on quit); the
  folder is the durable state and is re-inlined every turn.
- **`@clack/prompts`** for the thread picker/create, **`node:readline`** for the
  streaming chat. Repo-root `skills/` pushed every turn (catalog + `loadSkill`).
- **Auto-writes** the agent's changes after each turn (`--dry-run` to preview).
  Per-change accept/reject is the browser editor's job, not this scratch tool.
- Lives in `playground/` (sibling of `evals/` — `src/` writes no files); thread
  data in gitignored `chat_playground/`.

Verified end-to-end (create, multi-turn, reopen, manual-edit pickup, dry-run).
A scratch tool, so no ADR — the file-ownership rationale lives in
`agent-loop-and-eval-framework.md`.
