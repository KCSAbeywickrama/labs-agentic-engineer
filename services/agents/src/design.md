# Main Agent — prompt-driven file mutation (add / edit / remove)

> Status: design. Supersedes the `streamMd(fileName, mdContent)` full-rewrite demo.
> Clean-sheet redesign (existing `requirements-chat` / `architect` editors are prior
> art, not a constraint). Grounded in Vercel AI SDK v6 (`ai@6.0.168`).

## 1. Problem

The main agent is handed a **set of existing files inlined in its prompt** (a project's
spec bundle) and must mutate them from a natural-language instruction:

- **fresh add** — create a file that does not exist yet,
- **edit** — change part of an existing file,
- **remove** — delete a file.

The corpus mixes free-form prose and structured artifacts:

| Path | Shape |
|---|---|
| `specs/requirements/requirements.md` | free-form markdown |
| `specs/design/design.md` | markdown **+ YAML frontmatter** (`skillsApplied: [...]`) |
| `specs/design/components/<name>/design.md` | markdown **+ YAML frontmatter** (`type`, `language`, `buildpack`, `appPath`, `entrypoint`, …) |
| `specs/design/components/<name>/openapi.yaml` | **structured YAML** (OpenAPI 3.0.3), deeply nested, indentation-sensitive |

The current tool, `streamMd(fileName, mdContent)`, makes the model **re-emit the entire
file body on every call**. That is fine for fresh generation and unacceptable for edits.

## 2. The constraint that drives everything: latency

LLM wall-clock is dominated by **output-token decode** (~50–100 tok/s), while **input is
prefill-cached and effectively free** — the files are already inlined in the prompt, so
*reading* them costs nothing; *re-emitting* them is the expensive part.

> **Design objective:** output tokens must scale with the **size of the edit**, never the
> size of the file.

Worked example on the seed corpus' `hello-api/openapi.yaml` (~45 lines ≈ 320 tokens):

| Operation | Old (`streamMd` re-emit) | New (anchored `editFile`) |
|---|---|---|
| Change one example string | ~320 output tokens (~3–6 s) | ~22 output tokens (~0.3 s) |
| Ratio | — | **~14× fewer output tokens** |

The win grows **linearly** with file size — on a 300-line `design.md` it is ~50–100×. A
realistic turn (tweak 3 files, 2 lines each) emits ~80 tokens of payload vs ~900 for full
re-emit.

A **second latency axis** is agent **round-trips**: every tool call is one model step, so a
*failed* tool call is as slow as a successful one. This is why robustness is a latency
feature, and why error results must let the model recover in **one** corrective step rather
than guess-and-retry.

## 3. Decision: anchored search/replace, with two targeted reinforcements

We evaluated four families (anchored text edits · single-call batch patch · structure-aware
typed patches · streaming-native hybrid). The hybrid won on a 5-axis judge panel
(latency, robustness, simplicity, streaming-fit, structured-handling); an adversarial pass
hardened it. The shipped design:

> **Three text verbs over flat byte strings — `addFile` / `editFile` / `removeFile` —
> plus one typed escape hatch, `setFrontmatterField`, for the flat-key frontmatter edits
> where literal anchoring is fragile.** Edits stream as a live red→green diff; YAML safety
> comes from a mandatory reparse-reject guard, not from re-serializing the file.

**Why not the alternatives** (recorded so we don't relitigate):

- **Single-call `applyEdits([...ops])` batch.** Best round-trip economy, but it kills the
  live per-edit diff (this demo's headline feature), has murky partial-commit semantics, and
  regresses a fresh-generation turn back to full re-emit. *Deferred* behind a measured need;
  if ever added, it layers over the same primitives with best-effort per-op results, never as
  the primary path. See §8.
- **Path-addressed OpenAPI patches** (`setOperation(path, method, spec)`, JSON-pointer). Best
  structured safety, but a YAML printer + OpenAPI validator + deterministic re-serialization
  reflows hand-authored key order on first touch (serializer drift) and `z.record(z.any())`
  gives no streaming validation. Too much machinery for the payoff. `openapi.yaml` stays on
  anchored `editFile`, protected by the reparse-reject guard.

## 4. The tool set

All state lives in an in-memory **`FileBundle`** (a `Map<path, content>`) for the turn; the
tools are a thin AI-SDK layer over it. **Property order in every schema is load-bearing**:
`path` is always first so the runner prints the file header the instant it resolves, and the
large string (`content` / `newString`) is last so it streams delta-by-delta (mirroring the
current `fileName`-before-`mdContent` invariant in `run.ts`).

### 4.1 `addFile(path, content)`

Create a new file. The **only** tool that legitimately emits a whole body, so it keeps the
legacy full-body live stream — scoped to genuinely new files.

```ts
inputSchema: z.object({
  path: z.string(),     // must NOT already exist
  content: z.string(),  // full initial body (may be empty); streams live
})
```

- `path` exists, content **differs** → `ALREADY_EXISTS` (`message: "use editFile"`).
- `path` exists, content **identical** → `NOOP` **success** (idempotent re-add).
- `path` empty/whitespace → `INVALID_PATH`.
- Runs the **YAML reparse guard** (§5) when the new file is `*.yaml`/`*.yml` or carries a
  leading `---` frontmatter fence; on failure the file is **not** created.

### 4.2 `editFile(path, oldString, newString)`

Anchored literal search/replace. `oldString` must occur **exactly once**.

```ts
inputSchema: z.object({
  path: z.string(),
  oldString: z.string().min(1), // verbatim snippet incl. leading indentation; matches EXACTLY ONCE
  newString: z.string(),        // replacement (may be empty to delete the snippet)
})
```

Match semantics (the part that makes structured files safe):

- **No structural normalization.** Matching is literal substring over the raw text, so
  2-space vs 4-space indentation, tabs, and trailing spaces are **load-bearing and preserved
  byte-for-byte**. No YAML is ever serialized, so reflow/reorder drift is impossible by
  construction.
- **CRLF→LF normalized** on both the file and `oldString` before matching (newlines are not
  semantically meaningful in this corpus); everything else stays literal.
- After a successful replace, the **YAML reparse guard** (§5) runs; on failure the edit is
  **rejected and the bundle is left byte-for-byte unchanged**.

Result codes (each names the corrective action so the model recovers in one step):

| Condition | Code | Returned detail |
|---|---|---|
| 0 matches, `newString` already present at a unique site | `ALREADY_APPLIED` | success — idempotent; do not retry |
| 0 matches | `NOT_FOUND` | echoes the closest 1–2 file lines (with line numbers) so the model sees the whitespace/escape delta; *"copy the snippet verbatim including indentation"* |
| N > 1 matches | `NOT_UNIQUE` | `count` **and the line number + context of every match**, e.g. `Hello, World! matched 3×: L70 (info.description), L94 (example), L98 (value); extend the anchor with the parent key line` |
| `path` absent | `NO_SUCH_FILE` | lists available paths |
| post-edit parse fails | `INVALID_YAML` | `{line, col, reason, surroundingLines}`; edit rejected |

> The `NOT_UNIQUE` candidate-line echo is the **single most important behavioral fix**: the
> flagship demo edit ("change the hello message") targets `"Hello, World!"`, which appears
> **3×** in `hello-api/openapi.yaml`. Without echoed candidates the model re-anchors blind and
> burns multiple round-trips on the headline edit; with them it re-anchors in one.

### 4.3 `removeFile(path)`

```ts
inputSchema: z.object({ path: z.string() })
```

- `path` absent → `NOOP` **success** (idempotent — a stale duplicate delete must not wedge
  the loop).
- `path` ∈ reserved roots (`specs/requirements/requirements.md`, `specs/design/design.md`) →
  `PROTECTED_PATH`. *(The demo guards the two structural roots; everything else is deletable —
  blast radius is an in-memory map.)*

### 4.4 `setFrontmatterField(path, key, value)` — typed escape hatch

Flat frontmatter keys (`type`, `language`, `buildpack`, `skillsApplied[]`, …) are unique and
shallow, but editing a **multi-line block list** (`skillsApplied`) via anchored `editFile`
needs a fragile multi-line anchor whose `- ` indentation must be reproduced exactly. This
tool owns that rendering instead.

```ts
inputSchema: z.object({
  path: z.string(),
  key: z.string(),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
})
```

- Requires a leading `---` frontmatter fence; else `NO_FRONTMATTER`.
- Parses the fence block, sets `key` (preserving existing key order; new keys appended),
  re-renders the block deterministically (scalars inline; arrays as a 2-space block list),
  reassembles `---\n<fm>\n---\n<body>`, then runs the YAML guard.
- Emits ~1 token of payload and **cannot** produce a wrong-indentation write.
- Never touches the `---` fences of a prose body or anything below them.

## 5. The YAML reparse-reject guard (mandatory)

After every `addFile` / `editFile` / `setFrontmatterField` whose target is `*.yaml`/`*.yml`
or carries a leading `---` fence:

1. For `.yaml` → `yaml.parse` the **whole** post-edit document.
   For frontmatter files → `yaml.parse` the **fence block only** (the markdown body is not YAML).
2. **On parse failure: reject.** Leave `bundle[path]` byte-for-byte unchanged and return
   `INVALID_YAML{line, col, reason, surroundingLines}` so the model issues a corrective edit.
3. On success: commit.

This is **parse-only** — the guard never re-serializes, so it adds safety without serializer
drift. It closes the one real hazard of literal text editing (an edit that lands at the wrong
indentation) for the indentation-sensitive `openapi.yaml` that is the whole reason text-only
was insufficient.

> Residual, accepted risk: an edit that lands at a *wrong-but-still-parseable* column passes
> the guard. Mitigated by routing flat frontmatter through `setFrontmatterField` and by
> instructing the model to copy leading whitespace verbatim into **both** `oldString` and
> `newString`. Not eliminated; documented.

## 6. Streaming contract (console UX)

Rendering is driven **entirely** by `result.fullStream` (single render site → nothing prints
twice), keyed by tool-call id, using `parsePartialJson` over accumulated `tool-input-delta`:

- **Header on `path` resolve.** Because `path` is the first property, the header
  (`📄 path` + an op glyph: `＋` add · `✎` edit · `🗑` remove · `✑` frontmatter) prints the
  instant `path` is parseable — *independent of any body string*. (The old consumer waited for
  a second string property to appear, which would never fire for `removeFile` /
  `setFrontmatterField`; the trigger now keys off `path`. This is the one concrete `run.ts`
  change, not a reuse-as-is.)
- **`editFile`** streams `oldString` into a red `-` gutter as it decodes, then `newString`
  into a green `+` gutter — the user watches the *change*, a live unified diff, not a
  re-printed file.
- **`addFile`** streams the full body delta-by-delta (legacy UX, correctly scoped to new files).
- **`removeFile`** prints just the header line; **`setFrontmatterField`** streams `key` then `value`.
- **Outcome marker on `tool-result` / `tool-error`.** The streamed diff is a *proposal*; when
  the result resolves, the runner prints `✓ applied` · `↻ already-applied` · `✗ <CODE>: msg`.
  An edit that fails uniqueness is shown as proposed-then-rejected, never as done.

## 7. Agent loop

- `ToolLoopAgent({ model, instructions, tools: { addFile, editFile, removeFile, setFrontmatterField }, stopWhen })`.
- `stopWhen: stepCountIs(config.maxSteps)` — runaway guard; the model stops on its own once the
  instruction is satisfied.
- **Idempotency everywhere:** repaired/duplicated calls return `ALREADY_APPLIED` / `NOOP`
  success, never a hard error, so the loop never wedges.
- **No cross-file transaction.** Each `editFile` is atomic *per file*; if op 2 fails after op 1
  committed, the bundle is half-mutated and the **loop is the recovery mechanism** (the model
  reads the error result and issues a corrective edit next step). Acceptable for an in-memory
  demo; stated, not hidden. We deliberately do **not** add batch/rollback semantics to "fix"
  this (see §8).
- `experimental_repairToolCall` is a **documented seam, not wired by default** in the demo: it
  can *only* catch malformed tool-call JSON and Zod input-validation failures (e.g. the model
  stuffing a unified diff into `newString`), and on those the default loop already surfaces the
  validation error for the model to fix on the next step. It **cannot** fire on `NOT_UNIQUE` /
  `NOT_FOUND`, which are *successful* calls carrying business errors; those are made cheap via the
  rich error codes in §4.2, and that corrective round-trip is budgeted honestly in §2.

## 8. Deferred seams (documented, not built)

- **`prepareStep` + `activeTools` phasing.** For a *fresh-generation* turn (empty bundle),
  step 0 can expose `addFile` only (scaffold new files, with parallel tool calls fanning out
  independent files in one round-trip), later steps exposing the edit verbs. Our demo is
  mutation-first (seeded bundle), so all four tools are active from step 0; the phasing lever
  is left as a seam.
- **`applyEdits([...ops])` batch tool.** Add later *only* behind a measured many-site changeset
  where round-trips provably dominate; layer it over the same `FileBundle` primitives with
  best-effort per-op results.

## 9. Module layout

```
agents/src/agents/main/
  bundle.ts   → FileBundle: in-memory map + addFile/editFile/removeFile/setFrontmatterField,
                uniqueness + candidate-echo, CRLF normalization, idempotency, YAML guard. Pure + testable.
  tool.ts     → AI-SDK tool() defs over a FileBundle; tool-name constants; stable error codes.
  prompt.ts   → instructions (edit discipline: copy verbatim incl. indentation; prefer
                setFrontmatterField for frontmatter; whole-file replace via removeFile+addFile;
                react to error codes) + the seed corpus the demo mutates.
  bundle.ts   → FileBundle: in-memory map + addFile/editFile/removeFile/setFrontmatterField,
                uniqueness + candidate-echo, CRLF normalization, idempotency, YAML guard
                (yamlMode: reject | warn). Pure + testable.
  disk.ts     → DiskMirror: sandboxed real-FS backing (seed/load/reset/write/remove) for disk mode.
  tool.ts     → AI-SDK tool() defs over a FileBundle; tool-name constants; stable error codes.
  prompt.ts   → instructions + the seed corpus the demo mutates.
  run.ts      → arg parsing, in-memory or disk wiring, renderRun() (consume fullStream, render the
                live diff, stream mutations to disk, outcome markers), token usage.
```

## 10. Disk-backed live-streaming mode

A second mode persists every mutation to a real directory so you can open a file and watch it
change as the agent works. Activated by `--root <dir>`; without it the agent stays in-memory
(unchanged, keeps the pure-`FileBundle` tests valid).

```bash
npm run main -- --root foo1 "rename the hello message to 'Hi there!'"
npm run main -- --root foo1 --reset "<instruction>"   # wipe foo1/specs + re-seed first
```

- **Auto-seed**: if `foo1/specs` is missing/empty, the seed corpus is written to disk first, then
  mutated. `--reset` wipes and re-seeds. On a *fresh* dir the first run both creates and mutates,
  so open the files and run a *second* instruction to watch a change live.
- **Source of truth**: the in-memory `FileBundle` stays canonical (constructed from `DiskMirror.load()`,
  in `yamlMode: "warn"`); disk is a write-through mirror the streaming targets. Sync writes, so each
  delta lands on disk (visible to an editor's file watcher) before the next is computed.
- **Sandbox**: every model-supplied path is resolved against root and rejected if it escapes (`..`/absolute).
- **Live behavior, per op** (driven from the `fullStream` consumer, not `execute`):
  - `editFile` — when `newString` first appears, locate `oldString` in the bundle; if unique, write
    `head+tail` (oldString vanishes), then rewrite `head + newString-so-far + tail` on each delta.
  - `addFile` — create the file empty when `path` resolves, then rewrite the full body on each delta.
  - `removeFile` — `unlink` on commit; `setFrontmatterField` — re-render + write once on commit.
  - On `tool-result` the disk is reconciled to the canonical bundle content (authoritative final write).
- **Failure handling** (decided during grilling):
  - *Pre-write* failures (`NOT_UNIQUE`/`NOT_FOUND`/`NO_SUCH_FILE`/`PROTECTED_PATH`/`ALREADY_EXISTS`) are
    detected before any byte is written — the error prints and nothing touches disk.
  - *Post-stream* invalid YAML is **option B**: validation runs at the end; on failure the (invalid)
    bytes are left on disk and a warning prints (the file was already streamed there). `yamlMode: "warn"`
    keeps the bundle consistent with disk; the in-memory mode stays `reject` (atomic).
  - No cross-file transaction: each op is atomic per file; the loop is the recovery mechanism.
- **Streaming is real, not artificial**: verified against the live provider — the AI SDK surfaces
  tool-input as fine `tool-input-delta`s (~50–140 bytes each), so a ~180-word `addFile` streams to
  disk through ~14 growing states over several seconds; an `editFile` shows original → oldString
  removed → fill → final. Granularity follows the model's emission ("as fast as it can"), no throttle.
- `MAIN_DISK_DEBUG=1` wraps the disk sink to log every write/remove with a timestamp (diagnostics).

### Verified flows (e2e against the live model)

auto-seed + multi-op (edit + frontmatter + add) · addFile live growth (poller: 14 states) ·
editFile remove→fill (poller) · removeFile unlink · protected-path refusal · `--reset` re-seed ·
final YAML validity. Deterministic tests cover DiskMirror (seed/load/sandbox/remove/reset),
warn-mode, and streaming intermediate states via synthetic `fullStream` parts.
