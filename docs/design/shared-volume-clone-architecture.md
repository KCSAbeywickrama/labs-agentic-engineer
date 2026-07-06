<!--
Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
Licensed under the Apache License, Version 2.0.
-->

# Shared-Volume Clone Architecture & Committed-Truth Generation — aep-api & agents-service

**Status:** Implemented (2026-07-06). **Companion:** [`git-operations-inventory.md`](./git-operations-inventory.md)
(the 215-operation scenario→operation catalogue this design refactors).
**Scope:** `services/aep-api` + `services/agents` + the console generation
flows. The isolated remote coding-agent worker (`runners/remote-worker`) is out
of scope but is the proven precedent we converge with. The OpenChoreo build
plane keeps its own clone (see D10). Tasks/coding-agent execution is untouched.

---

## 1. Summary

Today aep-api holds **no local git clone**. Every read of a repo walks the GitHub
Git-Data API — `GetRef → GetCommit → GetTree(recursive) → N×GetBlob`, **one HTTP
call per file** — and this walk is re-implemented in **four** features, each with
its own cache. Every agent turn serializes the **entire codebase** (`Files
map[string]string`) plus all `Skills[]` inline into the POST body to
agents-service. And the **frontend owns the uncommitted draft** (localStorage
`aep:spec-draft`): it folds the generation stream locally and later POSTs the
folded result back for commit + tag — the FE is the commit authority.

This design replaces all of that with a **git-object engine over a shared RWX
volume** and a **committed-truth generation model**:

- **One bare mirror per repo** (`git clone --mirror`), mounted identically into
  aep-api **and** agents-service (and every replica). The mirror is the shared
  object store; **it is never checked out**.
- **Reads collapse to git plumbing** against the mirror (`ls-tree`/`cat-file`/
  `archive`); **writes collapse to plumbing** via a throwaway index
  (`write-tree`→`commit-tree`→`push --force-with-lease`) — origin stays the
  CAS arbiter.
- **There is no uncommitted state.** Generation **auto-commits to `main`** when
  its stream ends (gated by an integrity manifest from the agent); manual edits
  commit via the existing `files.Apply`; **approve = tag-only**; **discard =
  revert**. The FE never sends file content to the backend again; its fold is
  display-only.
- Agents read **immutable per-SHA snapshot dirs** beside each mirror, so the
  turn payload shrinks from the whole codebase to IDs + shas
  (`conversationId`, `turnId`, `repoSlug`, `ref`, `skillsRef`) — never paths.
- Turns run **server-side, detached from any client**: `POST turn → 202
  {turnId}`; any tab or user attaches to a **resumable stream** (replay + live
  tail). aep-api is a stream **broker**, not a passthrough pipe.
- **aep-api is the sole writer**; agents-service is strictly read-only. The
  runner keeps its own isolated clone.

The state model is **two states: committed (`main`) and approved (tag `vN`)**.
Internally a write is a **loose commit** (sub-second, unreferenced) → **origin
after push**; we never keep a persistent unpushed local commit, so
`committed-local ≡ committed-remote` at rest and the divergence problem is
**structurally eliminated**, not managed.

```
            BEFORE (FE-owned draft)                       AFTER (committed truth)
  agents ─SSE─► aep-api ─passthrough─► FE        agents ─SSE─► aep-api (tap: Go fold, in-memory)
                              FE folds, holds                     │ manifest ok
                              draft in localStorage,              ▼
                              POSTs it back to commit      Mutate → commit → push ── origin ──►
                                                                  │
                                                       part buffer (replay + tail)
                                                                  │
                                                  FE / any tab ─► GET /turns/{id}/stream
                                                  (display-only fold; attach anytime)

  reads:  4× GetRef→GetCommit→GetTree→N×GetBlob   reads:  git fetch + ls-tree/cat-file (filesystem)
  agents: whole codebase + skills in POST body    agents: /workspaces/repos/<…>/snapshots/<sha>/ (RO)
```

---

## 2. Motivation

| Problem (today) | Evidence | This design |
|---|---|---|
| Codebase read = `GetRef+GetCommit+GetTree(recursive)+N×GetBlob`, one HTTP call **per file** | inventory C1; `artifacts/git_reader.go`, `files/files_service.go`, `skills/repo_store.go`, `genai/genai_reads.go` | one `git fetch` + `ls-tree`/`cat-file` — a filesystem read |
| That walk is **re-implemented 4×**, each with its own HEAD-SHA/soft-TTL cache | C1 | one `gitfs` engine, one `Workspace` port |
| The **whole codebase + all skills** ship inline in every agent-turn POST | `agentsvc.TurnRequest.Files/Skills`; `run-conversation-turn.ts` | payload = `{conversationId, turnId, repoSlug, ref, skillsRef}` |
| **The FE owns the uncommitted draft** (localStorage) and is the commit authority | `specDraftSession.ts`; `git_reader.go` header comment | the draft is **abolished** — generation auto-commits to `main` (D13); FE fold is display-only |
| The generation stream lives on the POST request — a refresh mid-generation loses the live view | genai SSE-on-POST | resumable turn stream: `202 {turnId}` + replay/tail (D16) |
| Three **uncoordinated on-disk clone actors** already exist (runner, OC build, gittest) | C2 | one shared authoritative mirror; converge conventions |
| Write assembly (`CreateBlob→CreateTree(base overlay, sha:null delete)→CreateCommit→UpdateRef`) duplicated across 3 write paths | C5 | one `Mutate(fn)` with the CAS retry inside |

**Non-goals.** Replacing the GitHub REST client (issues/labels/PRs/webhooks/
installations have no local equivalent — §9); modifying the remote worker;
spanning the RWX volume across the OpenChoreo build plane (D10); a permanent
dual REST/disk backend (D11); squash/rewrite of `main` history (commit noise is
accepted, tags mark milestones — §17.12).

**Deliberately deferred (not un-addressed — see §18).** The inventory's
coding-agent **execution/dispatch + build** cluster — runner clone onto the Job
emptyDir, `GITHUB_TOKEN` ExternalSecret staging, the Job manifest's
`AEP_REPO_URL`, the per-run token Secret, the post-merge build's
`checkout-source` clone, and the git-clone-auth retry class — is **left as-is**
this round. The inventory notes each *could* collapse once aep-api owns a
server-side clone. We decline that now: it introduces a **second writer** (the
runner) and a real working tree on the shared mirror, which needs its own
lock/lease design (D3, D10, §17.7). These items are **consistent with** this
design — they simply stay on their isolated clones until a follow-up phase.

---

## 3. Architecture decisions

The heart of the design. D1–D12 = the volume/engine; D13–D20 = the
committed-truth generation model. `G*`/`C*` refer to the companion inventory.

| # | Question | Decision | Why (rejected alternative) |
|---|----------|----------|----------------------------|
| **D1** | One git-object abstraction — where does it live? | A single domain port **`gitrepo.Workspace`** in `internal/feature/gitrepo/workspace.go`, backed by one adapter package **`internal/platform/gitfs`**. A second optional `SnapshotProvider` port isolates the agents-mount concern. | Deliberate, not diff-minimizing: post-Phase-5 the `Workspace` port is the sole *raiser* of the git sentinels (`ErrRefNotFastForward`, `ErrTagAlreadyExists`), so port + sentinels + `coords.go` cohere in `gitrepo` — the domain "the project's git repo" keeps two surfaces, remote-REST (issues/webhooks/admin) and local-object (`Workspace`). `gitfs` is local infra → `internal/platform` beside the `gittest` harness it supersedes. (New `feature/workspace` pkg → drags the sentinels with it and leaves `gitrepo` raising errors it no longer owns; `internal/clients` is for HTTP providers.) |
| **D2** | git porcelain vs plumbing vs go-git? | **git plumbing** over the system `git` binary: reads = `rev-parse`/`ls-tree -r`/`cat-file`/`archive`; writes = throwaway `GIT_INDEX_FILE` + `read-tree`/`update-index --cacheinfo`/`--force-remove` → `write-tree` → `commit-tree` → `push --force-with-lease`. The bare mirror is **never checked out**. | Plumbing is 1:1 with the retired Git-Data API (blob=hash-object, tree=write-tree overlay, sha:null=`--force-remove`, ref-CAS=`--force-with-lease`), so the FF-CAS + tag-collision *semantics* carry over exactly. Never checking out kills the shared-`index.lock` race (G1) and the divergence surface (G4). Decisive over go-git: multi-**process** safety on one shared bare dir (C git's `*.lock`/quarantine/atomic-ref protocol is the reference implementation; go-git isn't hardened for concurrent processes on shared storage), child-process fault/memory isolation for a long-lived multi-tenant server, and feature gaps (`archive`, exercised `--force-with-lease`, partial clone). Plumbing with `-z` is git's stable machine API — this is not porcelain scraping. |
| **D3** | Who may write the mount / who is the commit authority? | **aep-api is the sole writer** of git and the mount; agents-service is strictly read-only; the runner keeps its own clone. aep-api **taps + folds the agents stream in memory** and commits it (D14) — it is a stream **broker**, not a passthrough pipe. | Single-writer is the cheapest bulletproof invariant and keeps agents `src/`-writes-nothing (still replayable in evals against a fixture dir). With the FE draft abolished (D13) the server *must* fold the stream to have anything to commit; "verbatim passthrough" is retired in favour of the broker (D16). |
| **D4** | What do agents read as plain files? | **Immutable per-SHA snapshot dirs** — `repos/<org>/<proj>/<slug>/snapshots/<sha>/` (and `_skills/org-skills/snapshots/<sha>/`), materialized once per sha by aep-api (`git archive`), read-only for agents, reaped by age + not-current-HEAD. There is **no draft to overlay** (D13), so a turn's input is a pure function of a commit sha. There is **no `sessions/` tree.** | The mirror is bare (no readable files) and agents is git-blind, so *some* plain-file materialization is unavoidable. Per-SHA immutability gives: zero races for mid-turn on-demand reads (`loadSkill` reads bodies mid-turn while other commits land), sharing across conversations/turns/replicas (one materialization per commit, not per turn), and no lease/heartbeat machinery — a sha's content can never change. (Mutable per-repo checkout → torn mid-turn reads, and fixing that converges to versioned dirs anyway; per-turn session dirs → N identical copies + lease sweeps for no remaining reason.) |
| **D5** | How is the CAS + tag-collision retry re-expressed? | **`Mutate(ctx, ref, fn, opts)`** owns one retry loop: fetch under flock → run `fn` (check preconditions vs `Tx.Base()`, stage `Write/Delete`) → write-tree/commit-tree → `push --force-with-lease`. Non-FF → re-fetch + re-run `fn`, bounded by a plain in-`Mutate` retry policy (default 4 attempts, jittered backoff). `fn` may return a conflict sentinel to abort with no retry = the 409 path. **`conflict_retry.go` is retired, not ported** (§7). | Collapses three near-identical `RetryCAS` closures into one; origin push-CAS is the arbiter, identical to today's `UpdateRef(force=false)`; preserves the exact 409-vs-retry distinction because the domain still owns preconditions inside `fn`. The old org-keyed leaky bucket was REST-quota armor for the era when every retry cost a full N+3 re-walk + re-upload; under plumbing a retry is a mostly-no-op fetch + local re-apply + one push, so only the *semantics* (bounded attempts, 409 passthrough) survive — the bucket machinery does not. |
| **D6** | Path key — `repo_url` or `repo_slug`? | **`repo_slug`** (`git_repositories.repo_slug` = `lower(owner-repo)`, already persisted). Layout: `repos/<orgId>/<projectId>/<repoSlug>/`. Skills = `repos/<orgId>/_skills/org-skills/`. | Already normalized in Postgres (sidesteps the `.git`/bare-URL ambiguity `LookupOrgProjectByRepoURL` tolerates); the path becomes a pure function of the DB row → never drifts from the 4 coordinate stores (C8). (`repo_url` leaf → two forms map to one repo; ambiguous key.) |
| **D7** | Credentials for a long-lived mirror (G3)? | **Mint a fresh token in-process immediately before every remote op** via `credentials.Resolver.Resolve(orgID).Token(ctx)`, injected through a one-shot **`GIT_ASKPASS`** shim (token in the child's env, never in argv, never in `.git/config`). `cred.Identity()` supplies `-c user.name/-c user.email`. Mid-op 401 → re-mint once + retry. | A token minted right before each short op means the ~1h installation-token expiry can never bite a long-lived mirror — nothing is held to expire. Reuses the exact resolver terminus behind the runner's `orgcreds.CredentialsRefreshService`, without the runner's HTTP self-callback (aep-api **is** the token source). (Persist helper in `.git/config` → secret on shared RWX; `http.extraHeader -c` → token visible to `ps`.) |
| **D8** | Concurrency — one lock or two concerns? | **Split.** (a) *Correctness / inter-node push race* = `push --force-with-lease` + the retry loop (origin authoritative). (b) *Shared-bare-dir integrity* = a per-repo POSIX **`flock(2)`** on `repos/<org>/<proj>/<slug>/repo.lock`, held only around fetch/push/ref-move (sub-second); reads take a **shared** flock, `Mutate`/`Tag` take **exclusive**; `gc.auto=0`, GC only in the reaper. | Push-CAS already handles correctness; the only *new* hazard is concurrent fetch/gc corrupting one shared bare object DB, which a short advisory lock fixes without a global turn lock. No worktrees ⇒ no `index.lock` to arbitrate. Postgres advisory lock kept as the documented fallback if the RWX backend no-ops flock. |
| **D9** | Agents turn payload shape? | `TurnRequest` drops `Files map[string]string` + `Skills []Skill`, gains `Workspace WorkspaceRef{ConversationID, TurnID, RepoSlug, Ref, SkillsRef}` — IDs + shas, **never a filesystem path**. Agents derives `$WORKSPACE_MOUNT_ROOT/repos/<org>/<proj>/<repoSlug>/snapshots/<ref>/` itself (org/proj from the namespaced conversation id). The Go `Skill` type is deleted; TS reads the seed map from disk. | Directly satisfies "don't send codebase + skills to agents; rely on the mount" and makes skill progressive-disclosure truly lazy — **and** makes the tenancy fence *structural*: agents never accepts a path, so traversal is impossible by construction; the check reduces to ID-shape validation + org-segment==claim (§12). The FileBundle fold, StreamPart contract, TurnGuard, prompt-cache prefix are all unchanged. (Raw path strings → validate-the-untrusted-path thinking; rejected.) |
| **D10** | OpenChoreo build plane on the shared mount (G5)? | **No.** OC keeps its own `checkout-source` clone of `repo_url@commit_sha` from origin. | Builds read the pushed, authoritative merge SHA (durable on the executions row); spanning RWX across two independently-scaled trust domains adds coupling for zero correctness gain. Three intentional clones persist (aep-api mirror = shared; runner emptyDir + OC build = isolated). |
| **D11** | REST adapter — permanent fallback or shim? | **Migration shim only**, behind the `WORKSPACE_MODE` flag; deleted in Phase 5. | CLAUDE.md mandates proper-fix-no-hacks; the shipped structure is one seam, one disk-backed impl. Provider-neutrality (GitLab/Gitea) is served by the port shape, not by keeping a REST impl. |
| **D12** | Disk lifecycle / GC ownership (G7)? | One owned **`gitfs/reaper`**: three thin synchronous best-effort hooks (`DeleteRepo`→`TrashRepo`, org-disconnect Phase-F→`TrashOrg`, app-uninstall inherits) that only `os.Rename` a subtree into `trash/<ulid>`, plus a background `app.Watcher` sweep (purge trash by age, age-reap snapshots, reconcile orphans vs `git_repositories`, LRU-evict under a disk high-watermark). No leases, no heartbeats — snapshots are immutable and reaped by age + not-current-HEAD. | `git_repositories` is authoritative and the mount is a rebuildable cache → hooks best-effort, correctness in the self-healing sweep. Trash-then-purge makes deletes O(1) and never corrupts a mid-turn read (POSIX inode survives via open fds). Committed-truth (D13) keeps the cache rebuildable: no authoritative uncommitted data ever lives on disk. |
| **D13** | Where does generated/edited content live — draft or committed? | **Committed-truth.** Every mutation commits straight to `main`: stream-end auto-commit (D14), each manual save = `files.Apply` (one commit per save; Apply is already a batch). **Approve = tag-only**, pinned `{commitSha}` — the save gate runs at the pinned sha. **Discard = revert**: `revertSubtreeToTag` to the latest `vN`, or subtree-delete when no tag exists yet. The draft state is abolished everywhere; the FE localStorage draft (`specDraftSession.ts`) is **deleted** and the FE fold becomes display-only. A turn that ends in `ask_question` (HITL) still commits its changes — a pending question is *conversation* state, not draft state; `main` = latest is accepted. | Git is the source of truth and it is *always committed* — the sharp version of "backend is the source of truth". The dangerous alternative (authoritative uncommitted files on the volume) turns the mount into durable user data: crash/evict/sweep = data loss, and D12's rebuildable-cache premise dies. A server-side draft would also cost one of the two clean invariants (agents-RO or single-writer) plus a draft-sync protocol. Commit noise on `main` is accepted; tags mark milestones. |
| **D14** | How does the stream become a commit? | **aep-api folds the stream (Go tap), gated by an integrity manifest.** File StreamParts fold **in memory** in the turn runner: lazily seeded from the mirror at the turn's base `ref` (`editFile` needs base content), only touched paths held; disk is written only inside `Mutate`. Agents appends one terminal part — `{files: {path → sha256}, deleted: []}` from its own authoritative `FileBundle`. Match → `Mutate`+push; mismatch → turn **fails loudly**, `main` untouched; manifest absent (stream died) → no commit; **empty manifest is valid** (chat turn, no file ops) → commits nothing. CI locks fold parity with cassette goldens: `@aep/sse-cassette` streams replayed through the TS fold and the Go fold, byte-equal. | The fold contract is four canonical ops (`addFile`, `editFile` exact-string, `removeFile`, `setFrontmatterField` YAML) with **no folded content on the wire** (§5 of the agent-loop design) — a Go re-implementation can silently drift from the TS `FileBundle`, and under auto-commit silent drift = corrupt commits on `main`. The manifest turns drift into a hard error and gives all-or-nothing on stream death for free. (Re-adding `newContent` to results → O(file × edits) SSE inflation, reverses a deliberate contract decision; trusting goldens alone → uncovered edge case commits silently.) |
| **D15** | Stream ends but `main` moved past the turn's base (mid-turn Apply / prior turn)? | **Disjoint→rebase, overlap→fail.** On push-reject, intersect `changed(base..HEAD)` with the fold's touched paths. Disjoint → replay the fold on the new base and push (the `Mutate` CAS loop — content overlays re-apply deterministically). Overlap → fail the turn with the conflicting paths in the terminal event. | An unrelated edit mid-generation must not kill a 3-minute generation; but the agent generated against content that no longer exists, and silently overwriting a concurrent human edit to the *same* file is data loss discovered only in git history. (Strict any-move-fails → reads as flaky; always-overlay → silent clobber.) |
| **D16** | How does the FE consume the generation stream? | **Resumable turn stream.** `POST /conversations/{id}/turns {instruction}` → `202 {turnId}`; the turn runs to completion server-side regardless of client connections. `GET /turns/{turnId}/stream?from=N` (SSE, `Last-Event-ID`) replays buffered parts then live-tails to a terminal event `{committed: sha}` / `{failed: reason, paths?}`. `GET /turns/{turnId}` = status. | The tap (D14) already sees every part — buffering them per active turn is nearly free, and it fixes refresh-mid-generation (the backend now finishes and commits regardless; a dead page while state changes underneath is worse than today), enables second-tab/teammate viewing, and makes "is a generation running?" a status GET. (SSE-on-POST → live view dies with the tab; full project pub/sub → an eventing backbone, out of scope.) |
| **D17** | Turn durability across crashes/replicas? | **Turn rows are durable; the part buffer is not.** Each turn persists a Postgres row (`agent_turns`: id, conversation, use_case, base_ref, status, commit_sha/error, updated_at) heartbeated by the running replica; a stale heartbeat ⇒ sweep marks it `failed` and releases the guard (the `execution.Sweep` pattern). Parts live in an in-memory ring per **active** turn (bounded — turns are minutes) ⇒ stream attachment has **replica affinity** for now; upgrade path = persist parts. | A crash must not 404 turn status or zombie-lock the project (D18's guard rests on this row). Persisting every part is not needed while aep-api is effectively single-writer pending the flock validation (§17.1). |
| **D18** | Concurrent generations on one project? | **One active turn per project — any use-case, chat included.** `POST turn` while a turn is active → `409 {activeTurnId}`; the FE attaches to the running stream as a viewer (D16 makes the second tab a feature, not an error). Backed by the D17 turn row (crash-safe). | Two requirements generations racing = the loser burns minutes + tokens then fails at commit for a collision knowable at POST time. Strict one-slot is the chosen mental model — chat 409-ing during a running generation is accepted (revisit: §17.10). |
| **D19** | What does design generation read, and does the approval gate survive? | **HEAD, gated on approval existing.** Snapshot = `main` HEAD (one real sha — no synthetic trees); precondition = ≥ 1 requirements tag exists (else 409 "approve requirements first"). If HEAD's requirements differ from the latest `vN`, the FE warns but generation proceeds ("generate against what I see"). Lineage stamps `{specTag: vN, baseSha}`. | Fits the per-SHA snapshot model exactly and matches user expectation. (Pinning requirements at `vN` → a synthetic tree keyed `(sha, vN)`, and the agent reads content the user isn't seeing on screen; no gate → the spec-driven requirements→design discipline dies and `vN` lineage becomes decorative.) |
| **D20** | Cross-cutting turn defaults | **Commit identity:** author = the prompting/editing user (claims → `ResolveSaveIdentities`, captured at POST time since the turn runs detached); committer = the AEP bot; conventional messages (`generate(<useCase>): …`, `edit(specs): …`, `revert(specs): → vN`). **`filesChangedExternally`** is server-derived (previous turn ref ≠ current HEAD) — the FE stops sending it. **Failed-turn divergence note:** ConversationStore records assistant messages as the turn streams, so a failed/uncommitted turn leaves history claiming work git never received — the next dispatch carries "your previous turn's changes were NOT applied". **FE edit guard:** while a turn is active, the FE disables/warns Save for the subtree being generated; the server does *not* block Apply (unrelated fixes stay possible; D15 backstops overlaps). | Each closes a gap the committed-truth model opens: detached turns need identity captured up front; the server now knows base movement better than the FE; history-vs-git divergence would confuse the next turn's model; and a user editing the file being generated should learn before minute 3, not after. |

---

## 4. Mount layout

RWX volume mounted identically at `$AEP_WORKSPACE_ROOT` (default `/workspaces`) in
**both** services and every replica.

```
/workspaces/
  repos/<orgId>/<projectId>/<repoSlug>/        # one renamable parent per repo (atomic evict)
    git/                                        # BARE mirror (git clone --mirror); object store; NEVER checked out
    repo.lock                                   # flock(2): SHARED for reads, EXCLUSIVE for fetch/push/ref-move
    snapshots/<sha>/                            # IMMUTABLE plain-file tree @ sha (git archive); what agents read; age-reaped
  repos/<orgId>/_skills/org-skills/             # per-org skills mirror; _skills = SkillsRepoSentinelProjectID
    git/  repo.lock  snapshots/<sha>/
  trash/<ulid>/                                 # renamed subtrees awaiting async purge
  tmp/                                          # atomic clone/snapshot staging (build here → rename into place)
```

- **`<repoSlug>`** = `git_repositories.repo_slug` = `lower(replace(owner/repo,'/','-'))`,
  already persisted by the `phase2_prc` migration. Both URL forms (`.git` and
  bare) map to **one** key. The clone/push URL is still `repo_url`; the *path*
  key is the slug (D6).
- **Multi-repo / multi-component is native**: N `<repoSlug>` leaves under one
  `<projectId>/`; `appPath` selects the subtree within one repo. Tenancy key
  everywhere is `(org_id, project_id) → repo_url/repo_slug` via `git_repositories`
  (composite-unique), read via `LookupOrgProjectByRepoURL`/`GetRepo` — **the
  deriver never trusts a client-supplied path**.
- **The skills repo is not special-cased**: its row (`project_id =
  SkillsRepoSentinelProjectID`, name `org-skills`) flows through the same deriver.
- **Snapshots are the only thing agents read** and are write-once: staged in
  `tmp/`, renamed into place, never modified. One materialization per commit —
  shared by every conversation, turn, and replica that reads at that sha. The
  wire handle agents receive is `{conversationId, turnId, repoSlug, ref,
  skillsRef}` (D9) — filesystem paths never cross the service boundary.
  `conversationId` reuses `genai.namespacedID`
  (`org_<orgId>--proj_<projectId>--<useCase>--<uuid>`), which supplies the
  org/proj path segments and the org claim for the fence (§12).

---

## 5. The `Workspace` port

Two ports in `internal/feature/gitrepo/workspace.go`; sentinels alias the
existing `errors.go` values (`ErrRefNotFastForward`, `ErrTagAlreadyExists`, the
`files.Apply` conflict sentinel).

```go
// Workspace is the single collapse point for the 4 read walkers + 3 write paths + tag + compare.
type Workspace interface {
    // READS — plumbing against the bare mirror, no checkout.
    // Collapses GetRef→GetCommit→GetTree(recursive)→N×GetBlob.
    Head(ctx context.Context, ref RepoRef, at string) (sha string, err error)          // ""→default tip; "tags/vN"; sha; peels annotated tags
    List(ctx context.Context, ref RepoRef, at string) (entries []Entry, headSHA string, err error)
    ReadFile(ctx context.Context, ref RepoRef, at, path string) (content []byte, blobSHA string, err error)
    ReadBundle(ctx context.Context, ref RepoRef, at string, keep func(rel string) bool) (files map[string]string, headSHA string, err error)

    // WRITE — collapses CreateBlob/CreateTree(base overlay, sha:null delete)/CreateCommit/UpdateRef(FF-CAS).
    Mutate(ctx context.Context, ref RepoRef, fn func(Tx) error, opts CommitOpts) (CommitResult, error)

    // TAG + DIFF
    Tag(ctx context.Context, ref RepoRef, spec TagSpec) error                          // annotated tag + push; ErrTagAlreadyExists on collision
    ListTags(ctx context.Context, ref RepoRef, prefix string) ([]TagInfo, error)
    Diff(ctx context.Context, ref RepoRef, base, head string) (*CompareResult, error)  // local `git diff base...head`; replaces CompareRefs
}

type Tx interface {
    Base() Snapshot                 // committed HEAD view; feeds per-file baseSha preconditions (git ls-files -s blob shas)
    Write(rel string, content []byte)
    Delete(rel string)
}
type Snapshot interface {
    CommitSHA() string
    Read(rel string) ([]byte, string, error)
    Walk(prefix string, fn func(rel, blobSHA string) error) error
}

type RepoRef     struct { OrgID, ProjectID, RepoSlug, CloneURL, DefaultBranch string; Cred credentials.Credential }
type Entry       struct { Path, SHA string; Size int64 }
type CommitOpts  struct { Message string; Author, Committer *GitIdentity; Retry RetryPolicy } // bounded attempts + jittered backoff (replaces conflict_retry.go)
type CommitResult struct { CommitSHA string; Changed bool }
type TagSpec     struct { Name, Target, Message string; Tagger *GitIdentity }

// SnapshotProvider is a SEPARATE optional port; only the mount impl satisfies it; used by genai turn dispatch.
type SnapshotProvider interface {
    Ensure(ctx context.Context, ref RepoRef, sha string) error // materialize snapshots/<sha>/ iff absent; idempotent (tmp/ + rename)
}
```

`Mutate` **owns the CAS retry loop** (D5): fetch-under-flock → `fn`
(preconditions + `Tx.Write/Delete` into a throwaway `GIT_INDEX_FILE`) →
`write-tree`/`commit-tree` → `push --force-with-lease` → on non-FF re-fetch and
re-run `fn`, bounded by `opts.Retry`. `fn` returning a conflict sentinel
short-circuits with no retry = the 409 path. This subsumes the old `RetryCAS`
closures; `conflict_retry.go` is **not** ported — its org-keyed leaky bucket was
REST-quota armor (each retry once cost a full re-walk + re-upload against the
GitHub API), while a local retry is a mostly-no-op fetch + re-apply, so
`RetryPolicy` re-derives to plain bounded attempts + jittered backoff.

The four consumer gateways (`files.GitGateway`, `artifacts.GitGateway`, the
skills/genai git handles) swap `GitData() gitrepo.GitData` for `Workspace()
gitrepo.Workspace`, keeping `Resolver()`/`ResolveSaveIdentities()`.
`*gitrepo.gitOpsService` satisfies both during migration.

---

## 6. The committed-truth write model & turn lifecycle

**Division of labour:** aep-api owns *all* git (clone/fetch/mutate/push/tag/GC/
credentials), folds the generation stream, and is the commit authority;
agents-service does *only* read-only filesystem access inside immutable
snapshot dirs (stays git-blind and tenancy-blind); the console holds **no
state** — every durable mutation is an API call, its fold is display-only.

| State | Where it lives | Produced by |
|---|---|---|
| **committed** | `main` (origin authoritative; mirror follows) | stream-end auto-commit (D14) · `files.Apply` per manual save (D13) · revert (`revertSubtreeToTag`) |
| **approved** | annotated tag `vN` / `vN-M` pointing at a pinned sha | tag-only approve call, `{commitSha}` pin, save gate at the pinned sha (D13, §10) |

**Turn lifecycle** (D13–D18, D20):

```
POST /conversations/{id}/turns {instruction}
  ├─ guard: active agent_turns row for project? → 409 {activeTurnId}      D18
  ├─ insert turn row (status=running, base_ref=HEAD, claims captured)    D17/D20
  ├─ SnapshotProvider.Ensure(ref, HEAD) + Ensure(_skills, skillsHead)     D4
  └─ 202 {turnId}; runner detaches:
       agents POST {conversationId, turnId, repoSlug, ref, skillsRef}     D9
         │  SSE parts ──► ring buffer (serves GET …/stream)               D16
         │             └► Go fold, in-memory, lazy base seed              D14
         ▼
       terminal manifest?
         absent        → row: failed(stream-died); no commit              D14
         hash mismatch → row: failed(fold-parity); no commit; alert       D14
         empty         → row: completed(no-changes); no commit            D14
         match         → Mutate: overlap? → failed(base-moved, paths)     D15
                                 else commit → push → completed(sha)
       terminal event → stream; buffer dropped after grace; guard released
```

Crash of the running replica: agents' stream drops (aep-api is the SSE client)
→ no manifest → no commit; the heartbeat goes stale → sweep marks the row
`failed`, the guard releases (D17); the next turn carries the D20 divergence
note.

**Save gate unchanged in substance.** The requirements/design **hard gate**
(`save_gate.go` — requirements.md must exist; the design layout root + every
`design.json` must be schema-valid before a `v*` tag is cut) is a pure semantic
check over a bundle. It now runs against `ReadBundle` **at the pinned
`{commitSha}`** when the tag-only approve call arrives — same order, same
failure semantics.

**Discard** is one operation now (there is no unaccepted draft to drop):
`revertSubtreeToTag` — a real `Mutate` restoring the subtree to the latest `vN`
(or deleting the generated subtree when no tag exists yet) + push (D13).

**API delta (console ↔ aep-api):**

| Endpoint | Before | After |
|---|---|---|
| create turn | POST with the **whole FE draft** in the body (413 guard) | `POST …/turns {instruction}` → `202 {turnId}` — no file content, ever |
| turn stream | SSE on the POST response itself | **NEW** `GET /turns/{id}/stream?from=N` (replay + tail, `Last-Event-ID`); **NEW** `GET /turns/{id}` status |
| save requirements/design | FE posts folded draft → commit + tag | **tag-only** with `{commitSha}` pin; save gate at the pinned sha; body carries no files |
| discard | FE drops its localStorage draft (zero API) | `POST …/discard` → revert `Mutate` (D13) |
| manual edits | `files.Apply` (draft-accept path) | `files.Apply` unchanged in shape — now **the** edit path; one commit per save; keeps per-file `baseSha` → 409 |
| files read | GET + FE overlays its local draft | GET @ HEAD / @ tag is the *complete* truth — no overlay |
| dirty indicator | FE bookkeeping (draft vs base) | server: `Workspace.Diff(main, latest vN)` |
| 413 guards | both legs | **deleted** — no leg carries file content |

**Console changes:** `specDraftSession.ts` (localStorage draft, base-sha
bookkeeping, 409-rebase machinery) is **deleted**; the StreamPart fold stays
display-only (live preview / cell diagram — cosmetic divergence is harmless
because commits come from the manifest-verified backend fold); viewer-mode
attach on 409 (D18); unapproved-requirements warning banner (D19); edit guard
during active turns (D20); unsaved editor buffers are transient UI state
flushed via Apply.

---

## 7. Concurrency & locking

Three cleanly separated concerns:

**1. Correctness — inter-node push race** (aep-api replicas + runner + OC all
pushing origin). **Mechanism unchanged from today.**
`git push --force-with-lease=refs/heads/main:<observedRemoteSHA> origin
<newSHA>:refs/heads/main` is the exact analog of `UpdateRef(force=false)`.
Non-FF rejection → `ErrRefNotFastForward` → `Mutate` re-fetches origin and
re-invokes `fn` against the new base (content overlays re-apply
deterministically), bounded by `Mutate`'s own retry policy — default 4 attempts
+ jittered backoff. For generation commits, D15 adds the overlap check on top:
disjoint → replay, overlap → fail the turn. The `conflict_retry.go` org-keyed
leaky bucket is **retired, not ported** (D5).

**2. Shared-bare-dir integrity — the only new filesystem hazard.** Concurrent
`fetch`/`update-ref`/`gc` on one shared bare mirror can corrupt packs (push-CAS
does not guard this). Fix: a per-repo POSIX `flock(2)` on
`repos/<org>/<proj>/<slug>/repo.lock`, held **only** around the
fetch→write-tree→commit-tree→push→ref-move critical section (~1s), never across
a turn. Reads take a **shared** flock; `Mutate`/`Tag` take **exclusive**. Set
`gc.auto=0` on the mirror; GC runs only in the reaper leader pass. This
subsumes the skills store's existing per-org `provLocks`.

**3. Turn-level serialization.** Agents' `TurnGuard` serializes
per-`conversationId` (unchanged); aep-api's **one-active-turn-per-project**
guard (D18) serializes generation across conversations, backed by the durable
turn row. Snapshot dirs are immutable, so agent reads need **no** lock — there
is no worktree, no shared index, no `index.lock` to race (G1 dissolved).

**Cross-replica coordination:** the per-repo flock is the primitive; it
**requires the RWX backend to honour POSIX flock across nodes** (CephFS / NFSv4 /
EFS do). Reaper global passes additionally run under a single non-blocking
**leader flock** on `.reaper.lock`. **Fallback** if flock no-ops on the chosen
StorageClass: a Postgres advisory lock keyed `org:project:repoSlug` behind the
same `lock.go` interface, and pin aep-api to 1 writer replica until validated
(§17.1).

---

## 8. Credentials

Reuse the `credentials.Resolver` seam that `orgcreds.CredentialsRefreshService`
wraps, **in-process** — aep-api *is* the token source, so unlike the runner it
needs no HTTP hop.

- **Per-remote-op minting** (G3): the mirror holds **no credential at rest**
  (nothing in `.git/config`). Before every remote op (clone/fetch/push/tag-push):
  `cred := resolver.Resolve(ctx, ref.OrgID); token, _, _ := cred.Token(ctx)`
  (mints an App installation token or returns the PAT). Because the token is
  minted immediately before each short op, the ~1h installation-token expiry can
  never bite a long-lived mirror. Mid-op 401 → re-mint once + retry, folded into
  the push-reject loop.
- **Injection** via a one-shot `GIT_ASKPASS` shim (`gitfs/askpass.go`): git
  invokes the shim, which prints `x-access-token` then the token from the child's
  env — never in argv (invisible to `ps`), never in `.git/config` (no secret
  persists on shared RWX). Deliberately converges with the runner's
  `credhelper.sh` *semantics* while differing in transport.
- **Commit identity** (D20): author = the prompting/editing user via
  `ResolveSaveIdentities` (claims captured at POST time — the turn runs
  detached); committer = the AEP bot identity; passed per-op as
  `-c user.name=… -c user.email=…`, re-read every op so a mid-session
  login-rename never stamps a stale author.

---

## 9. What stays GitHub REST (the hard boundary)

The `internal/clients/github` client is **not** replaced — it shrinks to the
remote-only ports (C7). No local-clone equivalent exists for:

- **`IssueOps`** (full): Create/List/Close/Comment/EditBody/EditTitle/Add/Remove/
  SetLabels/GetPullRequest — Tasks-as-issues, the `aep:execute` label funnel,
  `aep:status/*` projection, PR-state reconciliation.
- **`WebhookOps`**: Register/UpdateWebhookEvents.
- **`AppInstallOps`** (full): GetUser/GetAppInstallation/ListAppInstallations/
  ExchangeOAuthCode/GetUserInstallations/DeleteInstallation.
- **`RepoAdmin.CreateOrgRepo`**: remote repo provisioning (the bare mirror is
  cloned only *after* the remote repo exists).

**Moves to the mount** (git-object surface only):

| Retired GitHub Git-Data call | Local plumbing |
|---|---|
| `GetRef` / `GetCommit` / `GetTree` / `GetBlob` | `rev-parse` / `ls-tree` / `cat-file` / `archive` |
| `CreateBlob` / `CreateTree` / `CreateCommit` / `UpdateRef` | temp-index `write-tree` + `commit-tree` + `push --force-with-lease` |
| `CreateTagObject` / `CreateTagRef` / `ListMatchingRefs` / `GetTagObject` | `git tag -a` / `ls-remote` / `rev-parse tag^{commit}` |
| `CompareRefs` (the one `/compare` diff primitive) | `Workspace.Diff` = `git diff base...head` (local — the mirror fetches all branches **and** tags) |

---

## 10. Tag lineage

Spec/design lineage stays annotated `v*` tags (`vN` requirements, `vN-M` design),
authoritative on origin. Approve is **tag-only** (D13): the call carries the
`{commitSha}` pin, the save gate validates the bundle at that sha, and the tag
lands on exactly what the user reviewed (which may no longer be HEAD — fine,
tags need not point at tips). Unknown/garbage sha → 409.

- **Create:** `Workspace.Tag` = `git tag -a vN -m <msg> <sha>` then
  `git push origin refs/tags/vN`. Push rejection on a taken name →
  `ErrTagAlreadyExists` → `git fetch --tags` under the flock → recompute the next
  `vN`/`vN-M` via the **unchanged** `nextDesignTag`/`nextRequirementsTag` →
  re-push (the `retryOnTagCollision` loop, preserved as a push-rejection handler;
  replaces the `CreateTagRef` 422 recompute). A `fetch --tags` precheck narrows —
  but cannot close — the cross-replica window (G8, accepted).
- **Peel / compare:** because the mirror is `git clone --mirror`, every fetch
  includes `refs/tags/*`, so lineage tags (specTag/designTag embedded in
  issue-body machine blocks + executions rows) peel and diff **locally**:
  `git rev-parse vN^{commit}` (was `PeelTagToCommit`+`GetTagObject`) and
  `git diff vN...vM` (was `CompareRefs`). Enforce `git fetch --tags` before any
  peel/compare so a mirror that missed a concurrent tag push never mis-resolves
  lineage.
- **Consistency:** the tag SHA written back to `executions.design_tag` / the Task
  issue-body block is `git rev-parse` of the just-pushed tag — identical to the
  ex-remote SHA (C8). Design-generation lineage additionally stamps
  `{specTag: vN, baseSha}` (D19).

---

## 11. Divergence & recovery

Divergence is **structurally eliminated, not managed** — the payoff of
plumbing + no-unpushed-commit + no-worktree + committed-truth:

- The bare mirror is never checked out — it only moves refs on `fetch`, so it has
  no working tree to diverge and no local branch that drifts from origin.
- `Mutate` pushes the loose commit under `--force-with-lease` **before** advancing
  any local ref, so `committed-local ≡ committed-remote` at rest. There is never a
  persistent unpushed local commit to reconcile (G4).
- There is no draft state anywhere, so there is nothing whose loss is data loss:
  the mount is a rebuildable cache in every part (D12/D13).

| Failure mode | Recovery |
|---|---|
| **Non-FF push** (replica/runner/OC advanced origin) | `Mutate` re-fetches, re-derives base, re-checks preconditions (→ 409 / D15 overlap-fail if the specific content moved), replays the overlay, retries — bounded by `Mutate`'s retry policy (default 4 attempts, jittered). Ordinary path, not an error. |
| **Turn stream dies / manifest mismatch** | no commit, `main` untouched; turn row → `failed`; next dispatch carries the D20 "changes were NOT applied" note; user regenerates. |
| **Crash between `commit-tree` and push** | the loose commit is unreferenced and GC'd; the turn row goes stale → `failed` (D17); re-running the turn or Apply recreates the commit. *(Verify for the artifacts/tag path too — §17.2.)* |
| **aep-api replica crash mid-turn** | agents' SSE drops (aep-api is the client) → no manifest → no commit; heartbeat stale → sweep fails the row, releases the D18 guard. |
| **Mirror corruption / stuck lock / partial clone** | the reaper (or the next `ensureFresh`) `rm -rf`s and re-`clone --mirror` **atomically** (clone into `tmp/`, rename into place). Always safe — the mirror holds no unpushed state. |
| **Stale snapshot dirs** | immutable and derivable → age-reaped (`> SNAPSHOT_MAX_AGE` and not current HEAD); in-flight turns are minutes, the age floor makes races practically impossible. |
| **Mid-op 401** (token revoked) | re-mint via the resolver once + retry (D7). |

There is deliberately **no merge/rebase-conflict surface**: the mount never keeps
local commits to merge; all reconciliation is re-fetch + re-apply-overlay +
push-CAS — exactly the semantics the pure-Git-Data CAS model already had.

---

## 12. Agents-service contract

Both `agentsvc.TurnRequest` (Go) and the `@aep/agent-stream` `TurnRequest` (TS)
drop `Files map[string]string` + `Skills []Skill`; the Go `Skill` type is
deleted:

```go
type TurnRequest struct {
    Instruction            string       `json:"instruction"`
    Workspace              WorkspaceRef `json:"workspace"`
    FilesChangedExternally bool         `json:"filesChangedExternally,omitempty"` // server-derived (D20)
    Toolset                string       `json:"toolset,omitempty"`
}
type WorkspaceRef struct {
    ConversationID string `json:"conversationId"` // namespacedConvId (org_<o>--proj_<p>--<useCase>--<uuid>) — supplies org/proj segments + the org claim
    TurnID         string `json:"turnId"`         // per-dispatch uuid
    RepoSlug       string `json:"repoSlug"`       // path segment (validated slug format)
    Ref            string `json:"ref"`            // committed base sha → snapshots/<ref>/
    SkillsRef      string `json:"skillsRef"`      // _skills head sha → _skills/…/snapshots/<skillsRef>/
}
```

IDs + shas only — **no filesystem path crosses the boundary**. Agents derives
`$WORKSPACE_MOUNT_ROOT/repos/<org>/<proj>/<repoSlug>/snapshots/<ref>/` (and the
`_skills` analog) itself, so a hostile payload has no path input to traverse:
the fence is structural, not validated-in.

Changes in `services/agents` (read-only + git-blind preserved):

- **NEW `src/conversation/load-workspace.ts`**: `readSnapshot(snapshotDir):
  Record<string,string>` (fs walk of the dir derived by `snapshot-path.ts`)
  feeding `new FileBundle(map)` / `new TaskPlan(map)` and
  `buildPrompt(map, instruction)` **byte-unchanged** (the `FileBundle` ctor
  already takes `Record<string,string>`). The skill catalog loads from
  `<skillsSnapshotDir>/*/SKILL.md`; `loadSkill`/`loadSkillReference` read
  bodies/references from disk on demand — progressive disclosure becomes truly
  lazy, and immutability makes mid-turn reads race-free (D4).
- **NEW terminal manifest part** (D14): at turn end, emit
  `{files: {path → sha256}, deleted: []}` from the turn's `FileBundle` — always,
  possibly empty. Added to the StreamPart contract and to the sse-cassette
  fixtures.
- **`run-conversation-turn.ts`**: swap `input.files`/`input.skills` for the
  `load-workspace` read; `runTurn`, the FileBundle fold, `buildFileTools`, the
  StreamPart contract, TurnGuard, ConversationStore, prompt-cache prefix all
  **unchanged**. Dispatch may carry the D20 failed-turn / externally-changed
  notes.
- **`src/server.ts`**: stop walking `body.files`/`body.skills`; drop the 413
  guard; add the fence via **NEW `src/shared/snapshot-path.ts`** — strict
  ID-shape validation on `conversationId`/`turnId`/`repoSlug`/shas (expected
  charset/format, no path separators or dots), assert the `org_<orgId>` segment
  == the `X-Org-Id` claim (cross-tenant IDOR fence), *derive* the snapshot paths
  under `WORKSPACE_MOUNT_ROOT`, stat-check → pre-stream 400. There is no
  canonicalize-untrusted-path logic because no path is ever accepted.
- **Do not** add `FileBundle.fromDir` to `packages/agent-stream` (it is
  client-safe, imported by the console, and must stay fs-free); the disk loader
  lives only in `services/agents/src`.
- **NEW env** `WORKSPACE_MOUNT_ROOT=/workspaces` on the agents container.

agents remains 100% git-free and writes nothing to the mount; it stays replayable
in evals by pointing `WORKSPACE_MOUNT_ROOT` at a fixture tree containing fake
`snapshots/<sha>/` dirs.

---

## 13. Deployment & RWX

- **`deployments/docker-compose.yml`**: add a named volume `aep-workspaces` under
  top-level `volumes:`, mount it into `aep-api` **and** `agents` at `/workspaces`;
  set `AEP_WORKSPACE_ROOT=/workspaces` (aep-api) + `WORKSPACE_MOUNT_ROOT=/workspaces`
  (agents). A single Docker host makes a local named volume de-facto RWX. **Add
  the `git` binary to the aep-api image Dockerfile** (agents needs no git).
- **k8s chart**: add a `ReadWriteMany` PVC `aep-workspaces` bound to a **real RWX
  StorageClass** (NFS/EFS/CephFS in prod; single-node k3d fakes RWX with a
  hostPath-backed volume). The chart today has only the postgres RWO PVC (G6) —
  this is new. Mount into both Deployments at `/workspaces`.
- **Replica story**: agents reads are lock-free (immutable snapshots) so it can
  scale to N readers. aep-api is the sole writer; multiple writer replicas are
  safe *iff* the RWX backend honours POSIX flock across nodes — otherwise run
  **one** aep-api writer replica + the Postgres-advisory-lock fallback. The
  turn part-buffer is in-memory ⇒ **stream attachment has replica affinity**
  (D17) — acceptable while aep-api is effectively single-writer; revisit with
  parts-in-Postgres when scaling out (§17.9).
- **DB**: new `agent_turns` table (D17) + its sweep; migration alongside the
  existing executions machinery.
- **OC build plane (G5)**: the RWX mount does **not** span the OpenChoreo build
  namespace (D10).

---

## 14. Disk lifecycle (the reaper)

One owned component `internal/platform/gitfs/reaper` — the single disk authority.
`git_repositories`(+`agent_turns`/`executions`) is authoritative; the mount is a
rebuildable cache in **every** part (committed-truth guarantees no authoritative
uncommitted data on disk), so hooks are best-effort and correctness lives in the
sweep.

- **Two-phase delete (trash-then-purge):** nothing is ever `rm -rf`'d in place.
  Phase 1 (sync, O(1)): `os.Rename` the `<repoSlug>` (or whole `<orgId>`) subtree
  into `trash/<ulid>` — frees the canonical path instantly (re-clone can't
  collide) and, by POSIX inode semantics, a mid-turn reader keeps working through
  open fds. Phase 2 (async): `os.RemoveAll` the trash entry after
  `TRASH_MAX_AGE`.
- **Three synchronous hooks** (only "rename to trash"): project delete
  (`DeleteRepo` *after* the DB delete), org disconnect (new Phase-F in
  `OrgDisconnectService.Disconnect`, trashes `repos/<orgId>/` incl. `_skills`),
  app uninstall (no new seam — `handleDeleted` already funnels through
  `OrgDisconnectService`).
- **Background sweep** (`app.Watcher`, 5m ticker, beside `execution.Sweep` and
  the `agent_turns` heartbeat sweep), four passes: (1) trash reclamation (local,
  idempotent, every replica); (2) **snapshot age-reap** — delete
  `snapshots/<sha>` older than `SNAPSHOT_MAX_AGE` and not the repo's current
  HEAD (immutability makes this safe; no leases, no heartbeats); (3) orphan
  reconciliation under leader flock (on-disk `repos/…` set-difference against
  `repository.ListAll` with a ~2×-interval mtime grace); (4) quota/LRU under
  leader flock (`statfs`; over 85% or per-org quota → evict snapshots first,
  then trash LRU mirrors by `git/` mtime until under 70%; evicting a live
  mirror also takes its `repo.lock` exclusive; eviction cost is a re-clone on
  next use, always safe).
- **Config** (`services/.env.example`): `AEP_WORKSPACE_ROOT`,
  `AEP_WORKSPACE_REAP_INTERVAL=5m`, `AEP_WORKSPACE_SNAPSHOT_MAX_AGE=24h`,
  `AEP_WORKSPACE_ORG_QUOTA_BYTES≈5GiB`, `AEP_WORKSPACE_DISK_HIGH_PCT=85`,
  `AEP_WORKSPACE_DISK_LOW_PCT=70`, `AEP_WORKSPACE_TRASH_MAX_AGE=24h`.

---

## 15. Code structure

**NEW (Go)**
- `internal/feature/gitrepo/workspace.go` — the `Workspace` + `SnapshotProvider`
  ports + DTOs; sentinels alias `errors.go`.
- `internal/platform/gitfs/` — `engine.go` (git-CLI plumbing: mirror clone/fetch,
  `ls-tree`/`cat-file`/`archive` reads, temp-index `write-tree`/`commit-tree`,
  `push --force-with-lease`, tag, diff; `GIT_TERMINAL_PROMPT=0`, `gc.auto=0`),
  `paths.go` (deriver), `lock.go` (per-slug flock + Postgres-advisory fallback
  behind one iface), `askpass.go` (per-op minting), `snapshot.go` (Snapshot/Tx),
  `snapshots.go` (`SnapshotProvider`: tmp/ + rename, idempotent), `mutate.go`
  (fetch→fn→stage→commit-tree→push-lease retry + D15 overlap check),
  `gc.go`+`reaper/`, `gitfs_test.go`+`workspacetest/` (real bare origin —
  supersedes gittest's Git-Data fake, C2).
- `internal/platform/agentfold/` — the Go fold (D14): `fold.go` (four canonical
  ops, lazy base seed via `Workspace.ReadFile`), `frontmatter.go`,
  `manifest.go` (sha256 verify), cassette-replay golden tests against the TS
  fold.
- `internal/feature/genai/` — `turn_runner.go` (detached execution: guard →
  snapshot ensure → dispatch → tap/fold → manifest → `Mutate`), `turn_stream.go`
  (ring buffer + resumable SSE), `turn_repository.go` (`agent_turns` rows +
  heartbeat + sweep).
- migration: `agent_turns` table.

**NEW (TS)**
- `services/agents/src/conversation/load-workspace.ts` — snapshot fs walk →
  seed map.
- `services/agents/src/shared/snapshot-path.ts` — ID-shape validation + path
  derivation (the structural fence, D9/§12).
- Terminal manifest emission at turn end (`run-conversation-turn.ts`, from the
  turn's `FileBundle`) + the manifest part type in `packages/agent-stream`.

**CHANGED (Go — adopt the port, delete bespoke git code)**
- `feature/files/{files_service.go,internals.go}`: `blobsAtHead`+`treeCache`
  **deleted** → `Workspace.List/ReadFile`; `Apply` → `Mutate(fn{checkPreconditions,
  Write/Delete})`; `RetryCAS` folds into `Mutate`.
- `feature/artifacts/git_reader.go`: `readBundleAt{Head,Tag,Commit}` →
  `ReadBundle(at)`; `save_via_api.go`: save becomes **tag-only** (`{commitSha}`
  pin, gate at pinned sha) → `Tag`/`ListTags`; discard → revert `Mutate`;
  `conflict_retry.go` **deleted** (Phase 5) — `Mutate`'s built-in bounded +
  jittered retry replaces the org-keyed leaky bucket (D5, §7).
- `feature/skills/repo_store.go`: `loadCatalog` walk → `ReadBundle` of the
  `_skills` mirror; `commitFiles` → `Mutate`; `catalogCache` **dropped** — it
  amortized the REST walk, but a local HEAD `rev-parse` staleness check is ~1ms
  (keep at most a parse memo keyed by HEAD SHA if profiling demands); `provLocks`
  superseded by the gitfs flock.
- `feature/genai/genai_reads.go`: `mergeApprovedRequirements` **deleted** —
  design generation reads HEAD (D19); `genai_service.go`: `Turn` → the turn
  runner (202 + broker) instead of SSE-on-POST; 413 guard deleted.
- `internal/clients/agentsvc/client.go`: `TurnRequest` reshaped (D9); `Skill`
  deleted.
- `internal/feature/gitrepo/{git_ops_service.go,wire.go}`: add `Workspace()`
  accessor → `*gitfs.Engine`; gateways drop `GitData()`.
- `internal/clients/github/{client.go,artifacts.go}` + `gitrepo/ports.go`: retire
  the 13 GitData object methods (`ports.go:50-107`); keep issues/webhooks/
  repo-admin/app-install.
- `repositories/repo_repository.go`: add `ListAll(ctx)` for orphan reconciliation.
- `internal/app/app.go`: wire the reaper into `repoService` + `OrgDisconnectService`
  and append it + the turn sweep to the Watchers slice.
- `deployments/docker-compose.yml` + Dockerfile (git binary) + env + migration.

**CHANGED (TS)**: `services/agents/src/{run-conversation-turn.ts, server.ts}`;
`packages/agent-stream` (TurnRequest type: add Workspace, remove Files/Skills;
manifest part type); console: turn create/attach + tag-only save + viewer mode +
banners/guards (D18–D20), dirty flag from server Diff.

**DELETED / CONVERGED**: 4 bespoke `GetRef→…→GetBlob` walkers + their 4 caches →
one `git fetch` + plumbing read (C1); 3 base-tree-overlay + sha:null write
assemblies → one `Mutate` (C5); the inline `Files`+`Skills` payload; the FE
draft store `specDraftSession.ts` + its 409-rebase machinery; both 413 guards;
`mergeApprovedRequirements`; gittest's Git-Data HTTP fake; the retired GitData
object methods; `conflict_retry.go` (org-keyed leaky bucket → `Mutate`'s
bounded + jittered retry, D5); the skills `catalogCache`.

---

## 16. Migration phases & exit gates

** Note: Implement with subagents for each phase. Implement, cleanup, test thourghly before moving into next phase.

Feature flags: `WORKSPACE_MODE = rest | dual | mount` (reads/writes backend) and
`GENERATION_MODE = draft | committed` (the FE/turn contract), so the engine and
the generation model cut over independently. Order is fixed
**infra → skills → reads → writes → generation → delete**.

**Definition of done for every phase:** its exit gate passes on **both**
deployment targets (docker-compose *and* k3d/RWX), the flag **rollback drill**
has been exercised where a flag exists, and `make build · test · lint ·
typecheck · license-check` are green. E2e items follow the fresh-cluster
discipline: full teardown → fresh spawn, streaming verified from mid-stream
screenshots.

---

**Phase 0 — Infra (dark).** Add the `aep-workspaces` RWX volume/PVC + env to
both services; add `git` to the aep-api image; land `workspace.go` + `gitfs`
(engine/paths/lock/askpass/snapshots/mutate/reaper) + `workspacetest`. **No
consumer switched.** The reaper must ship here or the volume fills.

*Exit gate:*
- [ ] `workspacetest` green against a **real bare origin** fixture: mirror
  clone/fetch; `Head/List/ReadFile/ReadBundle` at branch, tag, and raw sha
  (incl. annotated-tag peel); `Mutate` write+delete overlay; `Tag` + collision
  → recompute → land; `Diff`; `SnapshotProvider.Ensure` idempotent under
  **concurrent** double-invocation (tmp/+rename atomicity — no torn dir ever
  observable).
- [ ] **Credential hygiene test:** askpass injection works; the token appears
  in no argv (`ps`-scrape assertion), no `.git/config`, no file on the mount.
- [ ] **flock probe on the target RWX StorageClass** (§17.1): two processes on
  two nodes contend an exclusive flock — semantics honoured, or the
  Postgres-advisory fallback is switched on in `lock.go` and aep-api pinned to
  1 writer replica. *Recorded as a written result in this doc.*
- [ ] **Corruption soak:** N concurrent fetch/push/`Mutate` workers hammer one
  mirror under flock, then `git fsck` is clean; crash-mid-clone leaves only
  `tmp/` debris (canonical path never half-populated).
- [ ] Reaper unit passes: trash-then-purge (open-fd reader survives a trash of
  its repo), snapshot age-reap honours the not-current-HEAD guard, orphan
  reconcile respects the mtime grace, quota/LRU evicts snapshots before
  mirrors.
- [ ] Cross-mount smoke: a file written by aep-api is readable from the agents
  container at the same path (compose **and** k3d).
- [ ] Images build on arm64 **and** amd64 (QEMU non-determinism gotcha).

---

**Phase 1 — Skills first (lowest risk).** Move the per-org `_skills` store onto
the mount (`loadCatalog`→`ReadBundle`, `commitFiles`→`Mutate`); seed the
embedded core/flow skills into `_skills` at org provisioning (§17.8). Already
single-writer-per-org, so it exercises mirror+flock+credential+`Mutate` in
isolation.

*Exit gate:*
- [ ] **Shadow parity:** in `dual` mode, catalog reads via REST and via the
  mount are byte-equal (names, frontmatter, bodies, references) across every
  seeded org — zero mismatches before the flip.
- [ ] Component-tier: skills CRUD through the mount; **two concurrent
  `commitFiles`** for one org → serialized by the flock, both land (or clean
  conflict), `git fsck` clean after.
- [ ] Fresh-org provisioning seeds core/flow skills into `_skills`; a brand-new
  org lists builtins with zero Postgres skill state.
- [ ] Integration-suite skills phase green in `mount` mode.
- [ ] E2e: skills page lists builtin + org skills; an update round-trips to the
  GitHub `org-skills` repo (visible on origin).
- [ ] Rollback drill: flag back to `rest`, skills flow still green.

---

**Phase 2 — Cut READS** (files/artifacts/genai payload assembly). Flip
`List`/`ReadFile`/`ReadBundle` to the mount in `dual` mode — run **both** the
REST walker and the plumbing read, assert equality, serve REST; then flip to
mount-serves. Push/tag still REST. No behaviour change.

*Exit gate:*
- [ ] **Dual-mode mismatch counter = 0** over a full soak window (byte content
  + blob-SHA equality on every read pair, all four consumers) before
  mount-serves.
- [ ] Component-tier parity: files GET/list @HEAD/@tag/@sha; missing path →
  404 unchanged; unicode paths; large file; artifacts `ReadBundle` at
  Head/Tag/Commit; version viewer at tags.
- [ ] Existing IDOR/component discipline re-run: cross-org reads still
  403/404 — the path deriver never consulted client input.
- [ ] Cold-path measured: first-read (clone-on-demand) latency recorded;
  provisioning state added if it breaches the UX threshold (§17.3).
- [ ] Integration-suite read phases green in `mount` mode; p50/p95 read
  latency ≤ REST baseline.
- [ ] Rollback drill: `rest` mode re-flip mid-soak, zero errors.

---

**Phase 3 — Cut WRITES** (`files.Apply`, tag, revert, skills commit). Flip to
`Mutate`/`Tag` behind an **org allowlist**; REST CAS path stays behind the flag
for instant rollback.

*Exit gate:*
- [ ] `workspacetest` concurrency: two concurrent `Mutate`s on one repo → one
  FF-lands, the other retries and lands; retry exhaustion surfaces the
  sentinel; concurrent same-name `Tag` → collision → recompute → `vN+1` lands.
- [ ] **Crash-between-`commit-tree`-and-push** test for the commit path *and*
  the tag path (§17.2): origin untouched, loose objects GC-able, re-run
  succeeds.
- [ ] Component-tier contract pins: `Apply` with stale `baseSha` → **the same
  409 body as today**; batch write+delete atomicity (all-or-nothing);
  `revertSubtreeToTag` restores content and deletes extras; save-gate failure
  blocks the tag exactly as today.
- [ ] SHA consistency (C8): after every write, the sha recorded in
  `git_repositories`/executions == `git rev-parse` on origin == the mirror ref.
- [ ] Integration-suite write phases green in `mount` mode; the commit/tag is
  visible **on GitHub** (origin advanced).
- [ ] Rollback drill: allowlisted org flipped back mid-day; writes resume via
  REST with no stuck state on the mount.

---

**Phase 4 — Committed-truth generation.** Land `agentfold` + cassette goldens,
the `agent_turns` table + heartbeat sweep, the turn runner/broker, the agents
manifest part + snapshot reads (`load-workspace.ts`, `snapshot-path.ts`), and
the console cutover (draft store deleted; 202+attach; tag-only save; viewer
mode; banners/guards) — deployed together behind `GENERATION_MODE`, flipped
per-org. **During the window agents accepts both payload shapes** (inline
`files/skills` and `workspace`) so non-flipped orgs keep working.

*Exit gate:*
- [ ] **Fold-parity goldens:** every recorded sse-cassette replayed through the
  TS fold and the Go fold → byte-equal file states + matching manifest hashes;
  cassette corpus extended with the hostile shapes (`editFile` unicode/CRLF,
  frontmatter arrays/quoting, delete-then-recreate, empty file).
- [ ] **Manifest gate mutation test:** corrupt one byte in the Go fold output →
  turn fails `fold-parity`, **no commit**; severed stream (no manifest) → no
  commit; empty manifest → `completed(no-changes)`, no commit.
- [ ] D15 race tests: concurrent `Apply` to an **unrelated** file mid-turn →
  turn still lands (rebase); concurrent `Apply` to a **generated** file →
  turn fails `base-moved` with the conflicting paths listed.
- [ ] Guard + durability: second `POST turn` → `409 {activeTurnId}`; kill the
  running replica mid-turn → heartbeat goes stale → sweep fails the row,
  releases the guard, next turn carries the "changes were NOT applied" note
  (D20); commit object has author=user, committer=bot.
- [ ] Fence (§17.5) at component tier: ID-fuzz (`../`, dots, separators,
  oversized, wrong charset) → pre-stream 400; `org_` segment ≠ `X-Org-Id`
  claim → rejected; unknown snapshot sha → pre-stream 400.
- [ ] Agents evals green reading fixture `snapshots/<sha>/` dirs (no files in
  the payload), skill pickup asserted; **both** payload shapes accepted.
- [ ] D19 gate: design turn without any requirements tag → 409; with
  HEAD.req ≠ latest `vN` → FE banner shown, generation proceeds, lineage
  stamps `{specTag, baseSha}`.
- [ ] **E2e (fresh cluster, mid-stream screenshots):** 
  using sonnet agent + playwright cli skill, if you find any bugs, make sure to report back with info(atleast screenshots,logs,)
  requirements + design generation land as commits on `main`; refresh mid-generation → re-attach
  resumes the live stream; second tab attaches as viewer; manual edit →
  commit; approve → tag `vN` on the pinned sha; discard → revert; base-moved
  conflict surfaced in the UI; edit-guard active on the generating subtree.
- [ ] Flag drill: one org on `committed`, another on `draft` — both fully
  functional simultaneously; flipped org rolled back to `draft` cleanly.

---

**Phase 5 — Delete.** Remove the 4 REST walkers + caches (incl. the skills
`catalogCache`), the inline payload, `specDraftSession.ts` + both 413 guards,
`conflict_retry.go`, `mergeApprovedRequirements`, the gittest Git-Data fake,
the retired GitData methods, and the dual-mode shims. `gitfs` is the single
seam; the flags are removed.

Cleanup, dead code, /codereview 

*Exit gate:*
- [ ] Grep-clean: zero references to the deleted symbols (`GetTree`,
  `CreateBlob`, `CreateTree`, `CreateCommit`, `UpdateRef`, `specDraftSession`,
  `conflict_retry`, `catalogCache`, `mergeApprovedRequirements`,
  `TurnRequest.Files/Skills`, the 413 guards, `WORKSPACE_MODE`,
  `GENERATION_MODE`).
- [ ] Arch-lock / compile-time wiring guards updated to the final structure;
  full `make` suite green.
- [ ] Integration suite green **with the REST git-object code gone from the
  binary**.
- [ ] **Final fresh-env demo, ALL-PASS, zero intervention** (the ADR-0003 bar):
  provision org → create project → generate requirements → edit → approve →
  generate design → approve → tasks smoke — end to end on the mount-only,
  committed-truth build.


---

## 17. Open questions

1. **RWX flock semantics** on the chosen StorageClass — the mirror-integrity lock
   and the reaper leader lock assume POSIX `flock(2)` across nodes (CephFS/NFSv4/
   EFS honour it; some NFS/gluster setups no-op it). Must be validated in Phase 0;
   on failure, fall back to the Postgres advisory lock (already behind `lock.go`)
   and pin aep-api to 1 writer. **Gates multi-replica writer rollout.**
2. **Crash-between-commit-and-push idempotency for the tag path** specifically
   (partial tag state on origin) — needs an explicit `workspacetest`.
3. **First-turn / first-read latency** — `git clone --mirror` of a large repo is
   on the read hot path the first time; needs warm-clone-on-repo-create prefetch
   and/or a visible "provisioning" state. Measure p50 turn-start regression vs
   today's N+3 fan-out (cheap for small `specs/` trees).
4. **Snapshot materialization cost for large monorepos** — one `git archive` per
   *commit* (better than the per-turn cost of the abandoned session model, but
   still O(tree size)); may need a path-scoped
   `git archive <sha> -- specs/ <appPath>`. Decide the scope contract with the
   agents team.
5. **Cross-tenant fence coverage** — the fence is structural (agents never
   accepts a filesystem path; it derives snapshot dirs from validated IDs + shas,
   D9), so the residual surface is ID handling: strict shape validation, the
   `org_<orgId>`-segment==`X-Org-Id` check, and the aep-api deriver never
   trusting client input. Cover with ID-fuzz + org-mismatch cases at the
   component-test tier (the existing IDOR discipline) before Phase 4.
6. **Orphan-pass grace vs create/adopt race** — a freshly cloned repo whose row is
   committing concurrently could momentarily look orphaned. The ~2×-interval mtime
   grace should cover it; validate under the adopt-on-conflict create path.
7. **Runner convergence timing** — this design keeps the runner on its own clone.
   A later phase could point its `WORKSPACE_BASE_PATH` at the shared mirror with
   `git worktree`, but that reintroduces a second writer + a real working tree, so
   it needs its own lock/lease design and is explicitly deferred.
8. **Skills seeding source of truth — DECIDED (a).** Core/flow skills are
   `go:embed`'d into aep-api while org skills live in the `_skills` mirror.
   **Decision: seed the embedded core/flow skills into the `_skills` mirror once
   at org provisioning** (and re-reconcile on version bump), so there is exactly
   **one on-disk source** and agents read *all* skills from `_skills`
   snapshots. Residual: the upgrade trigger that re-seeds when the bundled skill
   version changes.
9. **Part-buffer multi-replica** (D17) — revisit when aep-api runs >1 replica:
   persist parts to Postgres vs sticky stream routing.
10. **Chat UX under the one-slot guard** (D18) — is 409-as-viewer acceptable for
    chat during long design generations, or does this force per-useCase slots
    later?
11. **Part-buffer retention grace** after the terminal event (late attachers) —
    pick a TTL.
12. **Commit-noise ceiling** — if `main` history becomes too chatty, consider
    squash-on-tag later; explicitly out of scope now (D13).

---

## 18. Traceability — coverage of the 215 inventory operations

Every operation in [`git-operations-inventory.md`](./git-operations-inventory.md)
falls into one of six coverage classes, each resolved by a design section below.

| Coverage class | # ops | Resolved by | Meaning |
|---|---|---|---|
| **Stays GitHub REST** (issues/labels/PRs/webhooks/App-installations/repo-admin) | 72 | §9, Non-goals | No local-clone equivalent — the GitHub client keeps these ports untouched. |
| **Git-object → mount** (GetRef/Commit/Tree/Blob, CreateBlob/Tree/Commit/UpdateRef, tag object/ref, ListMatchingRefs, GetTagObject, CompareRefs) | 62 | §5–§11 | Collapse into the `Workspace` port: plumbing reads + `Mutate`/`Tag`/`Diff`. |
| **Inline payload → shrink** (whole-codebase `Files`, `Skills[]`, filesChangedExternally, per-turn transfer) | 18 | §4, §6, §12 | Replaced by per-SHA snapshots + the ID/sha turn payload (D9); `filesChangedExternally` server-derived (D20). |
| **DB / coordinate stores** (repo record, execution coords, credential coords, webhook→org routing map) | 24 | §4, §13, §14 | Path is a **pure function of the DB row** (`repo_slug`) — no schema change to existing tables; `agent_turns` is additive; reaper hooks on delete. |
| **Deploy / gittest / skills-mount / runner-precedent** | 15 | §13, §15, §17 | RWX volume; `workspacetest` supersedes the gittest Git-Data fake; skills seeded to `_skills`. |
| **Other** (commit identity, save gate, auth minting, dispatch/build cluster) | 24 | §8, §6, §10, §2 | Identity/creds → §8/D20; save gate → §6/§10 (at the pinned sha); dispatch/build cluster → **deferred**, §2 + §17.7. |

**Two inventory suggestions this design consciously supersedes:** (1) "add a
clone-path column to `git_repositories`" — **rejected**, the path is derived from
`repo_slug` so it can never drift (D6); (2) "add a mount clone-path to the skills
repo row" — same, the deriver handles `_skills` with zero bespoke columns.

**Nothing in the inventory is left un-mapped.** The residual *unknowns* are the
twelve items in §17 (operational/infra validation + generation-model tuning),
not un-addressed operations.

---

## 19. Implementation notes (Phase 5 close-out, 2026-07-06)

- **flock (§17.1):** validated on single-host docker-compose only — the local
  POSIX `flock(2)` is honoured (corruption soak + EX/SH contention tests in
  `internal/platform/gitfs`). Multi-node RWX semantics remain UNVALIDATED, so
  aep-api stays pinned to 1 writer replica (helm default); the Postgres
  advisory fallback is documented in `gitfs/lock.go`, not built.
- **D15 deviation:** the turn runner's overlap check is a per-touched-path
  blob compare against `Tx.Base()` (baseline blob SHAs read pre-Mutate) — not
  `Workspace.Diff` inside `fn`, which would self-deadlock on the repo flock.
  Semantics are equivalent restricted to touched paths and stricter about
  changed-then-reverted content (not a conflict).
- **Prompt handshake change:** `POST /projects` takes `{name}` only — the
  issue #72 `prompt` field was dropped from the API. The console carries the
  prompt CLIENT-side (router history state, the console-legacy `streamPrompt`
  pattern) to the project page. `search` + `nextCursor` on the projects list
  shipped as agreed (page-scoped Go-side search filter over the OC page).
- **zod/schema alignment:** the agents-side design.json write-gate
  (`checkComponentDesign`) used plain `z.object` for connection items while
  the published `component-design.schema.json` (and the BFF save-gate) pin
  `additionalProperties: false`. The zod gate (and its agentfold Go port) was
  TIGHTENED to strict so an agent self-corrects in-turn instead of committing
  a design.json the tag-time save gate later 422s.
- **E2e fixes (2026-07-06, fresh-cluster run):** (1) the skills mirror's
  on-disk leaf is pinned to `org-skills` via
  `models.(*GitRepository).WorkspaceSlug()` — the owner-prefixed `repo_slug`
  (`<owner>-org-skills`) broke the agents service's structural snapshot-path
  derivation (§4/§12) and 400'd every turn pre-stream; one choke point now
  feeds WorkspaceRefFor, the DeleteRepo trash hook, and the reaper's orphan
  set. (2) D20 author attribution: `jwtassertion.TokenClaims.Sub` (depth-0)
  shadows the embedded `RegisteredClaims.Subject` during JSON decode, so the
  auth middleware projected an always-empty Subject and every turn commit
  fell back to the credential identity; the projection now reads `tc.Sub`
  (decode shape pinned by test). Full flow re-verified end-to-end after both:
  generation/chat/design commits, refresh re-attach, viewer mode, D15 both
  arms, D19 gate+banner, task planning to real GitHub issues.

### 19.1 Auth bugs — root causes & fixes (keep for future reference)

Two auth defects were found late (one in the fresh-cluster e2e, one in code
review). Both were invisible on a single host / in unit tests and only bit
under a real deployment or a real JWT, so they are recorded here in full.

**Auth bug #1 — `sub` claim silently lost to JSON struct-tag shadowing (D20).**
`internal/platform/auth/jwtassertion/auth.go` `TokenClaims` declares its own
`Sub string` with tag `json:"sub"` at struct depth 0 **and** embeds
`jwt.RegisteredClaims`, whose `Subject string` (tag `json:"sub"`) sits one
level deeper. Go's `encoding/json`, when two fields map to the same JSON key at
different depths, populates only the **shallower** field and leaves the deeper
one at its zero value — so after decoding a real token `tc.Sub` held the
subject but the promoted `tc.Subject` was always `""`. `auth.JWTMiddleware`
(`internal/platform/auth/jwt.go`) projected `tc.Subject` into
`auth.Claims.Subject`, so **every** reader of `auth.Claims.Subject` got an
empty string — not just genai's `captureIdentities` (author fell back to the
bot/PAT identity on every turn commit) but also `auth/actor.go`
`ActorFromContext`. It compiled clean and passed unit tests (which build
`Claims` directly rather than round-tripping JSON); it only surfaced by
inspecting `git log` on a committed turn in the e2e.
*Fix:* project `tc.Sub` (one line in `jwt.go`). *Guard:* a decode-shape test
in `jwtassertion/auth_test.go` unmarshals `{"sub":"x"}` and asserts
`tc.Sub=="x"` **and** `tc.Subject==""`, with a failure message telling a future
maintainer to re-audit every `tc.Sub` consumer if the shadowing ever changes.
*Lesson:* never read a promoted embedded field whose JSON tag is also declared
on the outer struct — read the outer field, or don't duplicate the tag.

**Auth bug #2 — S2S JWT `nbf` vs zero clock tolerance → intermittent 401.**
The outbound aep-api→agents M2M token (`internal/clients/agentsvc/token.go`)
stamped `nbf = now`, and the agents-side jose verifier
(`services/agents/src/shared/auth.ts`) passed no `clockTolerance` (jose default
is 0). In a multi-node deployment where the agents pod's clock runs even
fractionally behind aep-api's, `jwtVerify` throws "jwt not active yet" → 401
**before** the SSE opens → the detached runner records a `dispatch-failed`
turn with no retry. Invisible on one host; intermittent across pods.
*Fix (belt-and-suspenders, both sides):* backdate `nbf` by `nbfSkew` (30s) at
the minting site, **and** add `clockTolerance: "5s"` to the shared jose verify
options so both the RS256 and HS256 branches inherit it (test: a token with
`nbf` a couple seconds in the future still verifies).
*Related:* the `X-Org-Id` header (§12) is now the **load-bearing** tenancy
fence at the agents service (`snapshot-path.ts` asserts the conversation-id
`org_<orgId>` segment == the claim, else 403) — not "log-only". The stale
"log-only" comments on `agentsvc/client.go` were corrected; do not drop or
stop forwarding that header.
